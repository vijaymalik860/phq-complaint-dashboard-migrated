import { FastifyInstance } from 'fastify';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthUser } from '../middleware/auth.js';
import { prisma } from '../config/database.js';

const execFileAsync = promisify(execFile);

function getProjectRoot(): string {
  let dir = process.cwd();
  while (dir) {
    if (fs.existsSync(path.join(dir, 'deploy.bat'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Checks whether the PHQDeploy scheduled task exists. */
async function scheduledTaskExists(): Promise<boolean> {
  try {
    await execFileAsync('schtasks', ['/query', '/tn', 'PHQDeploy', '/fo', 'LIST']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-creates the PHQDeploy scheduled task using inline PowerShell.
 * Works when the Node/PM2 process has elevated (SYSTEM / admin) rights.
 * Throws a descriptive error if admin rights are insufficient.
 */
async function createScheduledTask(deployBat: string, projectRoot: string): Promise<void> {
  // Escape single-quotes in paths for the PowerShell string literals
  const batEsc  = deployBat.replace(/'/g, "''");
  const rootEsc = projectRoot.replace(/'/g, "''");

  const psCmd = [
    `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c ""${batEsc}""' -WorkingDirectory '${rootEsc}'`,
    `$t = New-ScheduledTaskTrigger -Once -At ([datetime]::Now.AddYears(99))`,
    `$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable`,
    `$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest`,
    `Register-ScheduledTask -TaskName 'PHQDeploy' -TaskPath '\\' -Action $a -Trigger $t -Settings $s -Principal $p -Description 'PHQ Dashboard UI-triggered deployment' -Force -ErrorAction Stop | Out-Null`,
  ].join('; ');

  await execFileAsync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd],
    { timeout: 30_000 }
  );
}

/**
 * Ensures the PHQDeploy task exists (auto-creates if missing), then fires it.
 */
async function triggerDeploy(log: (msg: string) => void): Promise<void> {
  const projectRoot = getProjectRoot();
  const deployBat   = path.join(projectRoot, 'deploy.bat');

  if (!fs.existsSync(deployBat)) {
    throw new Error(`deploy.bat not found at: ${deployBat}`);
  }

  // ── 1. Ensure scheduled task exists ────────────────────────────────────────
  const exists = await scheduledTaskExists();
  if (exists) {
    log('[deploy] PHQDeploy scheduled task found.');
  } else {
    log('[deploy] PHQDeploy task not found — attempting auto-registration...');
    try {
      await createScheduledTask(deployBat, projectRoot);
      log('[deploy] PHQDeploy scheduled task created successfully.');
    } catch (err: any) {
      throw new Error(
        `The PHQDeploy scheduled task does not exist and could not be created automatically ` +
        `(Administrator / SYSTEM rights are required). ` +
        `Re-run install.bat as Administrator on the server to fix this once.`
      );
    }
  }

  // ── 2. Fire the task ────────────────────────────────────────────────────────
  log('[deploy] Triggering PHQDeploy via schtasks /run ...');

  await new Promise<void>((resolve, reject) => {
    const child = spawn('schtasks', ['/run', '/tn', 'PHQDeploy', '/f'], {
      detached:    true,
      stdio:       'ignore',
      windowsHide: true,
    });

    child.on('error', (err) =>
      reject(new Error(`schtasks spawn error: ${err.message}`))
    );

    child.on('close', (code) => {
      if (code === 0) {
        log('[deploy] PHQDeploy task is now running. Deployment started.');
        resolve();
      } else {
        reject(new Error(
          `schtasks exited with code ${code}. ` +
          `If the issue persists, re-run install.bat as Administrator.`
        ));
      }
    });

    child.unref();
  });
}

// ── Routes ──────────────────────────────────────────────────────────────────

export async function systemRoutes(app: FastifyInstance) {

  // POST /api/system/trigger-deployment
  app.post(
    '/system/trigger-deployment',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user as AuthUser;

      if (user?.role !== 'developer' && user?.role !== 'superadmin' && user?.role !== 'admin') {
        return reply.status(403).send({ error: 'Unauthorized. Admin or Developer access required.' });
      }

      // Guard: don't deploy while a DB sync is running
      try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const activeSync = await prisma.syncRun.findFirst({
          where: { status: 'running', startedAt: { gt: oneHourAgo } },
        });
        if (activeSync) {
          return reply.status(409).send({
            error: 'Cannot trigger update while a database sync is running. Wait for it to finish first.',
          });
        }
      } catch (dbError: any) {
        app.log.warn(`Sync check failed: ${dbError.message}. Proceeding.`);
      }

      try {
        await triggerDeploy((msg) => app.log.info(msg));
        return {
          message:
            'Deployment triggered! The server is pulling the latest code and will restart in ~2 minutes. ' +
            'The deploy log below will auto-refresh every 5 seconds.',
        };
      } catch (error: any) {
        app.log.error(`[deploy] Failed: ${error.message}`);
        return reply.status(500).send({ error: `Deployment trigger failed: ${error.message}` });
      }
    }
  );

  // GET /api/system/deploy-log
  app.get(
    '/system/deploy-log',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user as AuthUser;
      if (user?.role !== 'developer' && user?.role !== 'superadmin' && user?.role !== 'admin') {
        return reply.status(403).send({ error: 'Unauthorized.' });
      }

      const projectRoot = getProjectRoot();
      const logPath     = path.join(projectRoot, 'logs', 'deploy.log');

      if (!fs.existsSync(logPath)) {
        return {
          log: '(No deploy.log found yet. Trigger a deployment first — the log appears here automatically.)',
          updatedAt: null,
        };
      }

      try {
        const content = fs.readFileSync(logPath, 'utf-8');
        const lines   = content.split('\n');
        const last200 = lines.slice(-200).join('\n');
        const stat    = fs.statSync(logPath);
        return { log: last200, updatedAt: stat.mtime };
      } catch (err: any) {
        return reply.status(500).send({ error: `Could not read log: ${err.message}` });
      }
    }
  );

  // GET /api/system/deploy-info
  app.get(
    '/system/deploy-info',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user as AuthUser;
      if (user?.role !== 'developer' && user?.role !== 'superadmin' && user?.role !== 'admin') {
        return reply.status(403).send({ error: 'Unauthorized.' });
      }

      const projectRoot = getProjectRoot();
      const scriptPath  = path.join(projectRoot, 'deploy.bat');
      const logPath     = path.join(projectRoot, 'logs', 'deploy.log');

      let scheduledTaskExists = false;
      let scheduledTaskState  = 'unknown';
      try {
        const { stdout } = await execFileAsync(
          'schtasks',
          ['/query', '/tn', 'PHQDeploy', '/fo', 'LIST']
        );
        scheduledTaskExists = stdout.includes('PHQDeploy');
        const stateMatch    = stdout.match(/Status:\s+(.+)/i);
        scheduledTaskState  = stateMatch ? stateMatch[1].trim() : 'found';
      } catch {
        scheduledTaskExists = false;
        scheduledTaskState  = 'NOT FOUND — re-run install.bat as Administrator';
      }

      return {
        projectRoot,
        deployBatPath:      scriptPath,
        deployBatExists:    fs.existsSync(scriptPath),
        deployLogPath:      logPath,
        deployLogExists:    fs.existsSync(logPath),
        scheduledTaskExists,
        scheduledTaskState,
        triggerMethod:      'schtasks /run /tn PHQDeploy',
        nodeVersion:        process.version,
        platform:           process.platform,
      };
    }
  );
}

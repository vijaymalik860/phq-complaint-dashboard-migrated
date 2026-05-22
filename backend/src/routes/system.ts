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

/** Spawns a process and resolves with { ok, stderr, code } — never throws. */
function trySpawn(
  cmd: string,
  args: string[],
  opts: { cwd?: string; windowsHide?: boolean } = {}
): Promise<{ ok: boolean; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    let stderrBuf = '';
    const child = spawn(cmd, args, {
      cwd:         opts.cwd,
      detached:    false,
      stdio:       ['ignore', 'ignore', 'pipe'],
      windowsHide: opts.windowsHide ?? true,
      shell:       false,
    });
    child.stderr?.on('data', (d: Buffer) => { stderrBuf += d.toString(); });
    child.on('error',  (err) => resolve({ ok: false, stderr: err.message,     code: null }));
    child.on('close',  (code) => resolve({ ok: code === 0, stderr: stderrBuf.trim(), code }));
  });
}

/**
 * Fires deploy.bat using up to three strategies in order:
 *   1. schtasks /run /tn PHQDeploy   (requires admin rights)
 *   2. PowerShell Start-ScheduledTask (alternative elevation path)
 *   3. Direct detached spawn of deploy.bat  (always works; safe because
 *      deploy.bat uses `pm2 stop` -- not `pm2 kill` -- so the PM2 daemon
 *      and its Job Object stay alive throughout the deployment)
 */
async function triggerDeploy(log: (msg: string) => void): Promise<void> {
  const projectRoot = getProjectRoot();
  const deployBat   = path.join(projectRoot, 'deploy.bat');

  if (!fs.existsSync(deployBat)) {
    throw new Error(`deploy.bat not found at: ${deployBat}`);
  }

  // Ensure scheduled task exists (best-effort; failures are non-fatal)
  const exists = await scheduledTaskExists();
  if (!exists) {
    log('[deploy] PHQDeploy task not found -- attempting auto-registration...');
    try {
      await createScheduledTask(deployBat, projectRoot);
      log('[deploy] PHQDeploy scheduled task created successfully.');
    } catch {
      log('[deploy] Could not auto-create PHQDeploy task (no admin rights). Will try direct spawn.');
    }
  } else {
    log('[deploy] PHQDeploy scheduled task found.');
  }

  // Strategy 1: schtasks /run
  log('[deploy] Strategy 1: schtasks /run /tn PHQDeploy ...');
  const r1 = await trySpawn('schtasks', ['/run', '/tn', 'PHQDeploy', '/f']);
  if (r1.ok) {
    log('[deploy] PHQDeploy task triggered via schtasks. Deployment started.');
    return;
  }
  log(`[deploy] schtasks failed (code ${r1.code}): ${r1.stderr || '(no stderr)'}. Trying Strategy 2...`);

  // Strategy 2: PowerShell Start-ScheduledTask
  log('[deploy] Strategy 2: PowerShell Start-ScheduledTask ...');
  const r2 = await trySpawn('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    "Start-ScheduledTask -TaskName 'PHQDeploy' -ErrorAction Stop",
  ]);
  if (r2.ok) {
    log('[deploy] PHQDeploy task triggered via PowerShell. Deployment started.');
    return;
  }
  log(`[deploy] PowerShell failed (code ${r2.code}): ${r2.stderr || '(no stderr)'}. Trying Strategy 3...`);

  // Strategy 3: Direct detached spawn of deploy.bat
  // This always works regardless of admin rights.
  // deploy.bat uses `pm2 stop` (not `pm2 kill`) so the PM2 daemon and its
  // Job Object stay alive throughout; spawning into it is therefore safe.
  log('[deploy] Strategy 3: Direct detached spawn of deploy.bat ...');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', deployBat], {
      cwd:         projectRoot,
      detached:    true,
      stdio:       'ignore',
      windowsHide: true,
      shell:       false,
    });

    let settled = false;
    child.on('error', (err) => {
      if (!settled) { settled = true; reject(new Error(`Direct spawn failed: ${err.message}`)); }
    });
    // If no spawn error within 600 ms the process is running.
    setTimeout(() => {
      if (!settled) {
        settled = true;
        child.unref();
        log('[deploy] deploy.bat launched directly (detached). Deployment started.');
        resolve();
      }
    }, 600);
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
          log: '(No deploy.log found yet. Trigger a deployment first -- the log appears here automatically.)',
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

      let taskExists = false;
      let taskState  = 'unknown';
      try {
        const { stdout } = await execFileAsync(
          'schtasks',
          ['/query', '/tn', 'PHQDeploy', '/fo', 'LIST']
        );
        taskExists = stdout.includes('PHQDeploy');
        const stateMatch = stdout.match(/Status:\s+(.+)/i);
        taskState = stateMatch ? stateMatch[1].trim() : 'found';
      } catch {
        taskExists = false;
        taskState  = 'NOT FOUND -- re-run install.bat as Administrator';
      }

      return {
        projectRoot,
        deployBatPath:      scriptPath,
        deployBatExists:    fs.existsSync(scriptPath),
        deployLogPath:      logPath,
        deployLogExists:    fs.existsSync(logPath),
        scheduledTaskExists: taskExists,
        scheduledTaskState:  taskState,
        triggerMethod:      'multi-strategy (schtasks -> PowerShell -> direct spawn)',
        nodeVersion:        process.version,
        platform:           process.platform,
      };
    }
  );
}

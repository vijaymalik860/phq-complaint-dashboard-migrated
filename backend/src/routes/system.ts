import { FastifyInstance } from 'fastify';
import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthUser } from '../middleware/auth.js';
import { prisma } from '../config/database.js';

function getProjectRoot(): string {
  let dir = process.cwd();
  while (dir) {
    if (fs.existsSync(path.join(dir, 'deploy.bat'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function triggerDeployViaScheduledTask(log: (msg: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log('[deploy] Triggering via schtasks /run /tn PHQDeploy ...');

    const child = spawn('schtasks', ['/run', '/tn', 'PHQDeploy', '/f'], {
      detached:    true,
      stdio:       'ignore',
      windowsHide: true,
    });

    child.on('error', (err) => {
      reject(new Error(`schtasks spawn error: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        log('[deploy] schtasks returned 0 -- PHQDeploy task is now running.');
        resolve();
      } else {
        reject(new Error(
          `schtasks exited with code ${code}. ` +
          `Ensure the PHQDeploy scheduled task was created by running ` +
          `bootstrap-update.bat (or scripts\\create-deploy-task.ps1) as Administrator.`
        ));
      }
    });

    child.unref();
  });
}

export async function systemRoutes(app: FastifyInstance) {

  app.post(
    '/system/trigger-deployment',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user as AuthUser;

      if (user?.role !== 'developer' && user?.role !== 'superadmin' && user?.role !== 'admin') {
        return reply.status(403).send({ error: 'Unauthorized. Admin or Developer access required.' });
      }

      try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const activeSync = await prisma.syncRun.findFirst({
          where: { status: 'running', startedAt: { gt: oneHourAgo } }
        });
        if (activeSync) {
          return reply.status(409).send({
            error: 'Cannot trigger update. A database synchronization is currently running. Wait for it to finish first.'
          });
        }
      } catch (dbError: any) {
        app.log.warn(`Sync check failed: ${dbError.message}. Proceeding.`);
      }

      try {
        const projectRoot = getProjectRoot();
        const scriptPath  = path.join(projectRoot, 'deploy.bat');

        app.log.info(`[deploy] Script: ${scriptPath} | root: ${projectRoot}`);

        if (!fs.existsSync(scriptPath)) {
          app.log.error(`[deploy] deploy.bat NOT FOUND at: ${scriptPath}`);
          return reply.status(500).send({ error: `deploy.bat not found at: ${scriptPath}` });
        }

        await triggerDeployViaScheduledTask((msg) => app.log.info(msg));

        return { message: 'Deployment triggered! Server is now pulling the latest code and will restart in ~2 minutes. Refresh the log below to monitor progress.' };

      } catch (error: any) {
        app.log.error(`[deploy] Failed: ${error.message}`);
        return reply.status(500).send({ error: `Failed to trigger deployment: ${error.message}` });
      }
    }
  );

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
        return { log: '(No deploy.log found yet. Trigger a deployment first and wait ~2 minutes before refreshing.)', updatedAt: null };
      }

      try {
        const content = fs.readFileSync(logPath, 'utf-8');
        const lines   = content.split('\n');
        const last150 = lines.slice(-150).join('\n');
        const stat    = fs.statSync(logPath);
        return { log: last150, updatedAt: stat.mtime };
      } catch (err: any) {
        return reply.status(500).send({ error: `Could not read log: ${err.message}` });
      }
    }
  );

  app.get(
    '/system/deploy-info',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user as AuthUser;
      if (user?.role !== 'developer' && user?.role !== 'superadmin' && user?.role !== 'admin') {
        return reply.status(403).send({ error: 'Unauthorized.' });
      }

      const projectRoot  = getProjectRoot();
      const scriptPath   = path.join(projectRoot, 'deploy.bat');
      const logPath      = path.join(projectRoot, 'logs', 'deploy.log');

      let scheduledTaskExists = false;
      let scheduledTaskState  = 'unknown';
      try {
        const { stdout } = await new Promise<{ stdout: string; stderr: string }>((res, rej) => {
          execFile('schtasks', ['/query', '/tn', 'PHQDeploy', '/fo', 'LIST'], (err, stdout, stderr) => {
            if (err) rej(err); else res({ stdout, stderr });
          });
        });
        scheduledTaskExists = stdout.includes('PHQDeploy');
        const stateMatch    = stdout.match(/Status:\s+(.+)/i);
        scheduledTaskState  = stateMatch ? stateMatch[1].trim() : 'found';
      } catch {
        scheduledTaskExists = false;
        scheduledTaskState  = 'NOT FOUND -- run bootstrap-update.bat as Administrator';
      }

      return {
        projectRoot,
        deployBatPath:       scriptPath,
        deployBatExists:     fs.existsSync(scriptPath),
        deployLogPath:       logPath,
        deployLogExists:     fs.existsSync(logPath),
        scheduledTaskExists,
        scheduledTaskState,
        triggerMethod:       'schtasks /run /tn PHQDeploy',
        nodeVersion:         process.version,
        platform:            process.platform,
      };
    }
  );
}

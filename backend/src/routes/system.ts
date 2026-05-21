import { FastifyInstance } from 'fastify';
import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthUser } from '../middleware/auth.js';
import { prisma } from '../config/database.js';

// Robust helper to dynamically trace the project root containing deploy.bat
function getProjectRoot(): string {
  let dir = process.cwd();
  // Traverse up to find the folder containing deploy.bat
  while (dir) {
    if (fs.existsSync(path.join(dir, 'deploy.bat'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd(); // fallback
}

// ─────────────────────────────────────────────────────────────────────────────
//  triggerDeployViaScheduledTask
//
//  WHY scheduled task instead of spawn/PowerShell?
//  ─────────────────────────────────────────────────
//  When PM2 starts Node.js on Windows, every child process it spawns is
//  automatically placed inside the same Windows Job Object as PM2/Node.
//  When deploy.bat runs "pm2 stop grievance-backend", PM2 tears down
//  Node.js — and Windows immediately kills ALL processes in the same Job
//  Object, including deploy.bat itself.  The script self-destructs mid-run.
//
//  A Scheduled Task runs in Session 0 under the SYSTEM account, which is
//  completely outside any Job Object.  It survives PM2 restart and runs
//  the full deploy pipeline independently.
//
//  The task "PHQDeploy" is registered once by:
//    scripts\create-deploy-task.ps1   (called by bootstrap-update.bat / install.bat)
// ─────────────────────────────────────────────────────────────────────────────
function triggerDeployViaScheduledTask(log: (msg: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log('[deploy] Triggering via schtasks /run /tn PHQDeploy ...');

    // schtasks /run is a fire-and-forget command: it returns immediately
    // after handing off to the Task Scheduler service.
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
        log('[deploy] schtasks returned 0 — PHQDeploy task is now running.');
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

  // ── POST /api/system/trigger-deployment ──────────────────────────────────────
  app.post(
    '/system/trigger-deployment',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user as AuthUser;

      if (user?.role !== 'developer' && user?.role !== 'superadmin' && user?.role !== 'admin') {
        return reply.status(403).send({ error: 'Unauthorized. Admin or Developer access required.' });
      }

      // Block if a sync is running
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

        // Trigger deploy via Windows Scheduled Task (PHQDeploy).
        // See triggerDeployViaScheduledTask() above for the full explanation
        // of WHY we use schtasks instead of spawn/PowerShell.
        await triggerDeployViaScheduledTask((msg) => app.log.info(msg));

        return { message: 'Deployment triggered! Server is now pulling the latest code and will restart in ~2 minutes. Refresh the log below to monitor progress.' };

      } catch (error: any) {
        app.log.error(`[deploy] Failed: ${error.message}`);
        return reply.status(500).send({ error: `Failed to trigger deployment: ${error.message}` });
      }
    }
  );

  // ── GET /api/system/deploy-log ───────────────────────────────────────────────
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
        const last150 = lines.slice(-150).join('\n'
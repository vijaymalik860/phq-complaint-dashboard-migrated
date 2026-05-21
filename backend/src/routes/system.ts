import { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthUser } from '../middleware/auth.js';
import { prisma } from '../config/database.js';


export async function systemRoutes(app: FastifyInstance) {

  // ── POST /api/system/trigger-deployment ──────────────────────────────────────
  // Triggers deploy.bat as a fully-independent background process using
  // PowerShell Start-Process. This is the ONLY reliable way on Windows to
  // launch a child that survives when PM2 kills the parent Node.js process.
  // Plain spawn('cmd.exe') puts the child in the same Windows Job Object as
  // the parent — so when deploy.bat stops PM2 (killing the backend), Windows
  // also kills deploy.bat. Start-Process breaks out of the Job Object.
  // ─────────────────────────────────────────────────────────────────────────────
  app.post(
    '/system/trigger-deployment',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user as AuthUser;

      if (user?.role !== 'developer' && user?.role !== 'superadmin' && user?.role !== 'admin') {
        return reply.status(403).send({ error: 'Unauthorized. Admin or Developer access required.' });
      }

      // Block if a sync is running (prevents file/DB locks during build)
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
        // PM2 sets process.cwd() to the project root (via ecosystem.config.cjs cwd field)
        const projectRoot = process.cwd();
        const scriptPath = path.join(projectRoot, 'deploy.bat');
        const logPath   = path.join(projectRoot, 'logs', 'deploy.log');

        // Ensure logs directory exists
        try { fs.mkdirSync(path.join(projectRoot, 'logs'), { recursive: true }); } catch (_) {}

        app.log.info(`[deploy] Script: ${scriptPath} | cwd: ${projectRoot} | log: ${logPath}`);

        if (!fs.existsSync(scriptPath)) {
          app.log.error(`[deploy] deploy.bat NOT FOUND at: ${scriptPath}`);
          return reply.status(500).send({ error: `deploy.bat not found at: ${scriptPath}` });
        }

        // Use PowerShell Start-Process to launch deploy.bat as a FULLY DETACHED
        // process outside the parent Node.js Job Object.
        // -RedirectStandardOutput and -RedirectStandardError pipe deploy.bat output
        // to deploy.log so you can verify it ran even after the backend restarts.
        const psCmd = [
          'Start-Process',
          '-FilePath', `"${scriptPath}"`,
          '-WorkingDirectory', `"${projectRoot}"`,
          '-RedirectStandardOutput', `"${logPath}"`,
          '-WindowStyle', 'Hidden',
        ].join(' ');

        const child = spawn('powershell.exe', [
          '-NonInteractive',
          '-WindowStyle', 'Hidden',
          '-Command', psCmd,
        ], {
          detached: true,
          stdio:    'ignore',
        });

        child.on('error', (err) => {
          app.log.error(`[deploy] PowerShell spawn error: ${err.message}`);
        });

        child.unref();

        return { message: 'Deployment triggered! Server will pull latest code and restart in ~2 minutes. Check /api/system/deploy-log to monitor progress.' };

      } catch (error: any) {
        app.log.error(`[deploy] Failed: ${error.message}`);
        return reply.status(500).send({ error: `Failed to trigger deployment: ${error.message}` });
      }
    }
  );

  // ── GET /api/system/deploy-log ───────────────────────────────────────────────
  // Returns last 100 lines of the deploy.bat log so you can see what happened.
  // ─────────────────────────────────────────────────────────────────────────────
  app.get(
    '/system/deploy-log',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user as AuthUser;
      if (user?.role !== 'developer' && user?.role !== 'superadmin' && user?.role !== 'admin') {
        return reply.status(403).send({ error: 'Unauthorized.' });
      }

      const projectRoot = process.cwd();
      const logPath = path.join(projectRoot, 'logs', 'deploy.log');

      if (!fs.existsSync(logPath)) {
        return { log: '(No deploy log found yet. Trigger a deployment first.)', updatedAt: null };
      }

      try {
        const content = fs.readFileSync(logPath, 'utf-8');
        const lines = content.split('\n');
        const last100 = lines.slice(-100).join('\n');
        const stat = fs.statSync(logPath);
        return { log: last100, updatedAt: stat.mtime };
      } catch (err: any) {
        return reply.status(500).send({ error: `Could not read log: ${err.message}` });
      }
    }
  );
}

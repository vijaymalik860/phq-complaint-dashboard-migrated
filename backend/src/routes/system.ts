import { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthUser } from '../middleware/auth.js';
import { prisma } from '../config/database.js';


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
        // PM2 sets process.cwd() to the project root (via ecosystem.config.cjs cwd field)
        const projectRoot = process.cwd();
        const scriptPath  = path.join(projectRoot, 'deploy.bat');

        app.log.info(`[deploy] Script: ${scriptPath} | cwd: ${projectRoot}`);

        if (!fs.existsSync(scriptPath)) {
          app.log.error(`[deploy] deploy.bat NOT FOUND at: ${scriptPath}`);
          return reply.status(500).send({ error: `deploy.bat not found at: ${scriptPath}` });
        }

        // Use PowerShell Start-Process to launch deploy.bat as a FULLY DETACHED
        // process outside the parent Node.js Job Object so it survives PM2 restart.
        //
        // IMPORTANT: Do NOT use -RedirectStandardOutput here — it creates a
        // Windows file-lock conflict with deploy.bat's own file logger.
        // deploy.bat writes its own timestamped log to logs\deploy.log directly.
        const psCmd = [
          'Start-Process',
          '-FilePath',        `"${scriptPath}"`,
          '-WorkingDirectory', `"${projectRoot}"`,
          '-WindowStyle',     'Hidden',
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

      const projectRoot = process.cwd();
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
}

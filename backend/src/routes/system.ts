import { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
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

        // Use PowerShell Start-Process to launch deploy.bat as a FULLY DETACHED
        // process outside the parent Node.js Job Object so it survives PM2 restart.
        //
        // IMPORTANT: Use single quotes (') for paths to prevent PowerShell from
        // stripping double quotes when parsing the -Command string, which fails
        // on paths with spaces (e.g. "Harshit Sir Work").
        const psCmd = [
          'Start-Process',
          '-FilePath',        `'${scriptPath}'`,
          '-WorkingDirectory', `'${projectRoot}'`,
          '-WindowStyle',     'Hidden',
        ].join(' ');

        app.log.info(`[deploy] Executing PowerShell Command: ${psCmd}`);

        const child = spawn('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy', 'Bypass',
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

  // ── GET /api/system/deploy-info ──────────────────────────────────────────────
  // Diagnostic endpoint — visit this from the VM browser to verify paths.
  // URL: http://localhost:3001/api/system/deploy-info  (use your actual port)
  // ─────────────────────────────────────────────────────────────────────────────
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

      return {
        projectRoot,
        deployBatPath:    scriptPath,
        deployBatExists:  fs.existsSync(scriptPath),
        deployLogPath:    logPath,
        deployLogExists:  fs.existsSync(logPath),
        nodeVersion:      process.version,
        platform:         process.platform,
      };
    }
  );
}


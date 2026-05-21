import { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import path from 'path';
import { authenticate, AuthUser } from '../middleware/auth.js';
import { prisma } from '../config/database.js';


export async function systemRoutes(app: FastifyInstance) {
  app.post(
    '/system/trigger-deployment',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = request.user as AuthUser;
      // Basic check: must be admin or developer
      if (user?.role !== 'developer' && user?.role !== 'superadmin' && user?.role !== 'admin') {
        return reply.status(403).send({ error: 'Unauthorized. Admin or Developer access required.' });
      }

      // Avoid starting a deployment if a background sync is currently running.
      // This prevents Windows file lock exceptions (dist/ files in use by sync) 
      // and database transaction lock escalations.
      try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const activeSync = await prisma.syncRun.findFirst({
          where: {
            status: 'running',
            startedAt: { gt: oneHourAgo }
          }
        });

        if (activeSync) {
          return reply.status(409).send({
            error: 'Cannot trigger update. A database synchronization operation is currently active. Please wait for the sync to complete before updating the application code to prevent file/database locks and deployment failure.'
          });
        }
      } catch (dbError: any) {
        app.log.warn(`Deployment check for active sync failed: ${dbError.message || dbError}. Proceeding anyway.`);
      }

      try {
        // deploy.bat lives in the project ROOT (same folder as process.cwd()
        // because PM2 sets cwd to the project root via ecosystem.config.cjs).
        // Previously this was '../deploy.bat' which resolved ONE level UP — wrong!
        const projectRoot = process.cwd();
        const scriptPath = path.join(projectRoot, 'deploy.bat');

        app.log.info(`Triggering deployment script: ${scriptPath} (cwd: ${projectRoot})`);

        const child = spawn('cmd.exe', ['/c', scriptPath], {
          detached: true,
          stdio: 'ignore',
          cwd: projectRoot,   // ensure all relative paths inside deploy.bat resolve correctly
        });

        child.unref();

        return { message: 'Deployment triggered successfully! Server is pulling code and will restart shortly.' };
      } catch (error: any) {
        app.log.error(error);
        return reply.status(500).send({ error: `Failed to trigger deployment: ${error.message}` });
      }
    }
  );
}

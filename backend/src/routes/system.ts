import { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import path from 'path';
import { authenticate, AuthUser } from '../middleware/auth.js';

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

      try {
        // Spawn deploy.bat in a detached process so the HTTP request can return immediately
        // while the script runs in the background. It will restart the PM2 process.
        const scriptPath = path.resolve(process.cwd(), '../deploy.bat');
        
        const child = spawn('cmd.exe', ['/c', scriptPath], {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            DEPLOY_NO_ELEVATION: 'true'
          }
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

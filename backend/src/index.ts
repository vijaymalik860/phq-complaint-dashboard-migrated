// env reloaded: 2026-04-24
import Fastify from 'fastify';
import cors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { authRoutes } from './routes/auth.js';
import { complaintRoutes } from './routes/complaints.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { reportRoutes } from './routes/reports.js';
import { pendingRoutes } from './routes/pending.js';
import { referenceRoutes } from './routes/reference.js';
import { cctnsRoutes } from './routes/cctns.js';

import { importExportRoutes } from './routes/import-export.js';
import { governmentRoutes } from './routes/government.js';
import { systemRoutes } from './routes/system.js';
import { startCctnsBackgroundSync } from './jobs/cctns-sync-job.js';

export const app = Fastify({ logger: true });

let isBuilt = false;

export async function buildApp() {
  if (isBuilt) return app;
  
  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'phq-dashboard-secret-key-2024' });
  await app.register(multipart);

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(complaintRoutes, { prefix: '/api' });
  await app.register(dashboardRoutes, { prefix: '/api' });
  await app.register(reportRoutes, { prefix: '/api' });
  await app.register(pendingRoutes, { prefix: '/api' });
  await app.register(referenceRoutes, { prefix: '/api' });

  await app.register(cctnsRoutes, { prefix: '/api' });
  await app.register(importExportRoutes, { prefix: '/api' });
  await app.register(governmentRoutes, { prefix: '/api' });
  await app.register(systemRoutes, { prefix: '/api' });

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // ── Serve frontend static files (production) ──────────────────────────────
  const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
  if (require('fs').existsSync(frontendDist)) {
    await app.register(staticPlugin, {
      root: frontendDist,
      prefix: '/',
    });

    // SPA catch-all: serve index.html for any non-API route
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.status(404).send({ error: 'Route not found' });
        return;
      }
      const indexPath = path.join(frontendDist, 'index.html');
      if (require('fs').existsSync(indexPath)) {
        reply.type('text/html').send(require('fs').readFileSync(indexPath));
      } else {
        reply.status(404).send({ error: 'Not found' });
      }
    });
  }

  isBuilt = true;
  return app;
}
if (process.env.VERCEL !== '1') {
  buildApp().then(async () => {
    try {
      // Removed startCctnsBackgroundSync() to prevent massive data transfer on cold starts.
      const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
      await app.listen({ port, host: '0.0.0.0' });
      console.log(`✅ Server running on port ${port}`);
      
      // Start background auto-sync daemon (runs startup database cleanup)
      startCctnsBackgroundSync();
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}


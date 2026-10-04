import Fastify, { type FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { Ctx } from './platform/context';
import { toApiError } from './platform/errors';
import { registerIdempotency } from './platform/idempotency';
import { chatRoutes } from './modules/chat';
import { helpRoutes } from './modules/help';
import { identityRoutes } from './modules/identity';
import { mediaRoutes } from './modules/media';
import { notificationRoutes } from './modules/notifications';
import { problemRoutes } from './modules/problems';
import { safetyRoutes } from './modules/safety';
import { socialRoutes } from './modules/social';

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger
      ? {
          level: ctx.env.NODE_ENV === 'production' ? 'info' : 'debug',
          // Architecture §5.3: logs never contain tokens, coordinates or message bodies.
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          serializers: { req: (r) => ({ method: r.method, url: r.url.split('?')[0], id: r.id }) },
        }
      : false,
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: ctx.env.WEB_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });

  app.setErrorHandler((err, req, reply) => {
    const api = toApiError(err);
    if (api) {
      return reply.code(api.status).send({ error: { code: api.code, message: api.message, ...(api.details !== undefined ? { details: api.details } : {}) } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
    req.log?.error(err);
    ctx.log.error(`Unhandled error on ${req.method} ${req.url.split('?')[0]}`, err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } });
  });
  const webDist = ctx.env.WEB_DIST ? resolve(ctx.env.WEB_DIST) : null;
  if (webDist) {
    // One-service deployments: the API also serves the built web app (same address, no CORS).
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      setHeaders(res, filePath) {
        if (/[\\/]assets[\\/]/.test(filePath)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    // Client-side routes (/problems, /p/…) load the app shell; API paths keep their JSON 404.
    if (webDist && req.method === 'GET' && !req.url.startsWith('/v1/') && req.headers.accept?.includes('text/html')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });

  registerIdempotency(app, ctx);

  app.get('/health', async () => ({ ok: true }));
  identityRoutes(app, ctx);
  problemRoutes(app, ctx);
  helpRoutes(app, ctx);
  chatRoutes(app, ctx);
  mediaRoutes(app, ctx);
  socialRoutes(app, ctx);
  notificationRoutes(app, ctx);
  safetyRoutes(app, ctx);
  return app;
}

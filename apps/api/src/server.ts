import { migrate } from '@helpin/db';
import { buildApp } from './app';
import { createCtx } from './ctx';
import { startWorker } from './jobs/loop';
import { resolvePush } from './platform/push';
import { RealtimeHub } from './platform/realtime';

const ctx = createCtx();
if (ctx.env.NODE_ENV === 'production' && ctx.env.CODES_IN_LOGS) {
  ctx.log.warn('PRIVATE TEST MODE: sign-in codes are written to this log instead of being sent. Do not invite other people.');
}
await migrate(ctx.env.DATABASE_URL, (m) => ctx.log.info(m));
ctx.push = await resolvePush(ctx.env, ctx.db);
const hub = new RealtimeHub();
await hub.start(ctx.env.DATABASE_URL);
ctx.hub = hub;

const app = await buildApp(ctx, { logger: true });
await app.listen({ port: ctx.env.PORT, host: '0.0.0.0' });
// Small deployments run the worker inside the API process (one service to pay for).
const worker = ctx.env.RUN_WORKER ? startWorker(ctx) : null;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await worker?.stop();
    await hub.stop();
    await ctx.close();
    process.exit(0);
  });
}

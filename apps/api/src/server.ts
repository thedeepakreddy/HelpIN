import { migrate } from '@helpin/db';
import { buildApp } from './app';
import { createCtx } from './ctx';
import { RealtimeHub } from './platform/realtime';

const ctx = createCtx();
await migrate(ctx.env.DATABASE_URL, (m) => ctx.log.info(m));
const hub = new RealtimeHub();
await hub.start(ctx.env.DATABASE_URL);
ctx.hub = hub;

const app = await buildApp(ctx, { logger: true });
await app.listen({ port: ctx.env.PORT, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await hub.stop();
    await ctx.close();
    process.exit(0);
  });
}

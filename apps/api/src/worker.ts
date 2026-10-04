import { createCtx } from './ctx';
import { startWorker } from './jobs/loop';
import { resolvePush } from './platform/push';

/** The worker process (Architecture §6). See jobs/loop.ts. */
const ctx = createCtx();
ctx.push = await resolvePush(ctx.env, ctx.db);
const worker = startWorker(ctx);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await worker.stop();
    await ctx.close();
    process.exit(0);
  });
}

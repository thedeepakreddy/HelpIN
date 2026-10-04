import { randomUUID } from 'node:crypto';
import { createCtx } from './ctx';
import { cleanup, nearbyDigest, purgePrivateData, responseSweep, solveClaimReminders, withLease } from './jobs/cron';
import { drainOutbox } from './jobs/dispatcher';

/** The worker process: outbox dispatcher + scheduled jobs (Architecture §6). */
const ctx = createCtx();
const owner = `worker-${randomUUID().slice(0, 8)}`;
let stopping = false;

const MIN = 60_000;
const schedule: { name: string; everyMs: number; run: () => Promise<unknown>; last: number }[] = [
  { name: 'response-sweep', everyMs: MIN, run: () => responseSweep(ctx), last: 0 },
  { name: 'solve-reminders', everyMs: 15 * MIN, run: () => solveClaimReminders(ctx), last: 0 },
  { name: 'purge-private', everyMs: 60 * MIN, run: () => purgePrivateData(ctx), last: 0 },
  { name: 'nearby-digest', everyMs: 60 * MIN, run: () => nearbyDigest(ctx), last: 0 },
  { name: 'cleanup', everyMs: 24 * 60 * MIN, run: () => cleanup(ctx), last: 0 },
];

async function tick() {
  while (!stopping) {
    try {
      const n = await drainOutbox(ctx);
      const t = Date.now();
      for (const job of schedule) {
        if (t - job.last < job.everyMs) continue;
        job.last = t;
        await withLease(ctx, job.name, job.everyMs - 1000, owner, job.run).catch((e) => ctx.log.error(`job ${job.name} failed`, e));
      }
      if (n === 0) await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      ctx.log.error('worker loop error', e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

ctx.log.info(`HelpIn worker ${owner} started`);
void tick();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    stopping = true;
    await ctx.close();
    process.exit(0);
  });
}

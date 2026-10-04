import { randomUUID } from 'node:crypto';
import type { Ctx } from '../platform/context';
import { cleanup, nearbyDigest, purgePrivateData, responseSweep, solveClaimReminders, withLease } from './cron';
import { drainOutbox } from './dispatcher';

const MIN = 60_000;

/**
 * The worker loop: outbox dispatcher + scheduled jobs (Architecture §6). Runs in its own process
 * (`worker.ts`) or inside the API process when RUN_WORKER=true. Jobs take leases, so any number
 * of loops can run side by side safely.
 */
export function startWorker(ctx: Ctx): { owner: string; stop: () => Promise<void> } {
  const owner = `worker-${randomUUID().slice(0, 8)}`;
  let stopping = false;
  const schedule: { name: string; everyMs: number; run: () => Promise<unknown>; last: number }[] = [
    { name: 'response-sweep', everyMs: MIN, run: () => responseSweep(ctx), last: 0 },
    { name: 'solve-reminders', everyMs: 15 * MIN, run: () => solveClaimReminders(ctx), last: 0 },
    { name: 'purge-private', everyMs: 60 * MIN, run: () => purgePrivateData(ctx), last: 0 },
    { name: 'nearby-digest', everyMs: 60 * MIN, run: () => nearbyDigest(ctx), last: 0 },
    { name: 'cleanup', everyMs: 24 * 60 * MIN, run: () => cleanup(ctx), last: 0 },
  ];

  const loop = (async () => {
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
  })();

  ctx.log.info(`HelpIn worker ${owner} started`);
  return {
    owner,
    async stop() {
      stopping = true;
      await loop;
    },
  };
}

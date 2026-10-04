import { sql } from '@helpin/db';
import type { Ctx } from '../platform/context';
import { now } from '../platform/clock';
import type { DomainEvent } from '../platform/outbox';
import { handleEvent } from './consumers';

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;

/**
 * Drains the transactional outbox (Architecture §6): claims due events with SKIP LOCKED and a
 * lease, runs consumers, and retries failures with exponential backoff. After 8 attempts an
 * event is parked as `dead` for the admin.
 */
export async function drainOutbox(ctx: Ctx, batch = 25): Promise<number> {
  const t = now();
  const claimed = await sql<{ id: number; payload: DomainEvent; attempts: number }>`
    UPDATE app.outbox_events SET next_attempt_at = ${new Date(t.getTime() + LEASE_MS)}
    WHERE id IN (
      SELECT id FROM app.outbox_events
      WHERE status = 'pending' AND next_attempt_at <= ${t}
      ORDER BY next_attempt_at, id
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, payload, attempts`.execute(ctx.db);
  for (const ev of claimed.rows) {
    try {
      await handleEvent(ctx, ev.id, ev.payload);
      await ctx.db.updateTable('outbox_events').set({ status: 'done', processed_at: now(), attempts: ev.attempts + 1 }).where('id', '=', ev.id).execute();
    } catch (e) {
      const attempts = ev.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      ctx.log.error(`outbox event ${ev.id} (${ev.payload.type}) failed, attempt ${attempts}`, e);
      await ctx.db
        .updateTable('outbox_events')
        .set({
          attempts,
          status: dead ? 'dead' : 'pending',
          last_error: String((e as Error).message ?? e).slice(0, 1000),
          next_attempt_at: new Date(now().getTime() + Math.min(2 ** attempts * 1000, 3_600_000)),
        })
        .where('id', '=', ev.id)
        .execute();
    }
  }
  return claimed.rows.length;
}

/** Runs everything that's due right now (tests and the dev server use this). */
export async function drainAll(ctx: Ctx) {
  for (let i = 0; i < 50; i++) if ((await drainOutbox(ctx)) === 0) return;
}

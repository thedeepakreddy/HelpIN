import { ON_NOTICE, SOLVE_CLAIM_REMINDER_HOURS } from '@helpin/config';
import { sql } from '@helpin/db';
import { decideSweep, onNoticeUntil, type SweepProblem } from '@helpin/domain';
import type { Ctx } from '../platform/context';
import { DAY, HOUR, now } from '../platform/clock';
import { appendEvent } from '../platform/outbox';
import { onProblemTerminal, refreshKarmaCaches, systemMessage, touchProblem } from '../modules/problems';
import { deliver, notify, type Pending } from './notify';

/**
 * The response rule and lifetimes (R-50…R-58, R-57, K-12, K-13): every minute, each open problem
 * that could need action is locked and decided by the pure domain function.
 */
export async function responseSweep(ctx: Ctx): Promise<number> {
  const t = now();
  const due = await ctx.db
    .selectFrom('problems')
    .select('id')
    .where('status', '=', 'open')
    .where((eb) =>
      eb.or([
        eb('max_life_at', '<=', t),
        eb.and([
          eb('kind', '=', 'request'),
          eb('response_due_at', 'is not', null),
          eb.or([eb('response_due_at', '<=', new Date(t.getTime() + 24 * HOUR)), eb('last_activity_at', '<=', new Date(t.getTime() - 48 * HOUR))]),
        ]),
      ]),
    )
    .limit(500)
    .execute();
  let acted = 0;
  for (const { id } of due) {
    const changed = await ctx.db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('problems').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p || p.status !== 'open') return false;
      const penalties = await tx
        .selectFrom('karma_entries')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('user_id', '=', p.owner_id)
        .where('reason', '=', 'abandonment_penalty')
        .where('created_at', '>', new Date(t.getTime() - ON_NOTICE.penaltyWindowDays * DAY))
        .executeTakeFirst();
      const snapshot: SweepProblem = {
        kind: p.kind as SweepProblem['kind'],
        status: 'open',
        responseDueAt: p.response_due_at,
        reminderStage: p.reminder_stage,
        lastActivityAt: p.last_activity_at,
        penalizedAt: p.penalized_at,
        maxLifeAt: p.max_life_at,
        hidden: !!p.hidden_at,
      };
      const d = decideSweep(snapshot, penalties?.n ?? 0, t);
      if (!d.reminder && !d.penalty && !d.terminal) return false;
      if (d.reminder) {
        await tx.updateTable('problems').set({ reminder_stage: d.reminder }).where('id', '=', id).execute();
        await appendEvent(tx, { type: 'ResponseReminder', problemId: id, stage: d.reminder });
      }
      if (d.penalty) {
        // K-12: at most once per problem (also enforced by a unique index).
        const ins = await tx
          .insertInto('karma_entries')
          .values({ user_id: p.owner_id, amount: d.penalty.amount, reason: 'abandonment_penalty', problem_id: id, created_at: t })
          .onConflict((oc) => oc.column('problem_id').where('reason', '=', 'abandonment_penalty').doNothing())
          .returning('id')
          .executeTakeFirst();
        await tx.updateTable('problems').set({ penalized_at: t }).where('id', '=', id).execute();
        if (ins) {
          if (d.penalty.putOnNotice) await tx.updateTable('users').set({ on_notice_until: onNoticeUntil(t) }).where('id', '=', p.owner_id).execute();
          await refreshKarmaCaches(tx, [p.owner_id]);
          await appendEvent(tx, { type: 'RaiserPenalized', problemId: id, amount: d.penalty.amount, onNotice: d.penalty.putOnNotice });
        }
      }
      if (d.terminal) {
        await tx.updateTable('problems').set({ status: d.terminal, closed_at: t }).where('id', '=', id).where('status', '=', 'open').execute();
        await onProblemTerminal(tx, id, p.incident_id);
        await systemMessage(tx, id, d.terminal === 'expired' ? 'This problem reached its time limit.' : 'This problem was removed after 2 days without activity.');
        await appendEvent(tx, { type: 'ProblemClosed', problemId: id, status: d.terminal });
      }
      await touchProblem(tx, id);
      return true;
    });
    if (changed) acted++;
  }
  return acted;
}

/** R-14: remind the asker 24 h and 72 h after a helper said it's solved. */
export async function solveClaimReminders(ctx: Ctx) {
  const t = now();
  const rows = await ctx.db
    .selectFrom('help_offers as o')
    .innerJoin('problems as p', 'p.id', 'o.problem_id')
    .select(['o.id', 'o.claimed_solved_at', 'p.id as problem_id', 'p.owner_id', 'p.title'])
    .where('o.status', '=', 'accepted')
    .where('o.claimed_solved_at', 'is not', null)
    .where('p.status', '=', 'open')
    .execute();
  const pending: Pending[] = [];
  for (const r of rows) {
    const sent = await ctx.db
      .selectFrom('notifications')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('user_id', '=', r.owner_id)
      .where('type', '=', 'solve_claimed')
      .where(sql<boolean>`payload->>'problemId' = ${r.problem_id}`)
      .where('created_at', '>=', r.claimed_solved_at!)
      .executeTakeFirst();
    const elapsedH = (t.getTime() - r.claimed_solved_at!.getTime()) / HOUR;
    const due = SOLVE_CLAIM_REMINDER_HOURS.filter((h) => elapsedH >= h).length + 1; // first one is sent on claim
    if ((sent?.n ?? 0) < due) {
      await notify(ctx.db, r.owner_id, 'solve_claimed', { title: 'Is it solved?', body: `${r.title} · Tap to confirm and thank your helper.`, link: `/p/${r.problem_id}`, problemId: r.problem_id }, pending);
    }
  }
  await deliver(ctx, pending);
}

/** L-07: hard-delete exact locations a week after problems end. */
export async function purgePrivateData(ctx: Ctx) {
  const t = now();
  const a = await ctx.db.deleteFrom('problem_private_locations').where('purge_after', '<=', t).executeTakeFirst();
  const b = await ctx.db.deleteFrom('messages').where('type', '=', 'location').where('purge_after', '<=', t).executeTakeFirst();
  return Number(a.numDeletedRows) + Number(b.numDeletedRows);
}

/** Housekeeping: orphaned uploads, old outbox rows, idempotency keys, OTPs, counters. */
export async function cleanup(ctx: Ctx) {
  const t = now();
  const orphans = await ctx.db.selectFrom('media').select('id').where('status', '=', 'pending').where('created_at', '<', new Date(t.getTime() - DAY)).execute();
  for (const m of orphans) {
    await ctx.storage.remove(`quarantine/${m.id}`);
    await ctx.db.updateTable('media').set({ status: 'deleted' }).where('id', '=', m.id).execute();
  }
  await ctx.db.deleteFrom('outbox_events').where('status', '=', 'done').where('processed_at', '<', new Date(t.getTime() - 14 * DAY)).execute();
  await ctx.db.deleteFrom('idempotency_keys').where('created_at', '<', new Date(t.getTime() - 2 * DAY)).execute();
  await ctx.db.deleteFrom('otp_challenges').where('created_at', '<', new Date(t.getTime() - DAY)).execute();
  await ctx.db.deleteFrom('rate_limit_counters').where('window_start', '<', new Date(t.getTime() - 2 * DAY)).execute();
  await ctx.db.deleteFrom('rate_limit_keys').where('window_start', '<', new Date(t.getTime() - 2 * DAY)).execute();
}

/** §8.1: nearby alerts for people without push arrive as an hourly email digest. */
export async function nearbyDigest(ctx: Ctx) {
  const since = new Date(now().getTime() - 2 * HOUR);
  const rows = await ctx.db
    .selectFrom('notifications as n')
    .innerJoin('users as u', 'u.id', 'n.user_id')
    .innerJoin('alert_prefs as a', 'a.user_id', 'n.user_id')
    .select(['n.id', 'n.user_id', 'n.payload', 'u.email'])
    .where('n.type', '=', 'nearby_problem')
    .where('n.pushed', '=', false)
    .where('n.read_at', 'is', null)
    .where('n.created_at', '>', since)
    .where('a.email_digest', '=', true)
    .where('u.email', 'is not', null)
    .execute();
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  for (const [, list] of byUser) {
    const lines = list.map((n) => `• ${(n.payload as { title: string }).title}`).join('\n');
    await ctx.email.send(list[0]!.email!, `${list.length} neighbour${list.length > 1 ? 's' : ''} near you need help`, `${lines}\n\nOpen HelpIn: ${ctx.env.WEB_URL}/problems`);
    await ctx.db.updateTable('notifications').set({ pushed: true }).where('id', 'in', list.map((n) => n.id)).execute();
  }
}

/** Single-runner cron via a lease row (Architecture §6). */
export async function withLease(ctx: Ctx, job: string, ttlMs: number, owner: string, fn: () => Promise<unknown>) {
  const t = now();
  const got = await sql<{ job_name: string }>`
    INSERT INTO app.job_leases (job_name, locked_until, locked_by) VALUES (${job}, ${new Date(t.getTime() + ttlMs)}, ${owner})
    ON CONFLICT (job_name) DO UPDATE SET locked_until = EXCLUDED.locked_until, locked_by = EXCLUDED.locked_by
    WHERE app.job_leases.locked_until < ${t} OR app.job_leases.locked_by = ${owner}
    RETURNING job_name`.execute(ctx.db);
  if (!got.rows.length) return;
  await fn();
}

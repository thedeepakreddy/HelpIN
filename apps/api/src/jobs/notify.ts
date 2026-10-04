import type { Db, Tx } from '@helpin/db';
import type { Ctx } from '../platform/context';
import { now } from '../platform/clock';
import type { PushPayload } from '../platform/push';
import { publish } from '../platform/realtime';
import type { NotificationPayload } from '../modules/notifications';

export type NotificationType =
  | 'response_due'
  | 'solve_claimed'
  | 'karma'
  | 'nearby_problem'
  | 'offer_received'
  | 'offer_accepted'
  | 'offer_declined'
  | 'problem_updated'
  | 'problem_closed'
  | 'penalty'
  | 'community'
  | 'message'
  | 'tag_request'
  | 'comment'
  | 'content_removed'
  | 'system';

/** Types important enough to email right away when someone has no push subscription. */
const EMAIL_NOW: NotificationType[] = ['response_due', 'offer_accepted', 'solve_claimed', 'penalty', 'content_removed', 'offer_received'];

const ACTIONS: Partial<Record<NotificationType, PushPayload['actions']>> = {
  response_due: [
    { action: 'still', title: 'Still need help' },
    { action: 'solved', title: "It's solved" },
  ],
  solve_claimed: [{ action: 'solved', title: 'Confirm solved' }],
};

export interface Pending {
  id: string;
  userId: string;
  type: NotificationType;
  payload: NotificationPayload;
}

/** Inserts an in-app notification (always) and returns it for push/email delivery after commit. */
export async function notify(tx: Tx | Db, userId: string, type: NotificationType, payload: NotificationPayload, out: Pending[]) {
  const row = await tx.insertInto('notifications').values({ user_id: userId, type, payload: JSON.stringify(payload), created_at: now() }).returning('id').executeTakeFirstOrThrow();
  await publish(tx, [userId], { type: 'notification' });
  out.push({ id: row.id, userId, type, payload });
}

/**
 * Delivers notifications through Web Push, or email for important ones when the person has no
 * push subscription (Architecture §8.1). Nearby alerts without push go into the hourly digest.
 */
export async function deliver(ctx: Ctx, pending: Pending[]) {
  for (const n of pending) {
    const subs = await ctx.db.selectFrom('push_subscriptions').select(['id', 'endpoint', 'keys']).where('user_id', '=', n.userId).execute();
    let pushed = false;
    for (const s of subs) {
      try {
        const ok = await ctx.push.send(
          { endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } },
          { title: n.payload.title, body: n.payload.body, url: n.payload.link, tag: `${n.type}:${n.payload.problemId ?? n.id}`, actions: ACTIONS[n.type] },
        );
        if (ok) pushed = true;
        else await ctx.db.deleteFrom('push_subscriptions').where('id', '=', s.id).execute();
      } catch (e) {
        ctx.log.warn(`push failed: ${(e as Error).message}`);
      }
    }
    if (pushed) {
      await ctx.db.updateTable('notifications').set({ pushed: true }).where('id', '=', n.id).execute();
      continue;
    }
    if (EMAIL_NOW.includes(n.type)) {
      const user = await ctx.db.selectFrom('users').select('email').where('id', '=', n.userId).executeTakeFirst();
      if (user?.email) {
        await ctx.email.send(user.email, n.payload.title, `${n.payload.body}\n\nOpen HelpIn: ${ctx.env.WEB_URL}${n.payload.link}`).catch((e) => ctx.log.warn(`email failed: ${(e as Error).message}`));
        await ctx.db.updateTable('notifications').set({ pushed: true }).where('id', '=', n.id).execute();
      }
    }
  }
}

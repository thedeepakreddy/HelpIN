import { KARMA, NEARBY_ALERTS, RESPONSE_RULE, URGENCY, type Urgency } from '@helpin/config';
import { sql, type Tx } from '@helpin/db';
import { gridDistance } from 'h3-js';
import { ringCells } from '@helpin/geo';
import type { Ctx } from '../platform/context';
import { HOUR, now } from '../platform/clock';
import type { DomainEvent } from '../platform/outbox';
import { appendEvent } from '../platform/outbox';
import { processMedia } from '../modules/media';
import { deliver, notify, type Pending } from './notify';

type Handler<E extends DomainEvent = DomainEvent> = (tx: Tx, event: E, out: Pending[], ctx: Ctx) => Promise<void>;

async function names(tx: Tx, ids: string[]) {
  const rows = ids.length ? await tx.selectFrom('profiles').select(['user_id', 'display_name']).where('user_id', 'in', ids).execute() : [];
  return (id: string) => rows.find((r) => r.user_id === id)?.display_name.split(' ')[0] ?? 'A neighbour';
}

async function problemOf(tx: Tx, id: string) {
  return tx.selectFrom('problems').select(['id', 'title', 'owner_id', 'is_anonymous', 'kind', 'urgency', 'category', 'cell_r7', 'status', 'response_due_at', 'language_needed']).where('id', '=', id).executeTakeFirst();
}

async function activeHelpers(tx: Tx, problemId: string, statuses = ['offered', 'accepted']) {
  return (await tx.selectFrom('help_offers').select('helper_id').where('problem_id', '=', problemId).where('status', 'in', statuses).execute()).map((r) => r.helper_id);
}

/** R-43: don't send the same kind of notification about the same thing too often. */
async function recentlyNotified(tx: Tx, userId: string, type: string, problemId: string, withinMs: number) {
  const row = await tx
    .selectFrom('notifications')
    .select('id')
    .where('user_id', '=', userId)
    .where('type', '=', type)
    .where(sql<boolean>`payload->>'problemId' = ${problemId}`)
    .where('created_at', '>', new Date(now().getTime() - withinMs))
    .executeTakeFirst();
  return !!row;
}

const link = (problemId: string) => `/p/${problemId}`;

/* ------------------------------------------------------------------ Transactional notifications (§8.3) */

const handlers: { [K in DomainEvent['type']]?: Handler<Extract<DomainEvent, { type: K }>> } = {
  async HelpOffered(tx, e, out) {
    const o = await tx.selectFrom('help_offers').select(['helper_id', 'problem_id', 'message']).where('id', '=', e.offerId).executeTakeFirst();
    const p = o && (await problemOf(tx, o.problem_id));
    if (!o || !p) return;
    const name = await names(tx, [o.helper_id]);
    await notify(tx, p.owner_id, 'offer_received', { title: `${name(o.helper_id)} can help with “${p.title}”`, body: o.message ? `“${o.message.slice(0, 120)}”` : 'Tap to see the offer', link: link(p.id), problemId: p.id }, out);
  },

  async OfferAccepted(tx, e, out) {
    const o = await tx.selectFrom('help_offers').select(['helper_id', 'problem_id']).where('id', '=', e.offerId).executeTakeFirst();
    const p = o && (await problemOf(tx, o.problem_id));
    if (!o || !p) return;
    const name = await names(tx, [p.owner_id]);
    await notify(tx, o.helper_id, 'offer_accepted', { title: `${p.is_anonymous ? 'The asker' : name(p.owner_id)} accepted your help`, body: `${p.title} · Say hi 👋`, link: `/chat/${e.conversationId}`, problemId: p.id }, out);
  },

  async OfferDeclined(tx, e, out) {
    const o = await tx.selectFrom('help_offers').select(['helper_id', 'problem_id']).where('id', '=', e.offerId).executeTakeFirst();
    const p = o && (await problemOf(tx, o.problem_id));
    if (!o || !p) return;
    await notify(tx, o.helper_id, 'offer_declined', { title: 'The asker chose other helpers this time', body: `${p.title} · Thank you for offering!`, link: link(p.id), problemId: p.id }, out);
  },

  async MessageSent(tx, e, out) {
    const m = await tx.selectFrom('messages').select(['sender_id', 'type', 'body']).where('id', '=', e.messageId).executeTakeFirst();
    if (!m?.sender_id) return;
    const parts = await tx.selectFrom('conversation_participants').select('user_id').where('conversation_id', '=', e.conversationId).execute();
    const conv = await tx.selectFrom('conversations as c').innerJoin('problems as p', 'p.id', 'c.problem_id').select(['p.id', 'p.owner_id', 'p.is_anonymous']).where('c.id', '=', e.conversationId).executeTakeFirstOrThrow();
    const asker = await tx.selectFrom('conversation_participants').select('identity_revealed_at').where('conversation_id', '=', e.conversationId).where('user_id', '=', conv.owner_id).executeTakeFirst();
    const name = await names(tx, [m.sender_id]);
    const senderLabel = m.sender_id === conv.owner_id && conv.is_anonymous && !asker?.identity_revealed_at ? 'Anonymous neighbour' : name(m.sender_id);
    for (const { user_id } of parts) {
      if (user_id === m.sender_id) continue;
      // One unread chat notification per conversation is enough.
      const unread = await tx
        .selectFrom('notifications')
        .select('id')
        .where('user_id', '=', user_id)
        .where('type', '=', 'message')
        .where('read_at', 'is', null)
        .where(sql<boolean>`payload->>'link' = ${`/chat/${e.conversationId}`}`)
        .executeTakeFirst();
      if (unread) continue;
      const body = m.type === 'text' ? (m.body ?? '').slice(0, 140) : m.type === 'image' ? '📷 Photo' : '📍 Exact location';
      await notify(tx, user_id, 'message', { title: `${senderLabel} sent you a message`, body, link: `/chat/${e.conversationId}`, problemId: conv.id }, out);
    }
  },

  async SolveClaimed(tx, e, out) {
    const o = await tx.selectFrom('help_offers').select(['helper_id', 'problem_id']).where('id', '=', e.offerId).executeTakeFirst();
    const p = o && (await problemOf(tx, o.problem_id));
    if (!o || !p) return;
    const name = await names(tx, [o.helper_id]);
    await notify(tx, p.owner_id, 'solve_claimed', { title: `${name(o.helper_id)} thinks your problem is solved`, body: `${p.title} · Tap to confirm and say thanks`, link: link(p.id), problemId: p.id }, out);
  },

  async ProblemSolved(tx, e, out) {
    const p = await problemOf(tx, e.problemId);
    if (!p) return;
    const helpers = await activeHelpers(tx, p.id, ['closed']);
    for (const h of helpers) await notify(tx, h, 'problem_closed', { title: `“${p.title}” is solved`, body: 'Thank you for offering to help.', link: link(p.id), problemId: p.id }, out);
    if (p.kind === 'issue') {
      const affected = await tx
        .selectFrom('incident_affected as a')
        .innerJoin('problems as pr', 'pr.incident_id', 'a.incident_id')
        .select('a.user_id')
        .where('pr.id', '=', p.id)
        .execute();
      for (const a of affected) await notify(tx, a.user_id, 'problem_closed', { title: `Fixed: ${p.title}`, body: 'Neighbours confirmed it’s sorted.', link: link(p.id), problemId: p.id }, out);
    }
    if (e.via === 'fixed_quorum') {
      await notify(tx, p.owner_id, 'problem_closed', { title: 'Neighbours confirmed it’s fixed', body: `${p.title} · You can thank helpers for the next 72 hours.`, link: link(p.id), problemId: p.id }, out);
    }
  },

  async HelperCredited(tx, e, out) {
    const p = await problemOf(tx, e.problemId);
    if (!p) return;
    const name = await names(tx, [p.owner_id]);
    const who = p.is_anonymous ? 'The asker' : name(p.owner_id);
    await notify(
      tx,
      e.helperId,
      'karma',
      e.amount > 0
        ? { title: `🎉 +${e.amount} karma`, body: `${who} confirmed you helped with “${p.title}”`, link: '/profile', problemId: p.id }
        : { title: 'Thank you for helping', body: `${who} confirmed you helped with “${p.title}”`, link: '/profile', problemId: p.id },
      out,
    );
  },

  async AskerClosingAward(tx, e, out) {
    const p = await problemOf(tx, e.problemId);
    if (!p) return;
    await notify(tx, p.owner_id, 'karma', { title: `+${e.amount} karma for closing your problem`, body: p.title, link: '/profile', problemId: p.id }, out);
  },

  async ProblemUpdated(tx, e, out) {
    const p = await problemOf(tx, e.problemId);
    const u = await tx.selectFrom('problem_updates').select(['author_id', 'author_role', 'progress_status', 'body']).where('id', '=', e.updateId).executeTakeFirst();
    if (!p || !u) return;
    const name = await names(tx, [u.author_id]);
    const status = u.progress_status.replace(/_/g, ' ');
    const summary = u.body ? `${status}: ${u.body.slice(0, 100)}` : status;
    let recipients: string[];
    if (u.author_role === 'asker') {
      recipients = await activeHelpers(tx, p.id);
      if (p.kind === 'issue') {
        const affected = await tx.selectFrom('incident_affected as a').innerJoin('problems as pr', 'pr.incident_id', 'a.incident_id').select('a.user_id').where('pr.id', '=', p.id).execute();
        recipients.push(...affected.map((a) => a.user_id));
      }
    } else {
      recipients = [p.owner_id];
    }
    const author = u.author_role === 'asker' && p.is_anonymous ? 'The asker' : name(u.author_id);
    for (const r of new Set(recipients)) {
      if (r === u.author_id) continue;
      // R-43: at most one update notification per problem per 30 minutes.
      if (await recentlyNotified(tx, r, 'problem_updated', p.id, 30 * 60_000)) continue;
      await notify(tx, r, 'problem_updated', { title: `${author} updated “${p.title}”`, body: summary, link: link(p.id), problemId: p.id }, out);
    }
  },

  async ProblemClosed(tx, e, out) {
    const p = await problemOf(tx, e.problemId);
    if (!p) return;
    const copy: Record<string, string> = {
      abandoned: 'Removed: nobody was active for 2 days.',
      expired: 'This problem reached its time limit.',
      withdrawn: 'The asker withdrew this problem.',
      removed: 'This problem was removed by moderation.',
    };
    for (const h of await activeHelpers(tx, p.id, ['closed'])) {
      await notify(tx, h, 'problem_closed', { title: `“${p.title}” was closed`, body: copy[e.status] ?? '', link: link(p.id), problemId: p.id }, out);
    }
    if (e.status === 'expired' || e.status === 'abandoned') {
      await notify(
        tx,
        p.owner_id,
        'problem_closed',
        { title: e.status === 'expired' ? 'Your problem expired' : 'Your problem was removed for inactivity', body: `${p.title} · Post again if you still need help.`, link: link(p.id), problemId: p.id },
        out,
      );
    }
  },

  async ResponseReminder(tx, e, out) {
    const p = await problemOf(tx, e.problemId);
    if (!p || p.status !== 'open') return;
    const first = await tx.selectFrom('help_offers').select('helper_id').where('problem_id', '=', p.id).where('status', 'in', ['offered', 'accepted']).orderBy('created_at').executeTakeFirst();
    const name = await names(tx, first ? [first.helper_id] : []);
    const [, second] = RESPONSE_RULE.reminderHours;
    await notify(
      tx,
      p.owner_id,
      'response_due',
      e.stage === 1
        ? { title: `${first ? name(first.helper_id) : 'A neighbour'} offered to help and is waiting for you`, body: `${p.title} · Reply, update or say you still need help.`, link: link(p.id), problemId: p.id }
        : { title: `${RESPONSE_RULE.windowHours - second} hours left before you lose ${-KARMA.abandonmentPenalties[0]} karma`, body: `${p.title} · One tap is enough: “Still need help”.`, link: link(p.id), problemId: p.id },
      out,
    );
  },

  async RaiserPenalized(tx, e, out) {
    const p = await problemOf(tx, e.problemId);
    if (!p) return;
    await notify(
      tx,
      p.owner_id,
      'penalty',
      {
        title: `You didn't respond for 2 days (${e.amount} karma)`,
        body: e.onNotice ? `${p.title} · You can post one problem per day for the next 14 days.` : `${p.title} · Helpers are still there if you reply.`,
        link: link(p.id),
        problemId: p.id,
      },
      out,
    );
    // The problem may have been abandoned in the same sweep, which closes the offers.
    for (const h of await activeHelpers(tx, p.id, ['offered', 'accepted', 'closed'])) {
      await notify(tx, h, 'problem_updated', { title: "The asker hasn't responded in 2 days", body: p.title, link: link(p.id), problemId: p.id }, out);
    }
  },

  async AffectedAdded(tx, e, out) {
    const p = await problemOf(tx, e.problemId);
    if (!p) return;
    // Batched hourly per reporter.
    if (await recentlyNotified(tx, p.owner_id, 'community', p.id, HOUR)) return;
    const inc = await tx.selectFrom('problems as pr').innerJoin('incidents as i', 'i.id', 'pr.incident_id').select('i.affected_count').where('pr.id', '=', p.id).executeTakeFirst();
    await notify(tx, p.owner_id, 'community', { title: 'More neighbours are affected', body: `${inc?.affected_count ?? 2} neighbours say “same here” on ${p.title}`, link: link(p.id), problemId: p.id }, out);
  },

  async PostTagged(tx, e, out) {
    const post = await tx.selectFrom('posts as po').leftJoin('problems as p', 'p.id', 'po.problem_id').select(['po.author_id', 'p.is_anonymous']).where('po.id', '=', e.postId).executeTakeFirst();
    if (!post) return;
    const name = await names(tx, [post.author_id]);
    await notify(tx, e.userId, 'tag_request', { title: `${post.is_anonymous ? 'A neighbour' : name(post.author_id)} thanked you publicly`, body: 'Show your name on the thank-you post?', link: `/community?post=${e.postId}` }, out);
  },

  async CommentAdded(tx, e, out) {
    const c = await tx.selectFrom('comments as c').innerJoin('posts as p', 'p.id', 'c.post_id').select(['c.author_id', 'c.body', 'p.author_id as post_author', 'p.id as post_id']).where('c.id', '=', e.commentId).executeTakeFirst();
    if (!c) return;
    const name = await names(tx, [c.author_id]);
    await notify(tx, c.post_author, 'comment', { title: `${name(c.author_id)} commented on your post`, body: c.body.slice(0, 120), link: `/community?post=${c.post_id}` }, out);
  },

  async ContentRemoved(tx, e, out) {
    const a = await tx.selectFrom('moderation_actions').selectAll().where('id', '=', e.moderationActionId).executeTakeFirst();
    if (!a) return;
    const what = a.action === 'restrict_user' ? 'Your account was restricted' : 'We removed something you posted';
    // S-09 / DSA: statement of reasons, with the right to appeal.
    await notify(
      tx,
      e.userId,
      'content_removed',
      { title: what, body: a.statement_of_reasons ?? a.reason, link: '/notifications', moderationActionId: a.id },
      out,
    );
  },

  async KarmaReversed(tx, e, out) {
    await notify(tx, e.userId, 'karma', { title: 'Your karma was adjusted', body: 'A moderator corrected an earlier karma entry.', link: '/profile' }, out);
  },
};

/* ------------------------------------------------------------------ Nearby fan-out (§8.2) */

function inQuietHours(start: string | null, end: string | null, at: Date): boolean {
  if (!start || !end) return false;
  const local = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Budapest' }).format(at);
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  return s <= e ? local >= s && local < e : local >= s || local < e;
}

export async function nearbyCandidates(tx: Tx, problemId: string): Promise<string[]> {
  const p = await problemOf(tx, problemId);
  if (!p || p.status !== 'open') return [];
  const t = now();
  const ring2 = ringCells(p.cell_r7, 2);
  const rows = await tx
    .selectFrom('profiles as pr')
    .innerJoin('users as u', 'u.id', 'pr.user_id')
    .innerJoin('alert_prefs as a', 'a.user_id', 'pr.user_id')
    .select(['pr.user_id', 'pr.home_cell_r7', 'pr.languages', 'a.ring', 'a.categories', 'a.min_urgency', 'a.daily_cap', 'a.quiet_start', 'a.quiet_end', 'a.serious_in_quiet', 'a.enabled'])
    .where('pr.home_cell_r7', 'in', ring2)
    .where('u.status', '=', 'active')
    .where('u.onboarded_at', 'is not', null)
    .where('pr.user_id', '!=', p.owner_id)
    .where('a.enabled', '=', true)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('blocks as b')
            .select('b.blocker_id')
            .where((x) => x.or([x.and([x('b.blocker_id', '=', x.ref('pr.user_id')), x('b.blocked_id', '=', p.owner_id)]), x.and([x('b.blocked_id', '=', x.ref('pr.user_id')), x('b.blocker_id', '=', p.owner_id)])])),
        ),
      ),
    )
    .execute();
  const today = new Date(t.getTime() - 24 * HOUR);
  const counts = rows.length
    ? await tx
        .selectFrom('notifications')
        .select(['user_id', sql<number>`count(*)::int`.as('n')])
        .where('type', '=', 'nearby_problem')
        .where('created_at', '>', today)
        .where('user_id', 'in', rows.map((r) => r.user_id))
        .groupBy('user_id')
        .execute()
    : [];
  const recentHelpers = new Set(
    rows.length
      ? (
          await tx
            .selectFrom('help_offers')
            .select('helper_id')
            .where('helper_id', 'in', rows.map((r) => r.user_id))
            .where('created_at', '>', new Date(t.getTime() - 30 * 24 * HOUR))
            .execute()
        ).map((r) => r.helper_id)
      : [],
  );
  const serious = p.urgency === 'serious';
  const [langFrom, langTo] = (p.language_needed ?? '').split('>');
  const eligible = rows.filter((r) => {
    const ring = gridDistance(p.cell_r7, r.home_cell_r7!);
    if (ring > r.ring) return false;
    // LANG-03: people who speak both languages hear about language help even outside their categories.
    const speaks = !!langFrom && r.languages.includes(langFrom) && r.languages.includes(langTo ?? '');
    if (r.categories.length && !r.categories.includes(p.category) && !speaks) return false;
    if (URGENCY[p.urgency as Urgency].order < URGENCY[r.min_urgency as Urgency].order) return false;
    if (!serious && (counts.find((c) => c.user_id === r.user_id)?.n ?? 0) >= r.daily_cap) return false;
    if (inQuietHours(r.quiet_start, r.quiet_end, t) && !(serious && r.serious_in_quiet)) return false;
    return true;
  });
  // Rank: closest ring, then recent helpers, then random (spreads load across helpers).
  return eligible
    .map((r) => ({ id: r.user_id, ring: gridDistance(p.cell_r7, r.home_cell_r7!), recent: recentHelpers.has(r.user_id) ? 0 : 1, rnd: Math.random() }))
    .sort((a, b) => a.ring - b.ring || a.recent - b.recent || a.rnd - b.rnd)
    .map((r) => r.id);
}

async function sendNearby(tx: Tx, problemId: string, userIds: string[], out: Pending[]) {
  const p = await problemOf(tx, problemId);
  if (!p) return;
  const inc = await tx.selectFrom('incidents as i').innerJoin('problems as pr', 'pr.incident_id', 'i.id').select('i.locality').where('pr.id', '=', problemId).executeTakeFirst();
  const lang = p.language_needed ? ` · ${p.language_needed.replace('>', ' → ').toUpperCase()}` : '';
  for (const id of userIds) {
    await notify(tx, id, 'nearby_problem', { title: p.urgency === 'serious' ? `Serious, nearby: ${p.title}` : `New nearby: ${p.title}`, body: `${inc?.locality ?? 'Near you'}${lang}`, link: link(p.id), problemId: p.id }, out);
  }
}

handlers.ProblemCreated = async (tx, e, out) => {
  const candidates = await nearbyCandidates(tx, e.problemId);
  // COM-03: members of communities this problem was shared to, who opted in to alerts.
  const community = await tx
    .selectFrom('community_problem_shares as s')
    .innerJoin('community_members as m', 'm.community_id', 's.community_id')
    .select('m.user_id')
    .where('s.problem_id', '=', e.problemId)
    .where('m.alerts', '=', true)
    .execute();
  const p = await problemOf(tx, e.problemId);
  const first = [...new Set([...candidates.slice(0, NEARBY_ALERTS.firstWave), ...community.map((c) => c.user_id)])].filter((id) => id !== p?.owner_id);
  await sendNearby(tx, e.problemId, first, out);
  if (candidates.length > first.length || first.length < NEARBY_ALERTS.sparseThreshold) {
    await appendEvent(tx, { type: 'NearbySecondWave', problemId: e.problemId, notified: first }, { delayMs: NEARBY_ALERTS.secondWaveAfterMinutes * 60_000 });
  }
};

handlers.NearbySecondWave = async (tx, e, out) => {
  const offers = await tx.selectFrom('help_offers').select('id').where('problem_id', '=', e.problemId).executeTakeFirst();
  if (offers) return; // someone already offered
  const already = new Set(e.notified);
  const next = (await nearbyCandidates(tx, e.problemId)).filter((id) => !already.has(id)).slice(0, NEARBY_ALERTS.firstWave);
  await sendNearby(tx, e.problemId, next, out);
};

/* ------------------------------------------------------------------ Dispatch */

export async function handleEvent(ctx: Ctx, eventId: number, event: DomainEvent): Promise<void> {
  if (event.type === 'MediaUploaded') {
    await processMedia(ctx, event.mediaId);
    return;
  }
  const handler = handlers[event.type] as Handler | undefined;
  if (!handler) return;
  const pending: Pending[] = [];
  await ctx.db.transaction().execute(async (tx) => {
    // Consumer idempotency: an event is handled once even if delivery repeats.
    const fresh = await tx
      .insertInto('outbox_deliveries')
      .values({ event_id: eventId, consumer: 'notifications', delivered_at: now() })
      .onConflict((oc) => oc.columns(['event_id', 'consumer']).doNothing())
      .returning('event_id')
      .executeTakeFirst();
    if (!fresh) return;
    await handler(tx, event, pending, ctx);
  });
  await deliver(ctx, pending);
}

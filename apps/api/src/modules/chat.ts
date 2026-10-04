import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CHAT_GRACE_HOURS, LIMITS, RATE_LIMITS } from '@helpin/config';
import type { Asker, Conversation, Message } from '@helpin/contracts';
import { sql } from '@helpin/db';
import { isConversationWritable } from '@helpin/domain';
import { requireUser } from '../platform/auth';
import { now } from '../platform/clock';
import type { Ctx } from '../platform/context';
import { badRequest, forbidden, notFound } from '../platform/errors';
import { parse } from '../platform/http';
import { appendEvent } from '../platform/outbox';
import { rateLimit } from '../platform/ratelimit';
import { publish } from '../platform/realtime';
import { isBlockedEitherWay, mediaRefs, publicUsers, reliabilities } from '../views';
import { raiserResponded } from './problems';

interface ConvRow {
  id: string;
  problem_id: string;
  read_only_at: Date | null;
  title: string;
  status: string;
  closed_at: Date | null;
  owner_id: string;
  is_anonymous: boolean;
  helper_id: string;
}

const CONV_COLUMNS = [
  'c.id',
  'c.problem_id',
  'c.read_only_at',
  'p.title',
  'p.status',
  'p.closed_at',
  'p.owner_id',
  'p.is_anonymous',
  'o.helper_id',
] as const;

function previewOf(m: { type: string; body: string | null; status: string } | undefined): string | null {
  if (!m) return null;
  if (m.status !== 'visible') return 'Message removed';
  if (m.type === 'image') return '📷 Photo';
  if (m.type === 'location') return '📍 Exact location';
  return m.body;
}

async function presentConversations(ctx: Ctx, rows: ConvRow[], viewerId: string): Promise<Conversation[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [participants, lastMessages, unread] = await Promise.all([
    ctx.db.selectFrom('conversation_participants').selectAll().where('conversation_id', 'in', ids).execute(),
    ctx.db
      .selectFrom('messages')
      .distinctOn('conversation_id')
      .select(['conversation_id', 'type', 'body', 'status', 'created_at'])
      .where('conversation_id', 'in', ids)
      .orderBy('conversation_id')
      .orderBy('id', 'desc')
      .execute(),
    ctx.db
      .selectFrom('messages as m')
      .innerJoin('conversation_participants as cp', (j) => j.onRef('cp.conversation_id', '=', 'm.conversation_id').on('cp.user_id', '=', viewerId))
      .select(['m.conversation_id', sql<number>`count(*)::int`.as('n')])
      .where('m.conversation_id', 'in', ids)
      .where((eb) => eb.or([eb('m.sender_id', 'is', null), eb('m.sender_id', '!=', viewerId)]))
      .where((eb) => eb.or([eb('cp.last_read_message_id', 'is', null), eb('m.id', '>', eb.ref('cp.last_read_message_id'))]))
      .groupBy('m.conversation_id')
      .execute(),
  ]);
  const others = rows.map((r) => (r.owner_id === viewerId ? r.helper_id : r.owner_id));
  const [users, rel] = await Promise.all([publicUsers(ctx, others), reliabilities(ctx, others)]);
  const t = now();
  const out: Conversation[] = [];
  for (const r of rows) {
    const viewerIsAsker = r.owner_id === viewerId;
    const otherId = viewerIsAsker ? r.helper_id : r.owner_id;
    const askerPart = participants.find((p) => p.conversation_id === r.id && p.user_id === r.owner_id);
    const revealed = !!askerPart?.identity_revealed_at;
    // A-03: helpers see an anonymous asker as "Anonymous neighbour" unless revealed in this chat.
    const other: Asker =
      !viewerIsAsker && r.is_anonymous && !revealed ? { anonymous: true, reliability: rel.get(otherId) ?? null } : { anonymous: false, user: users.get(otherId)! };
    const last = lastMessages.find((m) => m.conversation_id === r.id);
    out.push({
      id: r.id,
      problemId: r.problem_id,
      problemTitle: r.title,
      other,
      lastMessage: previewOf(last),
      lastAt: (last?.created_at ?? t).toISOString(),
      unread: unread.find((u) => u.conversation_id === r.id)?.n ?? 0,
      readOnly: !isConversationWritable({
        problemStatus: r.status as 'open',
        problemClosedAt: r.closed_at,
        readOnlyAt: r.read_only_at,
        blockedEitherWay: await isBlockedEitherWay(ctx, viewerId, otherId),
        now: t,
        graceHours: CHAT_GRACE_HOURS,
      }),
      viewerIsAsker,
      identityRevealed: revealed,
      askerAnonymous: r.is_anonymous,
    });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

async function loadConversation(ctx: Ctx, id: string, viewerId: string): Promise<ConvRow> {
  if (!z.uuid().safeParse(id).success) throw notFound('That chat');
  const row = await ctx.db
    .selectFrom('conversations as c')
    .innerJoin('problems as p', 'p.id', 'c.problem_id')
    .innerJoin('help_offers as o', 'o.id', 'c.help_offer_id')
    .innerJoin('conversation_participants as cp', 'cp.conversation_id', 'c.id')
    .select(CONV_COLUMNS)
    .where('c.id', '=', id)
    .where('cp.user_id', '=', viewerId)
    .executeTakeFirst();
  if (!row) throw notFound('That chat');
  return row;
}

async function presentMessages(ctx: Ctx, rows: { id: number; conversation_id: string; sender_id: string | null; type: string; body: string | null; media_id: string | null; location_lat: number | null; location_lng: number | null; status: string; created_at: Date }[]): Promise<Message[]> {
  const media = await mediaRefs(ctx, rows.map((r) => r.media_id).filter((x): x is string => !!x));
  return rows.map((r) => {
    const removed = r.status !== 'visible';
    return {
      id: String(r.id),
      conversationId: r.conversation_id,
      senderId: r.sender_id,
      type: removed ? 'system' : (r.type as Message['type']),
      body: removed ? 'This message was removed.' : r.body,
      media: !removed && r.media_id ? (media.get(r.media_id) ?? null) : null,
      // L-04: exact points only reach the two participants of this conversation.
      location: !removed && r.location_lat !== null && r.location_lng !== null ? { lat: r.location_lat, lng: r.location_lng } : null,
      createdAt: r.created_at.toISOString(),
    };
  });
}

export function chatRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/conversations', async (req) => {
    const user = await requireUser(ctx, req);
    const rows = await ctx.db
      .selectFrom('conversations as c')
      .innerJoin('problems as p', 'p.id', 'c.problem_id')
      .innerJoin('help_offers as o', 'o.id', 'c.help_offer_id')
      .innerJoin('conversation_participants as cp', 'cp.conversation_id', 'c.id')
      .select(CONV_COLUMNS)
      .where('cp.user_id', '=', user.id)
      .execute();
    return presentConversations(ctx, rows, user.id);
  });

  app.get('/v1/conversations/:id', async (req) => {
    const user = await requireUser(ctx, req);
    const id = (req.params as { id: string }).id;
    const { after } = parse(z.object({ after: z.coerce.number().int().optional() }), req.query);
    const conv = await loadConversation(ctx, id, user.id);
    const rows = await ctx.db
      .selectFrom('messages')
      .select(['id', 'conversation_id', 'sender_id', 'type', 'body', 'media_id', 'location_lat', 'location_lng', 'status', 'created_at'])
      .where('conversation_id', '=', id)
      .$if(after !== undefined, (q) => q.where('id', '>', after!))
      .orderBy('id', 'desc')
      .limit(200)
      .execute();
    const [conversation] = await presentConversations(ctx, [conv], user.id);
    return { conversation: conversation!, messages: await presentMessages(ctx, rows.reverse()) };
  });

  app.post('/v1/conversations/:id/read', async (req) => {
    const user = await requireUser(ctx, req);
    const id = (req.params as { id: string }).id;
    await loadConversation(ctx, id, user.id);
    const last = await ctx.db.selectFrom('messages').select(sql<number>`max(id)`.as('id')).where('conversation_id', '=', id).executeTakeFirst();
    if (last?.id) {
      await ctx.db.updateTable('conversation_participants').set({ last_read_message_id: last.id }).where('conversation_id', '=', id).where('user_id', '=', user.id).execute();
    }
    return { ok: true };
  });

  async function send(user: { id: string }, conv: ConvRow, msg: { type: 'text' | 'image' | 'location'; body?: string | null; mediaId?: string | null; lat?: number; lng?: number }) {
    const otherId = conv.owner_id === user.id ? conv.helper_id : conv.owner_id;
    const writable = isConversationWritable({
      problemStatus: conv.status as 'open',
      problemClosedAt: conv.closed_at,
      readOnlyAt: conv.read_only_at,
      blockedEitherWay: await isBlockedEitherWay(ctx, user.id, otherId),
      now: now(),
      graceHours: CHAT_GRACE_HOURS,
    });
    if (!writable) throw forbidden('CHAT_READ_ONLY', 'This chat is closed.');
    await rateLimit(ctx.db, { userId: user.id }, 'message', RATE_LIMITS.message);
    return ctx.db.transaction().execute(async (tx) => {
      if (msg.mediaId) {
        const m = await tx.selectFrom('media').select(['owner_id', 'purpose']).where('id', '=', msg.mediaId).executeTakeFirst();
        if (!m || m.owner_id !== user.id || m.purpose !== 'chat_image') throw badRequest('INVALID_MEDIA', 'That photo can’t be sent here.');
      }
      const row = await tx
        .insertInto('messages')
        .values({
          conversation_id: conv.id,
          sender_id: user.id,
          type: msg.type,
          body: msg.body ?? null,
          media_id: msg.mediaId ?? null,
          location_lat: msg.lat ?? null,
          location_lng: msg.lng ?? null,
          // L-07: location messages are purged 7 days after the problem ends.
          purge_after: msg.type === 'location' && conv.closed_at ? new Date(conv.closed_at.getTime() + 7 * 86_400_000) : null,
          created_at: now(),
        })
        .returning(['id', 'conversation_id', 'sender_id', 'type', 'body', 'media_id', 'location_lat', 'location_lng', 'status', 'created_at'])
        .executeTakeFirstOrThrow();
      await tx.updateTable('conversation_participants').set({ last_read_message_id: row.id }).where('conversation_id', '=', conv.id).where('user_id', '=', user.id).execute();
      if (user.id === conv.owner_id) await raiserResponded(tx, conv.problem_id); // R-53: a chat reply counts
      await appendEvent(tx, { type: 'MessageSent', messageId: row.id, conversationId: conv.id });
      await publish(tx, [conv.owner_id, conv.helper_id], { type: 'message', id: conv.id });
      return (await presentMessages(ctx, [row]))[0]!;
    });
  }

  app.post('/v1/conversations/:id/messages', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const conv = await loadConversation(ctx, (req.params as { id: string }).id, user.id);
    const body = parse(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), body: z.string().trim().min(1).max(LIMITS.message) }),
        z.object({ type: z.literal('image'), mediaId: z.string(), body: z.string().max(LIMITS.message).nullable().optional() }),
      ]),
      req.body,
    );
    return body.type === 'text' ? send(user, conv, { type: 'text', body: body.body }) : send(user, conv, { type: 'image', mediaId: body.mediaId, body: body.body ?? null });
  });

  // L-04: only the asker shares the exact spot, only into this chat.
  app.post('/v1/conversations/:id/share-location', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const conv = await loadConversation(ctx, (req.params as { id: string }).id, user.id);
    if (conv.owner_id !== user.id) throw forbidden('FORBIDDEN', 'Only the asker can share the exact location.');
    const body = parse(z.object({ point: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional() }), req.body ?? {});
    let point = body.point ?? null;
    if (!point) {
      const saved = await ctx.db.selectFrom('problem_private_locations').select(['lat', 'lng']).where('problem_id', '=', conv.problem_id).executeTakeFirst();
      if (!saved) throw badRequest('NO_PRIVATE_LOCATION', 'Share your current location instead.');
      point = { lat: saved.lat, lng: saved.lng };
    }
    return send(user, conv, { type: 'location', lat: point.lat, lng: point.lng });
  });

  // A-03: an anonymous asker can reveal their profile to this helper; it can't be undone.
  app.post('/v1/conversations/:id/reveal-identity', async (req) => {
    const user = await requireUser(ctx, req);
    const conv = await loadConversation(ctx, (req.params as { id: string }).id, user.id);
    if (conv.owner_id !== user.id || !conv.is_anonymous) throw forbidden('FORBIDDEN', 'Nothing to reveal.');
    await ctx.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('conversation_participants')
        .set({ identity_revealed_at: now() })
        .where('conversation_id', '=', conv.id)
        .where('user_id', '=', user.id)
        .where('identity_revealed_at', 'is', null)
        .execute();
      await tx.insertInto('messages').values({ conversation_id: conv.id, sender_id: null, type: 'system', body: 'The asker shared their profile with you.', created_at: now() }).execute();
      await publish(tx, [conv.owner_id, conv.helper_id], { type: 'message', id: conv.id });
    });
    const [conversation] = await presentConversations(ctx, [conv], user.id);
    return conversation;
  });
}

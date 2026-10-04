import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS, RATE_LIMITS } from '@helpin/config';
import { CreatePostInputSchema, type Comment, type Community, type CommunityDetail, type Post } from '@helpin/contracts';
import { sql } from '@helpin/db';
import { ringCells } from '@helpin/geo';
import { requireUser } from '../platform/auth';
import { DAY, now } from '../platform/clock';
import type { Ctx } from '../platform/context';
import { badRequest, forbidden, notFound } from '../platform/errors';
import { decodeCursor, encodeCursor, parse } from '../platform/http';
import { appendEvent } from '../platform/outbox';
import { rateLimit } from '../platform/ratelimit';
import { publish } from '../platform/realtime';
import { CARD_COLUMNS, blockedIds, mediaRefs, presentCards, publicUsers, reliabilities, type CardRow } from '../views';

const TYPE_COLOR: Record<string, string> = {
  district: 'brand',
  language_culture: 'sapphire',
  students: 'tram',
  civic_environment: 'mint',
  interest: 'coral',
};

const POST_COLUMNS = ['po.id', 'po.author_id', 'po.kind', 'po.caption', 'po.cell_r7', 'po.community_id', 'po.problem_id', 'po.created_at'] as const;
interface PostRow {
  id: string;
  author_id: string;
  kind: string;
  caption: string | null;
  cell_r7: string;
  community_id: string | null;
  problem_id: string | null;
  created_at: Date;
}

export async function presentPosts(ctx: Ctx, rows: PostRow[], viewerId: string): Promise<Post[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const problemIds = rows.map((r) => r.problem_id).filter((x): x is string => !!x);
  const [media, likes, comments, tags, problems, communities, districts] = await Promise.all([
    ctx.db.selectFrom('post_media').select(['post_id', 'media_id', 'position']).where('post_id', 'in', ids).orderBy('position').execute(),
    ctx.db
      .selectFrom('reactions')
      .select(['post_id', sql<number>`count(*)::int`.as('n'), sql<boolean>`bool_or(user_id = ${viewerId})`.as('mine')])
      .where('post_id', 'in', ids)
      .groupBy('post_id')
      .execute(),
    ctx.db.selectFrom('comments').select(['post_id', sql<number>`count(*)::int`.as('n')]).where('post_id', 'in', ids).where('status', '=', 'visible').groupBy('post_id').execute(),
    ctx.db.selectFrom('post_tags').select(['post_id', 'user_id']).where('post_id', 'in', ids).where('status', '=', 'approved').execute(),
    problemIds.length ? ctx.db.selectFrom('problems').select(['id', 'title', 'is_anonymous', 'status']).where('id', 'in', problemIds).execute() : Promise.resolve([]),
    ctx.db
      .selectFrom('communities')
      .select(['id', 'name'])
      .where('id', 'in', rows.map((r) => r.community_id).filter((x): x is string => !!x).concat(['00000000-0000-0000-0000-000000000000']))
      .execute(),
    ctx.db.selectFrom('launch_area_cells').select(['cell_r7', 'district']).where('cell_r7', 'in', [...new Set(rows.map((r) => r.cell_r7))]).execute(),
  ]);
  const [users, rel, refs] = await Promise.all([
    publicUsers(ctx, [...rows.map((r) => r.author_id), ...tags.map((t) => t.user_id)]),
    reliabilities(ctx, rows.map((r) => r.author_id)),
    mediaRefs(ctx, media.map((m) => m.media_id)),
  ]);
  return rows.map((r) => {
    const problem = problems.find((p) => p.id === r.problem_id);
    // F-06: anonymous askers post thank-yous as "Anonymous neighbour".
    const anonymous = !!problem?.is_anonymous;
    const author = users.get(r.author_id);
    return {
      id: r.id,
      kind: r.kind as Post['kind'],
      author: anonymous || !author ? { anonymous: true, reliability: rel.get(r.author_id) ?? null } : { anonymous: false, user: author },
      community: communities.find((c) => c.id === r.community_id) ?? null,
      caption: r.caption,
      photos: media.filter((m) => m.post_id === r.id).map((m) => refs.get(m.media_id)).filter((m) => !!m),
      createdAt: r.created_at.toISOString(),
      likes: likes.find((l) => l.post_id === r.id)?.n ?? 0,
      liked: !!likes.find((l) => l.post_id === r.id)?.mine,
      comments: comments.find((c) => c.post_id === r.id)?.n ?? 0,
      problem: problem && problem.status !== 'removed' ? { id: problem.id, title: problem.title } : null,
      thanked: tags.filter((t) => t.post_id === r.id).map((t) => users.get(t.user_id)?.displayName ?? 'Neighbour'),
      district: districts.find((d) => d.cell_r7 === r.cell_r7)?.district ?? '',
      mine: r.author_id === viewerId,
    };
  });
}

async function postsQuery(ctx: Ctx, viewerId: string) {
  const blocked = await blockedIds(ctx, viewerId);
  return ctx.db
    .selectFrom('posts as po')
    .innerJoin('users as u', 'u.id', 'po.author_id')
    .select(POST_COLUMNS)
    .where('po.status', '=', 'visible')
    .where('u.status', '!=', 'deleted')
    .$if(blocked.length > 0, (q) => q.where('po.author_id', 'not in', blocked));
}

async function loadPost(ctx: Ctx, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound('That post');
  const p = await ctx.db.selectFrom('posts').selectAll().where('id', '=', id).executeTakeFirst();
  if (!p || p.status !== 'visible') throw notFound('That post');
  return p;
}

async function communityColor(id: string, type: string) {
  return TYPE_COLOR[type] ?? (id ? 'brand' : 'brand');
}

async function presentCommunities(ctx: Ctx, rows: { id: string; slug: string; name: string; type: string; description: string | null }[], viewerId: string): Promise<Community[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const since = new Date(now().getTime() - 7 * DAY);
  const [members, mine, recent] = await Promise.all([
    ctx.db.selectFrom('community_members').select(['community_id', sql<number>`count(*)::int`.as('n')]).where('community_id', 'in', ids).groupBy('community_id').execute(),
    ctx.db.selectFrom('community_members').select('community_id').where('community_id', 'in', ids).where('user_id', '=', viewerId).execute(),
    ctx.db
      .selectFrom('posts')
      .select(['community_id', sql<number>`count(*)::int`.as('n')])
      .where('community_id', 'in', ids)
      .where('status', '=', 'visible')
      .where('created_at', '>', since)
      .groupBy('community_id')
      .execute(),
  ]);
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      type: r.type as Community['type'],
      description: r.description ?? '',
      memberCount: members.find((m) => m.community_id === r.id)?.n ?? 0,
      joined: mine.some((m) => m.community_id === r.id),
      newPosts: recent.find((m) => m.community_id === r.id)?.n ?? 0,
      color: await communityColor(r.id, r.type),
    })),
  );
}

export function socialRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- Feed (F-02): the viewer's area and its neighbours, plus joined communities; newest first.
  app.get('/v1/feed', async (req) => {
    const user = await requireUser(ctx, req);
    const { cursor } = parse(z.object({ cursor: z.string().optional() }), req.query);
    const home = (await ctx.db.selectFrom('profiles').select('home_cell_r7').where('user_id', '=', user.id).executeTakeFirst())?.home_cell_r7;
    const joined = (await ctx.db.selectFrom('community_members').select('community_id').where('user_id', '=', user.id).execute()).map((r) => r.community_id);
    const area = home ? ringCells(home, 1) : [];
    const c = decodeCursor(cursor);
    const rows = await (await postsQuery(ctx, user.id))
      .where((eb) =>
        eb.or([
          ...(area.length ? [eb('po.cell_r7', 'in', area)] : []),
          ...(joined.length ? [eb('po.community_id', 'in', joined)] : []),
          eb('po.author_id', '=', user.id),
        ]),
      )
      .where('po.kind', '!=', 'welcome')
      .$if(!!c, (q) => q.where((eb) => eb.or([eb('po.created_at', '<', c!.at), eb.and([eb('po.created_at', '=', c!.at), eb('po.id', '<', c!.id)])])))
      .orderBy('po.created_at', 'desc')
      .orderBy('po.id', 'desc')
      .limit(20)
      .execute();
    const last = rows[rows.length - 1];
    return { items: await presentPosts(ctx, rows, user.id), nextCursor: rows.length === 20 && last ? encodeCursor(last.created_at, last.id) : null };
  });

  app.get('/v1/users/:id/posts', async (req) => {
    const user = await requireUser(ctx, req);
    const { id } = req.params as { id: string };
    const rows = await (await postsQuery(ctx, user.id))
      .leftJoin('problems as pr', 'pr.id', 'po.problem_id')
      .where('po.author_id', '=', id)
      .where((eb) => eb.or([eb('pr.is_anonymous', 'is', null), eb('pr.is_anonymous', '=', false), eb('po.author_id', '=', user.id)])) // A-04
      .orderBy('po.created_at', 'desc')
      .limit(60)
      .execute();
    return presentPosts(ctx, rows, user.id);
  });

  app.post('/v1/posts', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const input = parse(CreatePostInputSchema, req.body);
    await rateLimit(ctx.db, { userId: user.id }, 'post', RATE_LIMITS.post);
    const profile = await ctx.db.selectFrom('profiles').select('home_cell_r7').where('user_id', '=', user.id).executeTakeFirstOrThrow();
    if (!profile.home_cell_r7) throw badRequest('HOME_AREA_REQUIRED', 'Set your area first.');
    if (input.kind === 'photo' && input.mediaIds.length < 1) throw badRequest('VALIDATION', 'Add at least one photo.'); // F-01
    if (input.kind !== 'photo' && !input.caption?.trim()) throw badRequest('VALIDATION', 'Write a few words.');
    if (input.kind === 'welcome' && !input.communityId) throw badRequest('VALIDATION', 'Welcome posts belong to a community.');
    if (input.communityId) {
      const member = await ctx.db.selectFrom('community_members').select('user_id').where('community_id', '=', input.communityId).where('user_id', '=', user.id).executeTakeFirst();
      if (!member) throw forbidden('NOT_A_MEMBER', 'Join the community first.');
    }
    let helperIds: string[] = [];
    if (input.kind === 'thank_you') {
      // F-06: thank-yous link a problem you solved and tag the credited helpers.
      if (!input.problemId) throw badRequest('VALIDATION', 'Choose the problem you want to say thanks for.');
      const p = await ctx.db.selectFrom('problems').select(['owner_id', 'status']).where('id', '=', input.problemId).executeTakeFirst();
      if (!p || p.owner_id !== user.id || p.status !== 'solved') throw badRequest('VALIDATION', 'You can only say thanks for your own solved problems.');
      helperIds = (await ctx.db.selectFrom('help_offers').select('helper_id').where('problem_id', '=', input.problemId).where('status', '=', 'credited').execute()).map((r) => r.helper_id);
    }
    const id = await ctx.db.transaction().execute(async (tx) => {
      if (input.mediaIds.length) {
        const rows = await tx.selectFrom('media').select(['id', 'owner_id', 'purpose', 'status']).where('id', 'in', input.mediaIds).execute();
        // F-03: feed photos and problem photos never mix.
        if (rows.length !== input.mediaIds.length || rows.some((m) => m.owner_id !== user.id || m.purpose !== 'post_photo' || m.status === 'deleted')) {
          throw badRequest('INVALID_MEDIA', 'One of the photos can’t be used here.');
        }
      }
      const t = now();
      const post = await tx
        .insertInto('posts')
        .values({
          author_id: user.id,
          kind: input.kind,
          caption: input.caption?.trim() || null,
          cell_r7: profile.home_cell_r7!,
          community_id: input.communityId,
          problem_id: input.kind === 'thank_you' ? input.problemId : null,
          created_at: t,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const [i, mediaId] of input.mediaIds.entries()) await tx.insertInto('post_media').values({ post_id: post.id, media_id: mediaId, position: i }).execute();
      for (const helperId of helperIds) {
        await tx.insertInto('post_tags').values({ post_id: post.id, user_id: helperId, created_at: t }).execute();
        await appendEvent(tx, { type: 'PostTagged', postId: post.id, userId: helperId });
      }
      return post.id;
    });
    const post = await (await postsQuery(ctx, user.id)).where('po.id', '=', id).execute();
    return (await presentPosts(ctx, post, user.id))[0];
  });

  app.delete('/v1/posts/:id', async (req) => {
    const user = await requireUser(ctx, req);
    const post = await loadPost(ctx, (req.params as { id: string }).id);
    if (post.author_id !== user.id) throw forbidden('FORBIDDEN', 'Not your post.');
    await ctx.db.updateTable('posts').set({ status: 'removed' }).where('id', '=', post.id).execute();
    return { ok: true };
  });

  app.post('/v1/posts/:id/tags/:decision', async (req) => {
    const user = await requireUser(ctx, req);
    const { id, decision } = parse(z.object({ id: z.uuid(), decision: z.enum(['approve', 'decline']) }), req.params);
    const res = await ctx.db
      .updateTable('post_tags')
      .set({ status: decision === 'approve' ? 'approved' : 'declined' })
      .where('post_id', '=', id)
      .where('user_id', '=', user.id)
      .returning('post_id')
      .executeTakeFirst();
    if (!res) throw notFound('That tag');
    return { ok: true };
  });

  app.put('/v1/posts/:id/reaction', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const post = await loadPost(ctx, (req.params as { id: string }).id);
    await ctx.db.insertInto('reactions').values({ post_id: post.id, user_id: user.id, created_at: now() }).onConflict((oc) => oc.columns(['post_id', 'user_id']).doNothing()).execute();
    return (await presentPosts(ctx, [post], user.id))[0];
  });

  app.delete('/v1/posts/:id/reaction', async (req) => {
    const user = await requireUser(ctx, req);
    const post = await loadPost(ctx, (req.params as { id: string }).id);
    await ctx.db.deleteFrom('reactions').where('post_id', '=', post.id).where('user_id', '=', user.id).execute();
    return (await presentPosts(ctx, [post], user.id))[0];
  });

  // ---- Comments (F-05: flat)
  async function presentComments(rows: { id: string; post_id: string; author_id: string; body: string; created_at: Date }[], viewerId: string): Promise<Comment[]> {
    const users = await publicUsers(ctx, rows.map((r) => r.author_id));
    return rows.filter((r) => users.has(r.author_id)).map((r) => ({ id: r.id, postId: r.post_id, author: users.get(r.author_id)!, body: r.body, createdAt: r.created_at.toISOString(), mine: r.author_id === viewerId }));
  }

  app.get('/v1/posts/:id/comments', async (req) => {
    const user = await requireUser(ctx, req);
    const post = await loadPost(ctx, (req.params as { id: string }).id);
    const blocked = await blockedIds(ctx, user.id);
    const rows = await ctx.db
      .selectFrom('comments')
      .select(['id', 'post_id', 'author_id', 'body', 'created_at'])
      .where('post_id', '=', post.id)
      .where('status', '=', 'visible')
      .$if(blocked.length > 0, (q) => q.where('author_id', 'not in', blocked))
      .orderBy('created_at')
      .limit(200)
      .execute();
    return presentComments(rows, user.id);
  });

  app.post('/v1/posts/:id/comments', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const post = await loadPost(ctx, (req.params as { id: string }).id);
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(LIMITS.caption) }), req.body);
    await rateLimit(ctx.db, { userId: user.id }, 'comment', RATE_LIMITS.comment);
    const row = await ctx.db.transaction().execute(async (tx) => {
      const c = await tx.insertInto('comments').values({ post_id: post.id, author_id: user.id, body, created_at: now() }).returning(['id', 'post_id', 'author_id', 'body', 'created_at']).executeTakeFirstOrThrow();
      if (post.author_id !== user.id) await appendEvent(tx, { type: 'CommentAdded', commentId: c.id });
      await publish(tx, [post.author_id], { type: 'feed', id: post.id });
      return c;
    });
    return (await presentComments([row], user.id))[0];
  });

  app.delete('/v1/comments/:id', async (req) => {
    const user = await requireUser(ctx, req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const c = await ctx.db.selectFrom('comments as c').innerJoin('posts as p', 'p.id', 'c.post_id').select(['c.author_id', 'p.author_id as post_author']).where('c.id', '=', id).executeTakeFirst();
    if (!c) throw notFound('That comment');
    if (c.author_id !== user.id && c.post_author !== user.id) throw forbidden('FORBIDDEN', 'Not your comment.');
    await ctx.db.updateTable('comments').set({ status: 'removed' }).where('id', '=', id).execute();
    return { ok: true };
  });

  // ---- Communities (§14)
  app.get('/v1/communities', async (req) => {
    const user = await requireUser(ctx, req);
    const rows = await ctx.db.selectFrom('communities').select(['id', 'slug', 'name', 'type', 'description']).where('status', '=', 'active').orderBy('name').execute();
    return presentCommunities(ctx, rows, user.id);
  });

  async function findCommunity(idOrSlug: string) {
    const byId = z.uuid().safeParse(idOrSlug).success;
    const c = await ctx.db
      .selectFrom('communities')
      .selectAll()
      .where(byId ? 'id' : 'slug', '=', idOrSlug)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!c) throw notFound('That community');
    return c;
  }

  app.get('/v1/communities/:id', async (req) => {
    const user = await requireUser(ctx, req);
    const c = await findCommunity((req.params as { id: string }).id);
    const [summary] = await presentCommunities(ctx, [c], user.id);
    const membership = await ctx.db.selectFrom('community_members').select('alerts').where('community_id', '=', c.id).where('user_id', '=', user.id).executeTakeFirst();
    const base = await postsQuery(ctx, user.id);
    const [posts, welcome, shared] = await Promise.all([
      base.where('po.community_id', '=', c.id).where('po.kind', '!=', 'welcome').orderBy('po.created_at', 'desc').limit(30).execute(),
      base.where('po.community_id', '=', c.id).where('po.kind', '=', 'welcome').orderBy('po.created_at', 'desc').limit(30).execute(),
      ctx.db
        .selectFrom('community_problem_shares as s')
        .innerJoin('problems as p', 'p.id', 's.problem_id')
        .select(CARD_COLUMNS)
        .where('s.community_id', '=', c.id)
        .where('p.status', '=', 'open')
        .where('p.hidden_at', 'is', null)
        .orderBy('s.created_at', 'desc')
        .limit(20)
        .execute(),
    ]);
    return {
      ...summary!,
      rules: c.rules,
      posts: await presentPosts(ctx, posts, user.id),
      welcome: await presentPosts(ctx, welcome, user.id),
      sharedProblems: await presentCards(ctx, shared as CardRow[]),
      alerts: !!membership?.alerts,
    } satisfies CommunityDetail;
  });

  app.post('/v1/communities/:id/members', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const c = await findCommunity((req.params as { id: string }).id);
    await ctx.db.insertInto('community_members').values({ community_id: c.id, user_id: user.id, joined_at: now() }).onConflict((oc) => oc.columns(['community_id', 'user_id']).doNothing()).execute();
    return (await presentCommunities(ctx, [c], user.id))[0];
  });

  app.delete('/v1/communities/:id/members', async (req) => {
    const user = await requireUser(ctx, req);
    const c = await findCommunity((req.params as { id: string }).id);
    await ctx.db.deleteFrom('community_members').where('community_id', '=', c.id).where('user_id', '=', user.id).execute();
    return (await presentCommunities(ctx, [c], user.id))[0];
  });

  app.put('/v1/communities/:id/alerts', async (req) => {
    const user = await requireUser(ctx, req);
    const c = await findCommunity((req.params as { id: string }).id);
    const { alerts } = parse(z.object({ alerts: z.boolean() }), req.body);
    await ctx.db.updateTable('community_members').set({ alerts }).where('community_id', '=', c.id).where('user_id', '=', user.id).execute();
    return { ok: true };
  });

  app.post('/v1/community-requests', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const body = parse(z.object({ name: z.string().trim().min(3).max(80), type: z.string(), reason: z.string().max(1000).nullable() }), req.body);
    await rateLimit(ctx.db, { userId: user.id }, 'community_request', { max: 3, windowHours: 24 });
    await ctx.db.insertInto('community_requests').values({ requester_id: user.id, name: body.name, type: body.type, reason: body.reason, created_at: now() }).execute();
    return { ok: true };
  });
}

export { TYPE_COLOR };

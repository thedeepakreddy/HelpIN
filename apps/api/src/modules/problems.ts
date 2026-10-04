import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FIXED_QUORUM, KARMA, LAUNCH_AREA, PRIVATE_LOCATION_RETENTION_DAYS, RATE_LIMITS, findCategory, type Kind, type Urgency } from '@helpin/config';
import { CreateProblemInputSchema, PostUpdateInputSchema, type Offer, type ProblemDetail, type ViewerRole } from '@helpin/contracts';
import { sql, type Tx } from '@helpin/db';
import {
  assertCanPost,
  decideConfirmSolved,
  decideCreditAfterQuorum,
  decideFixedNow,
  isKarmaEligible,
  maxLifeAt,
  nextResponseDue,
  type CreditDecision,
  type HelperFacts,
  type OfferSnapshot,
  type ProblemSnapshot,
} from '@helpin/domain';
import { GeoRuleError, cellCenter, cellsForBbox, parentCell, resolutionForZoom, ringCells, snapToArea, type BBox } from '@helpin/geo';
import { getResolution, isValidCell } from 'h3-js';
import { optionalUser, requireUser } from '../platform/auth';
import { DAY, now } from '../platform/clock';
import type { Ctx } from '../platform/context';
import { ApiError, badRequest, forbidden, notFound } from '../platform/errors';
import { iso, parse } from '../platform/http';
import { appendEvent } from '../platform/outbox';
import { rateLimit } from '../platform/ratelimit';
import { publish } from '../platform/realtime';
import { CARD_COLUMNS, blockedIds, mediaRefs, presentCards, publicUsers, type CardRow } from '../views';

/* ------------------------------------------------------------------ Shared helpers */

/** R-53: any raiser response resets the 48 h clock (personal problems with a running clock). */
export async function raiserResponded(tx: Tx, problemId: string) {
  const t = now();
  await tx
    .updateTable('problems')
    .set({
      response_due_at: sql<Date | null>`CASE WHEN response_due_at IS NULL THEN NULL ELSE ${nextResponseDue(t)}::timestamptz END`,
      reminder_stage: 0,
      last_raiser_response_at: t,
      last_activity_at: t,
    })
    .where('id', '=', problemId)
    .where('status', '=', 'open')
    .execute();
}

/** R-32: incident display fields follow their member problems. */
export async function syncIncident(tx: Tx, incidentId: string) {
  const members = await tx.selectFrom('problems').select(['status', 'urgency', 'closed_at']).where('incident_id', '=', incidentId).execute();
  const affected = await tx.selectFrom('incident_affected').select(sql<number>`count(*)::int`.as('n')).where('incident_id', '=', incidentId).executeTakeFirst();
  const open = members.some((m) => m.status === 'open');
  const order: Urgency[] = ['basic', 'medium', 'serious'];
  const maxUrgency = members.reduce<Urgency>((acc, m) => (order.indexOf(m.urgency as Urgency) > order.indexOf(acc) ? (m.urgency as Urgency) : acc), 'basic');
  const status = open ? 'open' : (members[0]?.status ?? 'open');
  await tx
    .updateTable('incidents')
    .set({ status, max_urgency: maxUrgency, affected_count: members.length + (affected?.n ?? 0), closed_at: open ? null : now() })
    .where('id', '=', incidentId)
    .execute();
}

/**
 * Everything that happens when a problem reaches a terminal state: open offers close (R-16),
 * the incident updates (R-32), and exact locations are scheduled for purging (L-07).
 */
export async function onProblemTerminal(tx: Tx, problemId: string, incidentId: string, exceptOfferIds: string[] = []) {
  const t = now();
  let q = tx.updateTable('help_offers').set({ status: 'closed', resolved_at: t }).where('problem_id', '=', problemId).where('status', 'in', ['offered', 'accepted']);
  if (exceptOfferIds.length) q = q.where('id', 'not in', exceptOfferIds);
  await q.execute();
  await syncIncident(tx, incidentId);
  const purgeAfter = new Date(t.getTime() + PRIVATE_LOCATION_RETENTION_DAYS * DAY);
  await tx.updateTable('problem_private_locations').set({ purge_after: purgeAfter }).where('problem_id', '=', problemId).execute();
  await tx
    .updateTable('messages')
    .set({ purge_after: purgeAfter })
    .where('type', '=', 'location')
    .where('conversation_id', 'in', tx.selectFrom('conversations').select('id').where('problem_id', '=', problemId))
    .execute();
}

/** Writes a system message into every conversation of a problem. */
export async function systemMessage(tx: Tx, problemId: string, body: string, onlyConversationId?: string) {
  let q = tx.selectFrom('conversations').select('id').where('problem_id', '=', problemId);
  if (onlyConversationId) q = q.where('id', '=', onlyConversationId);
  const convs = await q.execute();
  for (const c of convs) {
    await tx.insertInto('messages').values({ conversation_id: c.id, sender_id: null, type: 'system', body, created_at: now() }).execute();
  }
}

async function participantsOf(tx: Tx, problemId: string): Promise<string[]> {
  const rows = await tx
    .selectFrom('help_offers')
    .select('helper_id')
    .where('problem_id', '=', problemId)
    .where('status', 'in', ['offered', 'accepted', 'credited', 'closed'])
    .execute();
  const owner = await tx.selectFrom('problems').select('owner_id').where('id', '=', problemId).executeTakeFirst();
  return [...rows.map((r) => r.helper_id), ...(owner ? [owner.owner_id] : [])];
}

/** Tells everyone looking at a problem to refetch (realtime hint). */
export async function touchProblem(tx: Tx, problemId: string) {
  await publish(tx, await participantsOf(tx, problemId), { type: 'problem', id: problemId });
}

async function attachMedia(tx: Tx, userId: string, mediaIds: string[], purpose: string) {
  if (!mediaIds.length) return;
  const rows = await tx.selectFrom('media').select(['id', 'owner_id', 'purpose', 'status']).where('id', 'in', mediaIds).execute();
  for (const id of mediaIds) {
    const m = rows.find((r) => r.id === id);
    // F-03: a media item can only be used for the purpose it was uploaded for.
    if (!m || m.owner_id !== userId || m.purpose !== purpose || m.status === 'deleted' || m.status === 'rejected') {
      throw badRequest('INVALID_MEDIA', 'One of the photos can’t be used here.');
    }
  }
}

/* ------------------------------------------------------------------ Detail */

const DETAIL_COLUMNS = [
  ...CARD_COLUMNS,
  'p.description',
  'p.response_due_at',
  'p.solved_via',
  'p.credit_deadline',
  'p.hidden_at',
  'p.last_raiser_response_at',
] as const;

export async function loadProblemRow(ctx: Ctx | { db: Tx }, id: string) {
  if (!z.uuid().safeParse(id).success) return undefined;
  return ctx.db.selectFrom('problems as p').select(DETAIL_COLUMNS).where('p.id', '=', id).executeTakeFirst();
}

export async function problemDetail(ctx: Ctx, id: string, viewerId: string | null): Promise<ProblemDetail> {
  const row = await loadProblemRow(ctx, id);
  const isOwner = !!row && row.owner_id === viewerId;
  // R-05: removed problems disappear; hidden ones only for their owner (S-05).
  if (!row || (row.status === 'removed' && !isOwner) || (row.hidden_at && !isOwner)) throw notFound('That problem');
  if (viewerId && !isOwner && (await blockedIds(ctx, viewerId)).includes(row.owner_id)) throw notFound('That problem');

  const [card] = await presentCards(ctx, [row as CardRow]);
  const [offerRows, updates, photos, affectedRows, privateLoc, conversations] = await Promise.all([
    ctx.db.selectFrom('help_offers').selectAll().where('problem_id', '=', id).orderBy('created_at').execute(),
    ctx.db.selectFrom('problem_updates').selectAll().where('problem_id', '=', id).where('status', '=', 'visible').orderBy('created_at', 'desc').execute(),
    ctx.db.selectFrom('problem_photos').select(['media_id', 'update_id', 'position']).where('problem_id', '=', id).orderBy('position').execute(),
    ctx.db.selectFrom('incident_affected').select(['user_id', 'fixed_confirmed_at']).where('incident_id', '=', row.incident_id).execute(),
    isOwner ? ctx.db.selectFrom('problem_private_locations').select('problem_id').where('problem_id', '=', id).executeTakeFirst() : Promise.resolve(undefined),
    ctx.db.selectFrom('conversations').select(['id', 'help_offer_id']).where('problem_id', '=', id).execute(),
  ]);
  const media = await mediaRefs(ctx, photos.map((p) => p.media_id));
  const helperUsers = await publicUsers(ctx, [...offerRows.map((o) => o.helper_id), ...updates.map((u) => u.author_id), row.owner_id]);
  const asker = helperUsers.get(row.owner_id);

  const mine = viewerId ? offerRows.find((o) => o.helper_id === viewerId) : undefined;
  let role: ViewerRole = 'visitor';
  if (isOwner) role = 'asker';
  else if (mine && (mine.status === 'accepted' || mine.status === 'credited')) role = 'helper_accepted';
  else if (mine?.status === 'offered') role = 'helper_offered';
  else if (row.kind === 'issue' && affectedRows.some((a) => a.user_id === viewerId)) role = 'affected';

  const presentOffer = (o: (typeof offerRows)[number]): Offer => {
    const helper = helperUsers.get(o.helper_id)!;
    return {
      id: o.id,
      problemId: o.problem_id,
      helper,
      message: o.message,
      status: o.status as Offer['status'],
      createdAt: o.created_at.toISOString(),
      claimedSolved: !!o.claimed_solved_at,
      conversationId: conversations.find((c) => c.help_offer_id === o.id)?.id ?? null,
      sharesLanguage: !!asker && helper.languages.some((l) => asker.languages.includes(l)),
    };
  };

  const t = now();
  const credited = offerRows.filter((o) => o.status === 'credited');
  const fixedVotes = affectedRows.filter((a) => a.fixed_confirmed_at);
  return {
    ...card!,
    description: row.description,
    photos: photos.filter((p) => !p.update_id).map((p) => media.get(p.media_id)).filter((m) => !!m),
    updates: updates.map((u) => ({
      id: u.id,
      authorRole: u.author_role as 'asker' | 'helper' | 'affected',
      authorName: u.author_role === 'asker' && card!.asker.anonymous ? 'Anonymous neighbour' : (helperUsers.get(u.author_id)?.displayName ?? 'Neighbour'),
      progressStatus: u.progress_status as ProblemDetail['latestProgress'] & string,
      body: u.body,
      photos: photos.filter((p) => p.update_id === u.id).map((p) => media.get(p.media_id)).filter((m) => !!m),
      createdAt: u.created_at.toISOString(),
    })),
    viewerRole: role,
    myOffer: mine && ['offered', 'accepted', 'credited'].includes(mine.status) ? presentOffer(mine) : null,
    responseDueAt: isOwner && row.status === 'open' ? iso(row.response_due_at) : null,
    // R-22: after a fixed-quorum solve the closed offers stay visible so the reporter can credit them.
    offers: isOwner ? offerRows.filter((o) => ['offered', 'accepted', 'credited', ...(row.solved_via === 'fixed_quorum' ? ['closed'] : [])].includes(o.status)).sort((a, b) => Number(b.status !== 'offered') - Number(a.status !== 'offered')).map(presentOffer) : [],
    creditedHelperNames: credited.map((o) => helperUsers.get(o.helper_id)?.displayName ?? 'Neighbour'),
    fixedVotes: fixedVotes.length,
    myFixedVote: fixedVotes.some((a) => a.user_id === viewerId),
    creditUntil:
      isOwner && row.solved_via === 'fixed_quorum' && row.credit_deadline && row.credit_deadline > t && credited.length === 0 ? row.credit_deadline.toISOString() : null,
    askerLastActiveAt: isOwner ? null : iso(row.last_raiser_response_at ?? row.created_at),
    hasPrivateLocation: !!privateLoc,
    hidden: !!row.hidden_at,
  };
}

/* ------------------------------------------------------------------ Karma facts */

async function helperFacts(tx: Tx, askerId: string, helperIds: string[]): Promise<Map<string, HelperFacts>> {
  const out = new Map<string, HelperFacts>();
  if (!helperIds.length) return out;
  const t = now();
  const users = await tx.selectFrom('users').select(['id', 'phone_verified_at', 'created_at', 'status']).where('id', 'in', helperIds).execute();
  const pairs = await tx
    .selectFrom('karma_entries')
    .select([
      'user_id',
      sql<Date | null>`max(created_at) FILTER (WHERE reason = 'solve_award' AND amount > 0)`.as('last_award'),
      sql<number>`coalesce(sum(amount), 0)::int`.as('total'),
    ])
    .where('source_user_id', '=', askerId)
    .where('user_id', 'in', helperIds)
    .groupBy('user_id')
    .execute();
  for (const u of users) {
    const p = pairs.find((x) => x.user_id === u.id);
    out.set(u.id, {
      eligible: u.status !== 'deleted' && isKarmaEligible({ phoneVerifiedAt: u.phone_verified_at, createdAt: u.created_at }, t),
      lastPairAwardAt: p?.last_award ?? null,
      pairTotal: p?.total ?? 0,
    });
  }
  return out;
}

/** K-08 / K-09: keep profile caches in step with the ledger. */
export async function refreshKarmaCaches(tx: Tx, userIds: string[]) {
  for (const id of new Set(userIds)) {
    await sql`
      UPDATE app.profiles SET
        karma_balance = (SELECT coalesce(sum(amount), 0) FROM app.karma_entries WHERE user_id = ${id}),
        neighbours_helped = (
          SELECT count(DISTINCT k.source_user_id) FROM app.karma_entries k
          WHERE k.user_id = ${id} AND k.reason IN ('solve_award', 'pair_cooldown', 'pair_cap', 'ineligible_account')
            AND NOT EXISTS (SELECT 1 FROM app.karma_entries r WHERE r.reverses_entry_id = k.id)
        ),
        updated_at = ${now()}
      WHERE user_id = ${id}`.execute(tx);
  }
}

async function writeCredits(tx: Tx, problemId: string, askerId: string, credits: CreditDecision[]) {
  const t = now();
  for (const c of credits) {
    await tx.updateTable('help_offers').set({ status: 'credited', resolved_at: t }).where('id', '=', c.offerId).execute();
    await tx
      .insertInto('karma_entries')
      .values({ user_id: c.helperId, source_user_id: askerId, amount: c.amount, reason: c.reason, problem_id: problemId, help_offer_id: c.offerId, created_at: t })
      .execute();
    await appendEvent(tx, { type: 'HelperCredited', problemId, helperId: c.helperId, amount: c.amount });
  }
}

const snapshot = (row: { id: string; owner_id: string; kind: string; status: string; solved_via?: string | null; credit_deadline?: Date | null }): ProblemSnapshot => ({
  id: row.id,
  ownerId: row.owner_id,
  kind: row.kind as Kind,
  status: row.status as ProblemSnapshot['status'],
  solvedVia: (row.solved_via as ProblemSnapshot['solvedVia']) ?? null,
  creditDeadline: row.credit_deadline ?? null,
});

const offerSnapshots = (rows: { id: string; problem_id: string; helper_id: string; status: string; created_at: Date }[]): OfferSnapshot[] =>
  rows.map((o) => ({ id: o.id, problemId: o.problem_id, helperId: o.helper_id, status: o.status as OfferSnapshot['status'], createdAt: o.created_at }));

/* ------------------------------------------------------------------ Routes */

const BboxSchema = z
  .string()
  .transform((s) => s.split(',').map(Number))
  .pipe(z.tuple([z.number(), z.number(), z.number(), z.number()]));

export function problemRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- Map (Architecture §5.2)
  app.get('/v1/map', async (req) => {
    const viewer = await requireUser(ctx, req);
    const q = parse(z.object({ bbox: BboxSchema, zoom: z.coerce.number().min(0).max(22) }), req.query);
    const bbox = q.bbox as BBox;
    const res = resolutionForZoom(q.zoom);
    let cells: string[];
    try {
      cells = cellsForBbox(bbox, res);
    } catch {
      throw badRequest('BBOX_TOO_LARGE', 'Zoom in a little.');
    }
    const blocked = await blockedIds(ctx, viewer.id);
    const base = ctx.db
      .selectFrom('problems as p')
      .where('p.status', '=', 'open')
      .where('p.hidden_at', 'is', null)
      .$if(blocked.length > 0, (qb) => qb.where('p.owner_id', 'not in', blocked));
    if (res === 8) {
      const r7 = [...new Set(cells.map((c) => parentCell(c, 7)))];
      const rows = await base
        .select(CARD_COLUMNS)
        .where((eb) => eb.or([eb('p.cell_r8', 'in', cells), eb.and([eb('p.area_res', '=', 7), eb('p.cell_r7', 'in', r7)])]))
        .orderBy(sql`CASE p.urgency WHEN 'serious' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END`, 'desc')
        .orderBy('p.created_at', 'desc')
        .limit(200)
        .execute();
      return { mode: 'incidents' as const, problems: await presentCards(ctx, rows as CardRow[]) };
    }
    const column = res === 7 ? 'p.cell_r7' : 'p.cell_r6';
    const rows = await base
      .select([
        `${column} as cell`,
        sql<number>`count(*)::int`.as('count'),
        sql<string>`(array_agg(p.urgency ORDER BY CASE p.urgency WHEN 'serious' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END DESC))[1]`.as('max_urgency'),
      ])
      .where(column, 'in', cells)
      .groupBy(column)
      .execute();
    return {
      mode: 'clusters' as const,
      clusters: rows.map((r) => ({ cell: r.cell, center: cellCenter(r.cell), count: r.count, maxUrgency: r.max_urgency as Urgency })),
    };
  });

  // ---- Nearby list: by the viewer's res-7 cell (L-06), most urgent first
  app.get('/v1/problems/nearby', async (req) => {
    const viewer = await requireUser(ctx, req);
    const { cell } = parse(z.object({ cell: z.string().optional() }), req.query);
    const home = cell ?? (await ctx.db.selectFrom('profiles').select('home_cell_r7').where('user_id', '=', viewer.id).executeTakeFirst())?.home_cell_r7;
    const blocked = await blockedIds(ctx, viewer.id);
    let q = ctx.db
      .selectFrom('problems as p')
      .select(CARD_COLUMNS)
      .where('p.status', '=', 'open')
      .where('p.hidden_at', 'is', null)
      .$if(blocked.length > 0, (qb) => qb.where('p.owner_id', 'not in', blocked));
    if (home && isValidCell(home) && getResolution(home) === 7) q = q.where('p.cell_r7', 'in', ringCells(home, 3));
    const rows = await q
      .orderBy(sql`CASE p.urgency WHEN 'serious' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END`, 'desc')
      .orderBy('p.last_activity_at', 'desc')
      .limit(50)
      .execute();
    return presentCards(ctx, rows as CardRow[]);
  });

  // ---- R-31: similar open problems in the area and its neighbours
  app.get('/v1/problems/similar', async (req) => {
    const viewer = await requireUser(ctx, req);
    const q = parse(z.object({ cell: z.string(), category: z.string() }), req.query);
    if (!isValidCell(q.cell)) throw badRequest('VALIDATION', 'Invalid area.');
    const r7 = parentCell(q.cell, 7);
    const blocked = await blockedIds(ctx, viewer.id);
    const rows = await ctx.db
      .selectFrom('problems as p')
      .select(CARD_COLUMNS)
      .where('p.status', '=', 'open')
      .where('p.hidden_at', 'is', null)
      .where('p.category', '=', q.category)
      .where('p.cell_r7', 'in', ringCells(r7, 1))
      .where('p.owner_id', '!=', viewer.id)
      .$if(blocked.length > 0, (qb) => qb.where('p.owner_id', 'not in', blocked))
      .orderBy('p.created_at', 'desc')
      .limit(5)
      .execute();
    return presentCards(ctx, rows as CardRow[]);
  });

  app.get('/v1/me/problems', async (req) => {
    const viewer = await requireUser(ctx, req);
    const rows = await ctx.db.selectFrom('problems as p').select(CARD_COLUMNS).where('p.owner_id', '=', viewer.id).orderBy('p.created_at', 'desc').limit(100).execute();
    return presentCards(ctx, rows as CardRow[]);
  });

  // ---- Problem photos on a public profile (F-04, A-04: never anonymous problems)
  app.get('/v1/users/:id/problem-photos', async (req) => {
    await requireUser(ctx, req);
    const { id } = req.params as { id: string };
    const rows = await ctx.db
      .selectFrom('problem_photos as pp')
      .innerJoin('problems as p', 'p.id', 'pp.problem_id')
      .select(['pp.media_id', 'p.id', 'p.status'])
      .where('p.owner_id', '=', id)
      .where('p.is_anonymous', '=', false)
      .where('p.status', '!=', 'removed')
      .where('p.hidden_at', 'is', null)
      .orderBy('pp.created_at', 'desc')
      .limit(60)
      .execute();
    const media = await mediaRefs(ctx, rows.map((r) => r.media_id));
    return rows.filter((r) => media.has(r.media_id)).map((r) => ({ problemId: r.id, status: r.status, photo: media.get(r.media_id)! }));
  });

  app.get('/v1/problems/:id', async (req) => {
    const viewer = await optionalUser(ctx, req);
    if (!viewer?.onboarded) await requireUser(ctx, req);
    return problemDetail(ctx, (req.params as { id: string }).id, viewer!.id);
  });

  // ---- Create (L-01…L-03, L-10, S-02, A-01, A-05)
  app.post('/v1/problems', async (req) => {
    // Raising or helping with a problem needs a verified phone (it keeps neighbours safe).
    const user = await requireUser(ctx, req, { write: true, verified: true });
    const input = parse(CreateProblemInputSchema, req.body);
    let category;
    try {
      category = findCategory(input.categoryId).category;
    } catch {
      throw badRequest('VALIDATION', 'Pick a category.');
    }
    const kind = category.defaultKind;
    if (category.requiresLanguage && !input.languageNeeded) throw badRequest('LANGUAGE_REQUIRED', 'Say which languages you need help with.');
    let area;
    try {
      area = snapToArea(input.point, input.precision, kind);
    } catch (e) {
      if (e instanceof GeoRuleError) throw badRequest('EXACT_SPOT_ONLY_FOR_ISSUES', 'Exact public spots are only for community problems.');
      throw e;
    }
    const launch = await ctx.db.selectFrom('launch_area_cells').select(['launch_area_id', 'district']).where('cell_r7', '=', area.cellR7).executeTakeFirst();
    if (!launch) throw badRequest('OUTSIDE_LAUNCH_AREA', `HelpIn is only in ${LAUNCH_AREA.name} for now.`);
    await rateLimit(ctx.db, { userId: user.id }, 'create_problem', RATE_LIMITS.createProblem, 'You’ve posted a lot today. Try again tomorrow.');

    const t = now();
    const u = await ctx.db.selectFrom('users').select(['on_notice_until', 'anonymous_banned_until']).where('id', '=', user.id).executeTakeFirstOrThrow();
    const recent = await ctx.db.selectFrom('problems').select(sql<number>`count(*)::int`.as('n')).where('owner_id', '=', user.id).where('created_at', '>', new Date(t.getTime() - DAY)).executeTakeFirst();
    assertCanPost({ onNoticeUntil: u.on_notice_until, anonymousBannedUntil: u.anonymous_banned_until, problemsLast24h: recent?.n ?? 0, anonymous: input.anonymous, now: t });
    if (input.communityId) {
      const member = await ctx.db.selectFrom('community_members').select('user_id').where('community_id', '=', input.communityId).where('user_id', '=', user.id).executeTakeFirst();
      if (!member) throw forbidden('NOT_A_MEMBER', 'Join the community first.');
    }
    const locality = await ctx.geocoder.locality(area.areaCell);

    const id = await ctx.db.transaction().execute(async (tx) => {
      await attachMedia(tx, user.id, input.mediaIds, 'problem_photo');
      const incident = await tx
        .insertInto('incidents')
        .values({
          category: category.id,
          kind,
          area_cell: area.areaCell,
          area_res: area.areaRes,
          cell_r8: area.cellR8,
          cell_r7: area.cellR7,
          cell_r6: area.cellR6,
          center_lat: area.center.lat,
          center_lng: area.center.lng,
          locality,
          max_urgency: input.urgency,
          created_at: t,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const problem = await tx
        .insertInto('problems')
        .values({
          incident_id: incident.id,
          owner_id: user.id,
          category: category.id,
          kind,
          is_anonymous: input.anonymous,
          language_needed: input.languageNeeded,
          title: input.title.trim(),
          description: input.description.trim(),
          urgency: input.urgency,
          area_cell: area.areaCell,
          area_res: area.areaRes,
          cell_r8: area.cellR8,
          cell_r7: area.cellR7,
          cell_r6: area.cellR6,
          center_lat: area.center.lat,
          center_lng: area.center.lng,
          launch_area_id: launch.launch_area_id,
          last_activity_at: t,
          max_life_at: maxLifeAt(kind, input.urgency, t),
          created_at: t,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // L-03: the exact point is kept only if the asker asked, in a separate private table.
      if (input.saveExactPrivately) {
        await tx.insertInto('problem_private_locations').values({ problem_id: problem.id, lat: input.point.lat, lng: input.point.lng }).execute();
      }
      for (const [i, mediaId] of input.mediaIds.entries()) {
        await tx.insertInto('problem_photos').values({ media_id: mediaId, problem_id: problem.id, position: i, created_at: t }).execute();
      }
      if (input.communityId) {
        await tx.insertInto('community_problem_shares').values({ community_id: input.communityId, problem_id: problem.id, shared_by: user.id, created_at: t }).execute();
      }
      await appendEvent(tx, { type: 'ProblemCreated', problemId: problem.id });
      return problem.id;
    });
    return problemDetail(ctx, id, user.id);
  });

  // ---- Progress updates (R-40…R-46)
  app.post('/v1/problems/:id/updates', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const id = (req.params as { id: string }).id;
    const input = parse(PostUpdateInputSchema, req.body);
    const detail = await problemDetail(ctx, id, user.id);
    if (detail.status !== 'open') throw new ApiError(409, 'PROBLEM_NOT_OPEN', 'This problem is already closed.');
    const role = detail.viewerRole;
    const authorRole = role === 'asker' ? 'asker' : role === 'helper_accepted' || role === 'helper_offered' ? 'helper' : role === 'affected' ? 'affected' : null;
    if (!authorRole) throw forbidden('FORBIDDEN', 'Offer help first to post updates.');
    if (input.progressStatus === 'need_changed' && authorRole !== 'asker') throw forbidden('FORBIDDEN', 'Only the asker can change the need.');
    await rateLimit(ctx.db, { userId: user.id }, `update:${id}`, RATE_LIMITS.update, 'That’s a lot of updates for today.'); // R-45
    await ctx.db.transaction().execute(async (tx) => {
      await attachMedia(tx, user.id, input.mediaIds ?? [], 'problem_photo');
      const t = now();
      const update = await tx
        .insertInto('problem_updates')
        .values({ problem_id: id, author_id: user.id, author_role: authorRole, progress_status: input.progressStatus, body: input.body?.trim() || null, created_at: t })
        .returning('id')
        .executeTakeFirstOrThrow();
      const taken = await tx.selectFrom('problem_photos').select(sql<number>`coalesce(max(position) + 1, 0)::int`.as('next')).where('problem_id', '=', id).executeTakeFirst();
      let pos = Math.min(taken?.next ?? 0, 5 - (input.mediaIds?.length ?? 0) + 1);
      for (const mediaId of input.mediaIds ?? []) {
        await tx.insertInto('problem_photos').values({ media_id: mediaId, problem_id: id, update_id: update.id, position: Math.max(0, Math.min(5, pos++)), created_at: t }).execute();
      }
      if (authorRole === 'asker') await raiserResponded(tx, id); // R-53
      else await tx.updateTable('problems').set({ last_activity_at: t }).where('id', '=', id).execute(); // R-56
      await appendEvent(tx, { type: 'ProblemUpdated', problemId: id, updateId: update.id });
      await touchProblem(tx, id);
    });
    return problemDetail(ctx, id, user.id);
  });

  app.post('/v1/problems/:id/still-need-help', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const id = (req.params as { id: string }).id;
    const row = await loadProblemRow(ctx, id);
    if (!row || row.owner_id !== user.id) throw notFound('That problem');
    if (row.status !== 'open') throw new ApiError(409, 'PROBLEM_NOT_OPEN', 'This problem is already closed.');
    await ctx.db.transaction().execute(async (tx) => {
      await tx.insertInto('problem_updates').values({ problem_id: id, author_id: user.id, author_role: 'asker', progress_status: 'still_need_help', created_at: now() }).execute();
      await raiserResponded(tx, id);
      await touchProblem(tx, id);
    });
    return problemDetail(ctx, id, user.id);
  });

  app.post('/v1/problems/:id/withdraw', async (req) => {
    const user = await requireUser(ctx, req);
    const id = (req.params as { id: string }).id;
    const { reason } = parse(z.object({ reason: z.string().min(1).max(200) }), req.body);
    await ctx.db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('problems').select(['id', 'owner_id', 'status', 'incident_id']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p || p.owner_id !== user.id) throw notFound('That problem');
      if (p.status !== 'open') throw new ApiError(409, 'PROBLEM_NOT_OPEN', 'This problem is already closed.');
      const t = now();
      await tx.updateTable('problems').set({ status: 'withdrawn', closed_at: t }).where('id', '=', id).where('status', '=', 'open').execute();
      await tx.insertInto('problem_updates').values({ problem_id: id, author_id: user.id, author_role: 'asker', progress_status: 'note', body: `Withdrawn: ${reason}`, created_at: t }).execute();
      await onProblemTerminal(tx, id, p.incident_id);
      await systemMessage(tx, id, 'The asker withdrew this problem.');
      await appendEvent(tx, { type: 'ProblemClosed', problemId: id, status: 'withdrawn' });
      await touchProblem(tx, id);
    });
    return problemDetail(ctx, id, user.id);
  });

  // ---- "Same here" (R-30) and "Fixed now" (R-21)
  app.post('/v1/problems/:id/affected', async (req) => {
    // Raising or helping with a problem needs a verified phone (it keeps neighbours safe).
    const user = await requireUser(ctx, req, { write: true, verified: true });
    const id = (req.params as { id: string }).id;
    const row = await loadProblemRow(ctx, id);
    if (!row || row.hidden_at) throw notFound('That problem');
    if (row.status !== 'open') throw new ApiError(409, 'PROBLEM_NOT_OPEN', 'This problem is already closed.');
    if (row.kind !== 'issue') throw badRequest('NOT_AN_ISSUE', '"Same here" is for community problems.');
    if (row.owner_id === user.id) throw forbidden('FORBIDDEN', 'You reported this one.');
    await ctx.db.transaction().execute(async (tx) => {
      const ins = await tx
        .insertInto('incident_affected')
        .values({ incident_id: row.incident_id, user_id: user.id, created_at: now() })
        .onConflict((oc) => oc.columns(['incident_id', 'user_id']).doNothing())
        .returning('user_id')
        .executeTakeFirst();
      await syncIncident(tx, row.incident_id);
      if (ins) await appendEvent(tx, { type: 'AffectedAdded', problemId: id, userId: user.id });
    });
    return problemDetail(ctx, id, user.id);
  });

  app.delete('/v1/problems/:id/affected', async (req) => {
    const user = await requireUser(ctx, req);
    const id = (req.params as { id: string }).id;
    const row = await loadProblemRow(ctx, id);
    if (!row) throw notFound('That problem');
    await ctx.db.transaction().execute(async (tx) => {
      await tx.deleteFrom('incident_affected').where('incident_id', '=', row.incident_id).where('user_id', '=', user.id).execute();
      await syncIncident(tx, row.incident_id);
    });
    return problemDetail(ctx, id, user.id);
  });

  app.post('/v1/problems/:id/fixed', async (req) => {
    // Raising or helping with a problem needs a verified phone (it keeps neighbours safe).
    const user = await requireUser(ctx, req, { write: true, verified: true });
    const id = (req.params as { id: string }).id;
    await ctx.db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('problems').select(['id', 'incident_id', 'status', 'kind', 'owner_id']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p) throw notFound('That problem');
      if (p.status !== 'open') throw new ApiError(409, 'PROBLEM_NOT_OPEN', 'This problem is already closed.');
      const t = now();
      const mine = await tx
        .updateTable('incident_affected')
        .set({ fixed_confirmed_at: t })
        .where('incident_id', '=', p.incident_id)
        .where('user_id', '=', user.id)
        .returning('user_id')
        .executeTakeFirst();
      if (!mine) throw forbidden('NOT_AFFECTED', 'Only affected neighbours can confirm a fix.');
      const votes = await tx.selectFrom('incident_affected').select('fixed_confirmed_at').where('incident_id', '=', p.incident_id).where('fixed_confirmed_at', 'is not', null).execute();
      const decision = decideFixedNow(votes.map((v) => v.fixed_confirmed_at!), t);
      if (decision.solved) {
        await tx
          .updateTable('problems')
          .set({ status: 'solved', solved_via: 'fixed_quorum', solved_at: t, closed_at: t, credit_deadline: decision.creditDeadline })
          .where('id', '=', id)
          .where('status', '=', 'open')
          .execute();
        await onProblemTerminal(tx, id, p.incident_id);
        await systemMessage(tx, id, `${FIXED_QUORUM} neighbours confirmed this is fixed.`);
        await appendEvent(tx, { type: 'ProblemSolved', problemId: id, via: 'fixed_quorum' });
      }
      await touchProblem(tx, id);
    });
    return problemDetail(ctx, id, user.id);
  });

  // ---- Confirm solved (§4.3): one transaction, row locks, decide, write, events
  app.post('/v1/problems/:id/confirm-solved', async (req) => {
    const user = await requireUser(ctx, req);
    const id = (req.params as { id: string }).id;
    const { creditedOfferIds } = parse(z.object({ creditedOfferIds: z.array(z.string()).max(10) }), req.body);
    const result = await ctx.db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('problems').select(['id', 'owner_id', 'kind', 'status', 'incident_id', 'solved_via', 'credit_deadline']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p) throw notFound('That problem');
      const offers = await tx.selectFrom('help_offers').select(['id', 'problem_id', 'helper_id', 'status', 'created_at']).where('problem_id', '=', id).forUpdate().execute();
      const t = now();
      const asker = await tx.selectFrom('users').select(['phone_verified_at', 'created_at']).where('id', '=', user.id).executeTakeFirstOrThrow();
      const closings = await tx
        .selectFrom('karma_entries')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('user_id', '=', user.id)
        .where('reason', '=', 'closing_award')
        .where('created_at', '>', new Date(t.getTime() - 7 * DAY))
        .executeTakeFirst();
      const helperIds = offers.filter((o) => creditedOfferIds.includes(o.id)).map((o) => o.helper_id);
      const decision = decideConfirmSolved({
        problem: snapshot(p),
        callerId: user.id,
        offers: offerSnapshots(offers),
        creditedOfferIds,
        helperFacts: await helperFacts(tx, user.id, helperIds),
        asker: { eligible: isKarmaEligible({ phoneVerifiedAt: asker.phone_verified_at, createdAt: asker.created_at }, t), closingAwardsLast7Days: closings?.n ?? 0 },
        now: t,
      });
      // R-06: the optimistic check means a concurrent confirm can't solve twice.
      const updated = await tx
        .updateTable('problems')
        .set({ status: 'solved', solved_via: 'asker', solved_at: t, closed_at: t, last_raiser_response_at: t })
        .where('id', '=', id)
        .where('status', '=', 'open')
        .returning('id')
        .executeTakeFirst();
      if (!updated) throw new ApiError(409, 'PROBLEM_NOT_OPEN', 'This problem is already closed.');
      await writeCredits(tx, id, user.id, decision.credits);
      if (decision.askerAward) {
        await tx.insertInto('karma_entries').values({ user_id: user.id, amount: decision.askerAward.amount, reason: 'closing_award', problem_id: id, created_at: t }).execute();
        await appendEvent(tx, { type: 'AskerClosingAward', problemId: id, amount: decision.askerAward.amount });
      }
      await onProblemTerminal(tx, id, p.incident_id, decision.credits.map((c) => c.offerId));
      await refreshKarmaCaches(tx, [user.id, ...decision.credits.map((c) => c.helperId)]);
      await systemMessage(tx, id, 'Marked as solved. Thank you for helping!');
      await appendEvent(tx, { type: 'ProblemSolved', problemId: id, via: 'asker' });
      await touchProblem(tx, id);
      return { credited: decision.credits.length, askerAward: decision.askerAward?.amount ?? 0 };
    });
    return { problem: await problemDetail(ctx, id, user.id), ...result };
  });

  // ---- R-22: credit helpers after a fixed-quorum solve
  app.post('/v1/problems/:id/credit', async (req) => {
    const user = await requireUser(ctx, req);
    const id = (req.params as { id: string }).id;
    const { creditedOfferIds } = parse(z.object({ creditedOfferIds: z.array(z.string()).min(1).max(KARMA.maxCreditedHelpers) }), req.body);
    const credited = await ctx.db.transaction().execute(async (tx) => {
      const p = await tx.selectFrom('problems').select(['id', 'owner_id', 'kind', 'status', 'solved_via', 'credit_deadline']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p) throw notFound('That problem');
      const offers = await tx.selectFrom('help_offers').select(['id', 'problem_id', 'helper_id', 'status', 'created_at']).where('problem_id', '=', id).forUpdate().execute();
      const credits = decideCreditAfterQuorum({
        problem: snapshot(p),
        callerId: user.id,
        offers: offerSnapshots(offers),
        creditedOfferIds,
        alreadyCredited: offers.some((o) => o.status === 'credited'),
        helperFacts: await helperFacts(tx, user.id, offers.filter((o) => creditedOfferIds.includes(o.id)).map((o) => o.helper_id)),
        now: now(),
      });
      await writeCredits(tx, id, user.id, credits);
      await refreshKarmaCaches(tx, credits.map((c) => c.helperId));
      await touchProblem(tx, id);
      return credits.length;
    });
    return { problem: await problemDetail(ctx, id, user.id), credited, askerAward: 0 };
  });

  // ---- COM-04: share a problem to a community
  app.post('/v1/problems/:id/share', async (req) => {
    const user = await requireUser(ctx, req, { write: true });
    const id = (req.params as { id: string }).id;
    const { communityId } = parse(z.object({ communityId: z.string() }), req.body);
    const detail = await problemDetail(ctx, id, user.id);
    if (detail.status !== 'open') throw new ApiError(409, 'PROBLEM_NOT_OPEN', 'This problem is already closed.');
    const member = await ctx.db.selectFrom('community_members').select('user_id').where('community_id', '=', communityId).where('user_id', '=', user.id).executeTakeFirst();
    if (!member) throw forbidden('NOT_A_MEMBER', 'Join the community first.');
    await ctx.db
      .insertInto('community_problem_shares')
      .values({ community_id: communityId, problem_id: id, shared_by: user.id, created_at: now() })
      .onConflict((oc) => oc.columns(['community_id', 'problem_id']).doNothing())
      .execute();
    return { ok: true };
  });

}

/**
 * Presenters: the privacy boundary (L-01, L-03, A-01). Everything public is built here from
 * explicitly selected columns. Exact locations, phone numbers, emails and anonymous askers'
 * ids never leave this file in a public shape.
 */
import { RELIABILITY } from '@helpin/config';
import type { Asker, MediaRef, ProblemCard, PublicUser } from '@helpin/contracts';
import { sql } from '@helpin/db';
import { reliability as reliabilityOf } from '@helpin/domain';
import type { Ctx } from './platform/context';
import { DAY, now } from './platform/clock';

const COLORS = ['brand', 'sapphire', 'amber', 'coral', 'tram', 'mint'];

export function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/* ------------------------------------------------------------------ Media */

const MEDIA_URL_TTL = 3600;

export interface MediaRow {
  id: string;
  status: string;
  width: number | null;
  height: number | null;
  blurhash: string | null;
}

export async function mediaRef(ctx: Ctx, m: MediaRow): Promise<MediaRef | null> {
  if (m.status !== 'ready') return null;
  const [url, thumbUrl, fullUrl] = await Promise.all(
    [800, 320, 1600].map((size) => ctx.storage.downloadUrl(`media/${m.id}/${size}.webp`, MEDIA_URL_TTL)),
  );
  return { id: m.id, url: url!, thumbUrl: thumbUrl!, fullUrl: fullUrl!, width: m.width, height: m.height, blurhash: m.blurhash };
}

export async function mediaRefs(ctx: Ctx, ids: string[]): Promise<Map<string, MediaRef>> {
  const out = new Map<string, MediaRef>();
  if (!ids.length) return out;
  const rows = await ctx.db.selectFrom('media').select(['id', 'status', 'width', 'height', 'blurhash']).where('id', 'in', ids).execute();
  await Promise.all(
    rows.map(async (r) => {
      const ref = await mediaRef(ctx, r);
      if (ref) out.set(r.id, ref);
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ Users */

/** K-15 for many users at once. */
export async function reliabilities(ctx: Ctx, userIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(userIds.map((id) => [id, null]));
  if (!userIds.length) return out;
  const since = new Date(now().getTime() - RELIABILITY.windowDays * DAY);
  const rows = await ctx.db
    .selectFrom('problems as p')
    .select(['p.owner_id', 'p.penalized_at'])
    .where('p.owner_id', 'in', userIds)
    .where('p.kind', '=', 'request')
    .where('p.created_at', '>=', since)
    .where('p.status', '!=', 'open')
    .where('p.response_due_at', 'is not', null) // got help: the clock only starts with an offer
    .execute();
  for (const id of userIds) {
    const mine = rows.filter((r) => r.owner_id === id).map((r) => ({ gotHelp: true, penalized: !!r.penalized_at }));
    out.set(id, reliabilityOf(mine));
  }
  return out;
}

export async function publicUsers(ctx: Ctx, ids: string[]): Promise<Map<string, PublicUser>> {
  const unique = [...new Set(ids)].filter(Boolean);
  const out = new Map<string, PublicUser>();
  if (!unique.length) return out;
  const rows = await ctx.db
    .selectFrom('users as u')
    .innerJoin('profiles as p', 'p.user_id', 'u.id')
    .select(['u.id', 'u.phone_verified_at', 'u.status', 'p.display_name', 'p.avatar_media_id', 'p.karma_balance', 'p.neighbours_helped', 'p.languages', 'p.is_newcomer'])
    .where('u.id', 'in', unique)
    .execute();
  const [rel, avatars] = await Promise.all([
    reliabilities(ctx, unique),
    mediaRefs(ctx, rows.map((r) => r.avatar_media_id).filter((x): x is string => !!x)),
  ]);
  for (const r of rows) {
    const deleted = r.status === 'deleted';
    const name = deleted ? 'Deleted user' : r.display_name;
    out.set(r.id, {
      id: r.id,
      displayName: name,
      initials: initialsOf(name),
      color: colorFor(r.id),
      avatar: deleted || !r.avatar_media_id ? null : (avatars.get(r.avatar_media_id) ?? null),
      karma: r.karma_balance,
      neighboursHelped: r.neighbours_helped,
      reliability: rel.get(r.id) ?? null,
      languages: deleted ? [] : r.languages,
      isNewcomer: !deleted && r.is_newcomer,
      verified: !!r.phone_verified_at,
    });
  }
  return out;
}

export async function publicUser(ctx: Ctx, id: string): Promise<PublicUser | null> {
  return (await publicUsers(ctx, [id])).get(id) ?? null;
}

/** A-01: the asker as the public sees them. */
export function presentAsker(p: { owner_id: string; is_anonymous: boolean }, users: Map<string, PublicUser>, rel: Map<string, number | null>): Asker {
  if (p.is_anonymous) return { anonymous: true, reliability: rel.get(p.owner_id) ?? null };
  const user = users.get(p.owner_id);
  if (!user) return { anonymous: true, reliability: null };
  return { anonymous: false, user };
}

/* ------------------------------------------------------------------ Problem cards */

export const CARD_COLUMNS = [
  'p.id',
  'p.incident_id',
  'p.title',
  'p.category',
  'p.kind',
  'p.urgency',
  'p.status',
  'p.area_cell',
  'p.area_res',
  'p.cell_r7',
  'p.center_lat',
  'p.center_lng',
  'p.language_needed',
  'p.created_at',
  'p.last_activity_at',
  'p.owner_id',
  'p.is_anonymous',
] as const;

export interface CardRow {
  id: string;
  incident_id: string;
  title: string;
  category: string;
  kind: string;
  urgency: string;
  status: string;
  area_cell: string;
  area_res: number;
  cell_r7: string;
  center_lat: number;
  center_lng: number;
  language_needed: string | null;
  created_at: Date;
  last_activity_at: Date;
  owner_id: string;
  is_anonymous: boolean;
}

export async function presentCards(ctx: Ctx, rows: CardRow[]): Promise<ProblemCard[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [incidents, offerCounts, latest, photos, districts] = await Promise.all([
    ctx.db.selectFrom('incidents').select(['id', 'affected_count', 'locality']).where('id', 'in', rows.map((r) => r.incident_id)).execute(),
    ctx.db
      .selectFrom('help_offers')
      .select(['problem_id', sql<number>`count(*) FILTER (WHERE status IN ('offered','accepted','credited'))::int`.as('offers'), sql<number>`count(*) FILTER (WHERE status IN ('accepted','credited'))::int`.as('helping')])
      .where('problem_id', 'in', ids)
      .groupBy('problem_id')
      .execute(),
    // R-41: the latest asker update is what the card summarises.
    ctx.db
      .selectFrom('problem_updates')
      .distinctOn('problem_id')
      .select(['problem_id', 'progress_status'])
      .where('problem_id', 'in', ids)
      .where('author_role', '=', 'asker')
      .where('status', '=', 'visible')
      .orderBy('problem_id')
      .orderBy('created_at', 'desc')
      .execute(),
    ctx.db
      .selectFrom('problem_photos as pp')
      .innerJoin('media as m', 'm.id', 'pp.media_id')
      .select(['pp.problem_id', 'pp.media_id', 'pp.position', 'm.status'])
      .where('pp.problem_id', 'in', ids)
      .where('pp.update_id', 'is', null)
      .where('m.status', '=', 'ready')
      .orderBy('pp.position')
      .execute(),
    ctx.db.selectFrom('launch_area_cells').select(['cell_r7', 'district']).where('cell_r7', 'in', [...new Set(rows.map((r) => r.cell_r7))]).execute(),
  ]);
  const owners = rows.map((r) => r.owner_id);
  const [users, rel, covers] = await Promise.all([
    publicUsers(ctx, rows.filter((r) => !r.is_anonymous).map((r) => r.owner_id)),
    reliabilities(ctx, owners),
    mediaRefs(ctx, [...new Map(photos.map((ph) => [ph.problem_id, ph.media_id])).values()]),
  ]);
  return rows.map((r) => {
    const inc = incidents.find((i) => i.id === r.incident_id);
    const counts = offerCounts.find((c) => c.problem_id === r.id);
    const mine = photos.filter((ph) => ph.problem_id === r.id);
    const district = districts.find((d) => d.cell_r7 === r.cell_r7)?.district ?? '';
    return {
      id: r.id,
      incidentId: r.incident_id,
      title: r.title,
      categoryId: r.category,
      kind: r.kind as ProblemCard['kind'],
      urgency: r.urgency as ProblemCard['urgency'],
      status: r.status as ProblemCard['status'],
      area: {
        areaCell: r.area_cell,
        areaRes: r.area_res as 7 | 8 | 9,
        locality: inc?.locality ?? (district ? `District ${district}` : 'Budapest'),
        district,
        center: { lat: r.center_lat, lng: r.center_lng },
      },
      languageNeeded: r.language_needed,
      createdAt: r.created_at.toISOString(),
      lastActivityAt: r.last_activity_at.toISOString(),
      latestProgress: (latest.find((l) => l.problem_id === r.id)?.progress_status ?? null) as ProblemCard['latestProgress'],
      helpingCount: counts?.helping ?? 0,
      offersCount: counts?.offers ?? 0,
      affectedCount: inc?.affected_count ?? 1,
      photoCount: mine.length,
      coverPhoto: mine[0] ? (covers.get(mine[0].media_id) ?? null) : null,
      asker: presentAsker(r, users, rel),
    };
  });
}

/* ------------------------------------------------------------------ Blocks (S-03) */

/** Users the viewer has blocked or is blocked by. */
export async function blockedIds(ctx: Ctx, userId: string | null): Promise<string[]> {
  if (!userId) return [];
  const rows = await ctx.db
    .selectFrom('blocks')
    .select(['blocker_id', 'blocked_id'])
    .where((eb) => eb.or([eb('blocker_id', '=', userId), eb('blocked_id', '=', userId)]))
    .execute();
  return rows.map((r) => (r.blocker_id === userId ? r.blocked_id : r.blocker_id));
}

export async function isBlockedEitherWay(ctx: Ctx, a: string, b: string): Promise<boolean> {
  const row = await ctx.db
    .selectFrom('blocks')
    .select('blocker_id')
    .where((eb) => eb.or([eb.and([eb('blocker_id', '=', a), eb('blocked_id', '=', b)]), eb.and([eb('blocker_id', '=', b), eb('blocked_id', '=', a)])]))
    .executeTakeFirst();
  return !!row;
}

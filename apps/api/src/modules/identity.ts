import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CATEGORY_GROUPS, LANGUAGES, LAUNCH_AREA, LIMITS, RATE_LIMITS, URGENCY } from '@helpin/config';
import {
  AlertPrefsSchema,
  OnboardingInputSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  ProfileInputSchema,
  PushSubscriptionInputSchema,
  type AlertPrefs,
  type KarmaEntry,
  type Me,
  type Session,
} from '@helpin/contracts';
import { sql } from '@helpin/db';
import { getResolution, isValidCell } from 'h3-js';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, requireUser, signAccessToken, type Claims } from '../platform/auth';
import { DAY, now } from '../platform/clock';
import type { Ctx } from '../platform/context';
import { newTotpSecret, randomToken, sha256, sixDigitCode, verifyTotp } from '../platform/crypto';
import { adminEmails } from '../platform/env';
import { ApiError, badRequest, conflict, forbidden, notFound, tooMany, unauthorized } from '../platform/errors';
import { iso, parse } from '../platform/http';
import { rateLimit } from '../platform/ratelimit';
import { colorFor, initialsOf, mediaRefs, publicUser, reliabilities } from '../views';

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

/* ------------------------------------------------------------------ Normalising contacts */

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let e164 = digits.startsWith('+') ? digits : digits.startsWith('00') ? `+${digits.slice(2)}` : digits.startsWith('06') ? `+36${digits.slice(2)}` : `+36${digits}`;
  e164 = e164.replace(/(?!^)\+/g, '');
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

export const normalizeEmail = (input: string) => {
  const e = input.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
};

export function maskPhone(e164: string): string {
  return `${e164.slice(0, 3)} ${e164.slice(3, 5)} *** **${e164.slice(-2)}`;
}

const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name!.slice(0, 2)}${'•'.repeat(Math.max(1, name!.length - 2))}@${domain}`;
};

/* ------------------------------------------------------------------ OTP challenges */

async function createChallenge(
  ctx: Ctx,
  req: FastifyRequest,
  input: { channel: 'sms' | 'email'; destination: string; purpose: 'login' | 'verify_phone'; userId?: string },
) {
  await rateLimit(ctx.db, { key: input.destination }, 'otp', RATE_LIMITS.otpPerDestination, 'Too many codes requested. Try again in an hour.');
  await rateLimit(ctx.db, { key: req.ip }, 'otp_ip', RATE_LIMITS.otpPerIp, 'Too many codes requested. Try again in an hour.');
  const code = sixDigitCode();
  const row = await ctx.db
    .insertInto('otp_challenges')
    .values({
      channel: input.channel,
      destination: input.destination,
      purpose: input.purpose,
      user_id: input.userId ?? null,
      code_hash: 'pending',
      expires_at: new Date(now().getTime() + OTP_TTL_MS),
      created_at: now(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.db.updateTable('otp_challenges').set({ code_hash: sha256(`${row.id}:${code}`) }).where('id', '=', row.id).execute();
  const text = `${code} is your HelpIn code. It expires in 10 minutes. Never share it with anyone.`;
  if (input.channel === 'sms') await ctx.sms.send(input.destination, text);
  else await ctx.email.send(input.destination, `${code} is your HelpIn code`, text);
  const devCode = ctx.env.NODE_ENV !== 'production' && (input.channel === 'sms' ? ctx.sms.kind : ctx.email.kind) === 'console' ? code : undefined;
  return {
    challengeId: row.id,
    sentTo: input.channel === 'sms' ? maskPhone(input.destination) : maskEmail(input.destination),
    ...(devCode ? { devCode } : {}),
  };
}

async function consumeChallenge(ctx: Ctx, challengeId: string, code: string, purpose: 'login' | 'verify_phone') {
  const ch = await ctx.db.selectFrom('otp_challenges').selectAll().where('id', '=', challengeId).executeTakeFirst();
  if (!ch || ch.purpose !== purpose || ch.consumed_at) throw badRequest('NO_PENDING_CODE', 'Request a new code.');
  if (ch.expires_at < now()) throw badRequest('CODE_EXPIRED', 'That code has expired. Request a new one.');
  if (ch.attempts >= OTP_MAX_ATTEMPTS) throw tooMany('Too many tries. Request a new code in a few minutes.');
  const devOk = !!ctx.env.AUTH_DEV_CODE && ctx.env.NODE_ENV !== 'production' && code === ctx.env.AUTH_DEV_CODE;
  if (!devOk && sha256(`${ch.id}:${code}`) !== ch.code_hash) {
    const attempts = ch.attempts + 1;
    await ctx.db.updateTable('otp_challenges').set({ attempts }).where('id', '=', ch.id).execute();
    throw new ApiError(400, 'CODE_MISMATCH', "That code didn't match.", { triesLeft: Math.max(0, OTP_MAX_ATTEMPTS - attempts) });
  }
  const consumed = await ctx.db
    .updateTable('otp_challenges')
    .set({ consumed_at: now() })
    .where('id', '=', ch.id)
    .where('consumed_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  if (!consumed) throw badRequest('NO_PENDING_CODE', 'Request a new code.');
  return ch;
}

/* ------------------------------------------------------------------ Sessions */

async function issueSession(ctx: Ctx, userId: string, userAgent: string | undefined): Promise<Session> {
  const refreshToken = randomToken();
  const t = now();
  const session = await ctx.db
    .insertInto('sessions')
    .values({
      user_id: userId,
      refresh_token_hash: sha256(refreshToken),
      user_agent: userAgent?.slice(0, 300) ?? null,
      created_at: t,
      last_used_at: t,
      expires_at: new Date(t.getTime() + REFRESH_TTL_DAYS * DAY),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const user = await ctx.db.selectFrom('users').select('role').where('id', '=', userId).executeTakeFirstOrThrow();
  const accessToken = await signAccessToken(ctx, { sub: userId, sid: session.id, role: user.role as Claims['role'], mfa: false });
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS, me: await buildMe(ctx, userId, false) };
}

/* ------------------------------------------------------------------ Me */

const DEFAULT_PREFS: AlertPrefs = {
  enabled: true,
  ring: 1,
  categories: [],
  minUrgency: 'basic',
  dailyCap: 5,
  quietStart: null,
  quietEnd: null,
  seriousInQuiet: false,
  emailDigest: true,
};

export async function buildMe(ctx: Ctx, userId: string, mfaVerified: boolean): Promise<Me> {
  const u = await ctx.db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst();
  if (!u || u.status === 'deleted') throw unauthorized();
  const [profile, prefs, posts, totp, pushCount, rel, homeDistrict] = await Promise.all([
    ctx.db.selectFrom('profiles').selectAll().where('user_id', '=', userId).executeTakeFirst(),
    ctx.db.selectFrom('alert_prefs').selectAll().where('user_id', '=', userId).executeTakeFirst(),
    ctx.db.selectFrom('posts').select(sql<number>`count(*)::int`.as('n')).where('author_id', '=', userId).where('status', '=', 'visible').executeTakeFirst(),
    ctx.db.selectFrom('user_totp').select('enabled_at').where('user_id', '=', userId).executeTakeFirst(),
    ctx.db.selectFrom('push_subscriptions').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', userId).executeTakeFirst(),
    reliabilities(ctx, [userId]),
    ctx.db
      .selectFrom('profiles as p')
      .innerJoin('launch_area_cells as c', 'c.cell_r7', 'p.home_cell_r7')
      .select('c.district')
      .where('p.user_id', '=', userId)
      .executeTakeFirst(),
  ]);
  const avatar = profile?.avatar_media_id ? (await mediaRefs(ctx, [profile.avatar_media_id])).get(profile.avatar_media_id) ?? null : null;
  const name = profile?.display_name ?? '';
  const t = now();
  const onNotice = u.on_notice_until && u.on_notice_until > t ? u.on_notice_until : null;
  const anonBanned = !!u.anonymous_banned_until && u.anonymous_banned_until > t;
  const onboarding = {
    adultConfirmed: !!u.adult_confirmed_at,
    guidelinesAccepted: !!u.guidelines_accepted_at,
    profileDone: !!profile,
    homeAreaSet: !!profile?.home_cell_r7,
    done: !!u.onboarded_at,
  };
  return {
    id: u.id,
    displayName: name,
    initials: name ? initialsOf(name) : '?',
    color: colorFor(u.id),
    avatar,
    karma: profile?.karma_balance ?? 0,
    neighboursHelped: profile?.neighbours_helped ?? 0,
    reliability: rel.get(u.id) ?? null,
    languages: profile?.languages ?? [],
    isNewcomer: profile?.is_newcomer ?? false,
    verified: !!u.phone_verified_at,
    role: u.role as Me['role'],
    phoneVerified: !!u.phone_verified_at,
    phoneMasked: u.phone_e164 ? maskPhone(u.phone_e164) : null,
    email: u.email,
    bio: profile?.bio ?? '',
    memberSince: u.created_at.toISOString(),
    postsCount: posts?.n ?? 0,
    homeCell: profile?.home_cell_r7 ?? null,
    homeDistrict: homeDistrict?.district ?? null,
    onboarding,
    onNoticeUntil: iso(onNotice),
    canPostAnonymously: !onNotice && !anonBanned,
    mfaEnabled: !!totp?.enabled_at,
    mfaVerified,
    alertPrefs: prefs
      ? {
          enabled: prefs.enabled,
          ring: prefs.ring,
          categories: prefs.categories,
          minUrgency: prefs.min_urgency as AlertPrefs['minUrgency'],
          dailyCap: prefs.daily_cap,
          quietStart: prefs.quiet_start?.slice(0, 5) ?? null,
          quietEnd: prefs.quiet_end?.slice(0, 5) ?? null,
          seriousInQuiet: prefs.serious_in_quiet,
          emailDigest: prefs.email_digest,
        }
      : DEFAULT_PREFS,
    pushSubscribed: (pushCount?.n ?? 0) > 0,
  };
}

/** Onboarding is done once every step is complete (ADR-018, S-01, L-05). */
async function refreshOnboarded(ctx: Ctx, userId: string) {
  const u = await ctx.db.selectFrom('users').select(['phone_verified_at', 'adult_confirmed_at', 'guidelines_accepted_at', 'onboarded_at']).where('id', '=', userId).executeTakeFirstOrThrow();
  const p = await ctx.db.selectFrom('profiles').select('home_cell_r7').where('user_id', '=', userId).executeTakeFirst();
  const done = !!(u.phone_verified_at && u.adult_confirmed_at && u.guidelines_accepted_at && p?.home_cell_r7);
  if (done && !u.onboarded_at) await ctx.db.updateTable('users').set({ onboarded_at: now() }).where('id', '=', userId).execute();
}

/* ------------------------------------------------------------------ Karma history */

const KARMA_LABEL: Record<string, string> = {
  solve_award: 'Helped',
  closing_award: 'Closed',
  pair_cooldown: 'Helped',
  pair_cap: 'Helped',
  ineligible_account: 'Helped',
  abandonment_penalty: 'Missed the 2-day reply on',
  fake_problem_penalty: 'Fake problem removed:',
  reversal: 'Karma reversed for',
};

export async function karmaHistory(ctx: Ctx, userId: string): Promise<KarmaEntry[]> {
  const rows = await ctx.db
    .selectFrom('karma_entries as k')
    .leftJoin('problems as p', 'p.id', 'k.problem_id')
    .select(['k.id', 'k.amount', 'k.reason', 'k.created_at', 'p.title'])
    .where('k.user_id', '=', userId)
    .orderBy('k.created_at', 'desc')
    .orderBy('k.id', 'desc')
    .limit(100)
    .execute();
  return rows.map((r) => ({
    id: String(r.id),
    amount: r.amount,
    reason: r.reason as KarmaEntry['reason'],
    label: r.title ? `${KARMA_LABEL[r.reason] ?? ''} “${r.title}”`.trim() : (KARMA_LABEL[r.reason] ?? r.reason),
    createdAt: r.created_at.toISOString(),
  }));
}

/* ------------------------------------------------------------------ GDPR (S-07, S-08) */

async function exportData(ctx: Ctx, userId: string) {
  const db = ctx.db;
  const [user, profile, prefs, problems, updates, offers, messages, posts, comments, karma, reports, communities] = await Promise.all([
    db.selectFrom('users').select(['id', 'email', 'phone_e164', 'created_at', 'role', 'status']).where('id', '=', userId).executeTakeFirst(),
    db.selectFrom('profiles').selectAll().where('user_id', '=', userId).executeTakeFirst(),
    db.selectFrom('alert_prefs').selectAll().where('user_id', '=', userId).executeTakeFirst(),
    db.selectFrom('problems').select(['id', 'title', 'description', 'category', 'kind', 'urgency', 'status', 'is_anonymous', 'created_at', 'closed_at']).where('owner_id', '=', userId).execute(),
    db.selectFrom('problem_updates').select(['id', 'problem_id', 'progress_status', 'body', 'created_at']).where('author_id', '=', userId).execute(),
    db.selectFrom('help_offers').select(['id', 'problem_id', 'message', 'status', 'created_at']).where('helper_id', '=', userId).execute(),
    db.selectFrom('messages').select(['id', 'conversation_id', 'type', 'body', 'created_at']).where('sender_id', '=', userId).execute(),
    db.selectFrom('posts').select(['id', 'kind', 'caption', 'created_at', 'status']).where('author_id', '=', userId).execute(),
    db.selectFrom('comments').select(['id', 'post_id', 'body', 'created_at']).where('author_id', '=', userId).execute(),
    karmaHistory(ctx, userId),
    db.selectFrom('reports').select(['id', 'target_type', 'target_id', 'reason', 'created_at', 'status']).where('reporter_id', '=', userId).execute(),
    db.selectFrom('community_members as m').innerJoin('communities as c', 'c.id', 'm.community_id').select(['c.name', 'm.joined_at']).where('m.user_id', '=', userId).execute(),
  ]);
  return { exportedAt: now().toISOString(), user, profile, alertPrefs: prefs, problems, updates, offers, messages, posts, comments, karma, reports, communities };
}

/**
 * S-07: delete the account. Profile, posts, media and private locations are deleted; problems
 * and messages stay for the other people involved but show "Deleted user"; karma rows stay
 * (anonymised by the user row) for ledger integrity.
 */
async function deleteAccount(ctx: Ctx, userId: string) {
  const mediaKeys: string[] = [];
  await ctx.db.transaction().execute(async (tx) => {
    const t = now();
    const mine = await tx.selectFrom('problems').select('id').where('owner_id', '=', userId).execute();
    const problemIds = mine.map((p) => p.id);
    // Open problems end; helpers are told the problem was withdrawn.
    if (problemIds.length) {
      await tx.updateTable('problems').set({ status: 'withdrawn', closed_at: t }).where('id', 'in', problemIds).where('status', '=', 'open').execute();
      await tx.updateTable('help_offers').set({ status: 'closed', resolved_at: t }).where('problem_id', 'in', problemIds).where('status', 'in', ['offered', 'accepted']).execute();
      await tx.deleteFrom('problem_private_locations').where('problem_id', 'in', problemIds).execute();
    }
    await tx.updateTable('help_offers').set({ status: 'withdrawn', resolved_at: t }).where('helper_id', '=', userId).where('status', 'in', ['offered', 'accepted']).execute();
    const posts = await tx.selectFrom('posts').select('id').where('author_id', '=', userId).execute();
    if (posts.length) await tx.updateTable('posts').set({ status: 'removed' }).where('id', 'in', posts.map((p) => p.id)).execute();
    await tx.updateTable('comments').set({ status: 'removed' }).where('author_id', '=', userId).execute();
    await tx.updateTable('messages').set({ body: null, status: 'removed' }).where('sender_id', '=', userId).where('type', '=', 'text').execute();
    await tx.deleteFrom('messages').where('sender_id', '=', userId).where('type', '=', 'location').execute();
    const media = await tx.selectFrom('media').select('id').where('owner_id', '=', userId).execute();
    mediaKeys.push(...media.map((m) => m.id));
    if (media.length) await tx.updateTable('media').set({ status: 'deleted' }).where('owner_id', '=', userId).execute();
    await tx.updateTable('profiles').set({ display_name: 'Deleted user', bio: null, avatar_media_id: null, home_cell_r7: null, languages: [], is_newcomer: false }).where('user_id', '=', userId).execute();
    await tx.deleteFrom('alert_prefs').where('user_id', '=', userId).execute();
    await tx.deleteFrom('push_subscriptions').where('user_id', '=', userId).execute();
    await tx.deleteFrom('community_members').where('user_id', '=', userId).execute();
    await tx.deleteFrom('user_totp').where('user_id', '=', userId).execute();
    await tx.updateTable('sessions').set({ revoked_at: t }).where('user_id', '=', userId).execute();
    await tx.updateTable('users').set({ status: 'deleted', deleted_at: t, phone_e164: null, email: null }).where('id', '=', userId).execute();
  });
  await Promise.all(mediaKeys.flatMap((id) => [ctx.storage.remove(`media/${id}`), ctx.storage.remove(`quarantine/${id}`)]));
}

/* ------------------------------------------------------------------ Routes */

export function identityRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- Sign in / sign up (ADR-018)
  app.post('/v1/auth/otp', async (req) => {
    const body = parse(OtpRequestSchema, req.body);
    const destination = body.channel === 'sms' ? normalizePhone(body.destination) : normalizeEmail(body.destination);
    if (!destination) throw badRequest('VALIDATION', body.channel === 'sms' ? 'Enter a valid phone number.' : 'Enter a valid email address.');
    return createChallenge(ctx, req, { channel: body.channel, destination, purpose: 'login' });
  });

  app.post('/v1/auth/verify', async (req) => {
    const body = parse(OtpVerifySchema, req.body);
    const ch = await consumeChallenge(ctx, body.challengeId, body.code, 'login');
    const t = now();
    const column = ch.channel === 'sms' ? 'phone_e164' : 'email';
    let user = await ctx.db.selectFrom('users').select(['id', 'status', 'role']).where(column, '=', ch.destination).executeTakeFirst();
    if (user?.status === 'deleted') user = undefined;
    if (!user) {
      user = await ctx.db
        .insertInto('users')
        .values({ [column]: ch.destination, phone_verified_at: ch.channel === 'sms' ? t : null, created_at: t })
        .returning(['id', 'status', 'role'])
        .executeTakeFirstOrThrow();
      await ctx.db.insertInto('alert_prefs').values({ user_id: user.id }).execute();
    } else if (ch.channel === 'sms') {
      await ctx.db.updateTable('users').set({ phone_verified_at: t }).where('id', '=', user.id).where('phone_verified_at', 'is', null).execute();
    }
    // ADR-023: the founder's email(s) become admin; kept in a private secret, not the repo.
    if (ch.channel === 'email' && adminEmails(ctx.env).has(ch.destination) && user.role !== 'admin') {
      await ctx.db.updateTable('users').set({ role: 'admin' }).where('id', '=', user.id).execute();
    }
    return issueSession(ctx, user.id, req.headers['user-agent']);
  });

  app.post('/v1/auth/refresh', async (req) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20) }), req.body);
    const s = await ctx.db.selectFrom('sessions').selectAll().where('refresh_token_hash', '=', sha256(refreshToken)).executeTakeFirst();
    if (!s || s.revoked_at || s.expires_at < now()) throw unauthorized();
    const user = await ctx.db.selectFrom('users').select(['role', 'status']).where('id', '=', s.user_id).executeTakeFirst();
    if (!user || user.status === 'deleted') throw unauthorized();
    const next = randomToken();
    await ctx.db.updateTable('sessions').set({ refresh_token_hash: sha256(next), last_used_at: now() }).where('id', '=', s.id).execute();
    const mfa = !!s.mfa_verified_at;
    const accessToken = await signAccessToken(ctx, { sub: s.user_id, sid: s.id, role: user.role as Claims['role'], mfa });
    return { accessToken, refreshToken: next, expiresIn: ACCESS_TTL_SECONDS, me: await buildMe(ctx, s.user_id, mfa) } satisfies Session;
  });

  app.post('/v1/auth/logout', async (req) => {
    const user = await requireUser(ctx, req, { verified: false, onboarded: false });
    await ctx.db.updateTable('sessions').set({ revoked_at: now() }).where('id', '=', user.sessionId).execute();
    return { ok: true };
  });

  // ---- S-10: two-factor for staff
  app.post('/v1/auth/mfa/setup', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    if (user.role === 'user') throw forbidden('FORBIDDEN', 'Two-factor login is for admins and moderators.');
    // `reset` replaces a key that was never confirmed (e.g. mistyped into the authenticator app).
    const { reset } = parse(z.object({ reset: z.boolean().optional() }), req.body ?? {});
    const existing = await ctx.db.selectFrom('user_totp').selectAll().where('user_id', '=', user.id).executeTakeFirst();
    if (existing?.enabled_at) return { enabled: true, secret: null, otpauthUrl: null };
    let secret = existing?.secret ?? newTotpSecret();
    if (!existing) await ctx.db.insertInto('user_totp').values({ user_id: user.id, secret, created_at: now() }).execute();
    else if (reset) {
      secret = newTotpSecret();
      await ctx.db.updateTable('user_totp').set({ secret, created_at: now() }).where('user_id', '=', user.id).where('enabled_at', 'is', null).execute();
    }
    const account = await ctx.db.selectFrom('users').select('email').where('id', '=', user.id).executeTakeFirst();
    const label = encodeURIComponent(`HelpIn:${account?.email ?? user.id.slice(0, 8)}`);
    return { enabled: false, secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=HelpIn&digits=6&period=30` };
  });

  app.post('/v1/auth/mfa/verify', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
    await rateLimit(ctx.db, { userId: user.id }, 'mfa', { max: 10, windowHours: 1 });
    const totp = await ctx.db.selectFrom('user_totp').selectAll().where('user_id', '=', user.id).executeTakeFirst();
    if (!totp || !verifyTotp(totp.secret, code, now().getTime())) throw badRequest('CODE_MISMATCH', "That code didn't match.");
    if (!totp.enabled_at) await ctx.db.updateTable('user_totp').set({ enabled_at: now() }).where('user_id', '=', user.id).execute();
    await ctx.db.updateTable('sessions').set({ mfa_verified_at: now() }).where('id', '=', user.sessionId).execute();
    const accessToken = await signAccessToken(ctx, { sub: user.id, sid: user.sessionId, role: user.role, mfa: true });
    return { accessToken, expiresIn: ACCESS_TTL_SECONDS, me: await buildMe(ctx, user.id, true) };
  });

  // ---- Me
  app.get('/v1/me', async (req) => {
    const user = await requireUser(ctx, req, { verified: false, onboarded: false });
    return buildMe(ctx, user.id, user.mfa);
  });

  app.post('/v1/me/phone/otp', async (req) => {
    const user = await requireUser(ctx, req, { verified: false, onboarded: false });
    const { phone } = parse(z.object({ phone: z.string().min(5).max(30) }), req.body);
    const e164 = normalizePhone(phone);
    if (!e164) throw badRequest('VALIDATION', 'Enter a valid phone number.');
    const taken = await ctx.db.selectFrom('users').select('id').where('phone_e164', '=', e164).where('id', '!=', user.id).where('status', '!=', 'deleted').executeTakeFirst();
    if (taken) throw conflict('PHONE_TAKEN', 'That number already belongs to another HelpIn account. Log in with it instead.');
    return createChallenge(ctx, req, { channel: 'sms', destination: e164, purpose: 'verify_phone', userId: user.id });
  });

  app.post('/v1/me/phone/verify', async (req) => {
    const user = await requireUser(ctx, req, { verified: false, onboarded: false });
    const body = parse(OtpVerifySchema, req.body);
    const ch = await consumeChallenge(ctx, body.challengeId, body.code, 'verify_phone');
    if (ch.user_id !== user.id) throw badRequest('NO_PENDING_CODE', 'Request a new code.');
    try {
      await ctx.db.updateTable('users').set({ phone_e164: ch.destination, phone_verified_at: now() }).where('id', '=', user.id).execute();
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('PHONE_TAKEN', 'That number already belongs to another HelpIn account.');
      throw e;
    }
    await refreshOnboarded(ctx, user.id);
    return buildMe(ctx, user.id, user.mfa);
  });

  app.post('/v1/me/onboarding', async (req) => {
    const user = await requireUser(ctx, req, { verified: false, onboarded: false });
    parse(OnboardingInputSchema, req.body);
    const t = now();
    await ctx.db.updateTable('users').set({ adult_confirmed_at: t, guidelines_accepted_at: t }).where('id', '=', user.id).execute();
    await refreshOnboarded(ctx, user.id);
    return buildMe(ctx, user.id, user.mfa);
  });

  app.patch('/v1/me/profile', async (req) => {
    const user = await requireUser(ctx, req, { verified: false, onboarded: false });
    const body = parse(ProfileInputSchema, req.body);
    const languages = [...new Set(body.languages)].filter((l) => LANGUAGES.some((x) => x.code === l));
    if (body.avatarMediaId) {
      const m = await ctx.db.selectFrom('media').select(['owner_id', 'purpose']).where('id', '=', body.avatarMediaId).executeTakeFirst();
      if (!m || m.owner_id !== user.id || m.purpose !== 'avatar') throw badRequest('INVALID_MEDIA', 'That photo can’t be used here.');
    }
    const values = {
      display_name: body.displayName,
      bio: body.bio || null,
      languages,
      is_newcomer: body.isNewcomer,
      updated_at: now(),
      ...(body.avatarMediaId !== undefined ? { avatar_media_id: body.avatarMediaId } : {}),
    };
    await ctx.db
      .insertInto('profiles')
      .values({ user_id: user.id, ...values })
      .onConflict((oc) => oc.column('user_id').doUpdateSet(values))
      .execute();
    await refreshOnboarded(ctx, user.id);
    return buildMe(ctx, user.id, user.mfa);
  });

  app.put('/v1/me/home-area', async (req) => {
    const user = await requireUser(ctx, req, { verified: false, onboarded: false });
    const { cell } = parse(z.object({ cell: z.string() }), req.body);
    // L-05: only a res-7 cell is ever stored, never a point.
    if (!isValidCell(cell) || getResolution(cell) !== 7) throw badRequest('VALIDATION', 'Choose your area on the map.');
    const inside = await ctx.db.selectFrom('launch_area_cells').select('district').where('cell_r7', '=', cell).executeTakeFirst();
    if (!inside) throw badRequest('OUTSIDE_LAUNCH_AREA', `HelpIn is only in ${LAUNCH_AREA.name} for now.`);
    const profile = await ctx.db.selectFrom('profiles').select('user_id').where('user_id', '=', user.id).executeTakeFirst();
    if (!profile) throw badRequest('PROFILE_REQUIRED', 'Add your name first.');
    await ctx.db.updateTable('profiles').set({ home_cell_r7: cell, updated_at: now() }).where('user_id', '=', user.id).execute();
    await refreshOnboarded(ctx, user.id);
    return buildMe(ctx, user.id, user.mfa);
  });

  app.put('/v1/me/alert-prefs', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const p = parse(AlertPrefsSchema, req.body);
    const values = {
      enabled: p.enabled,
      ring: p.ring,
      categories: p.categories,
      min_urgency: p.minUrgency,
      daily_cap: p.dailyCap,
      quiet_start: p.quietStart,
      quiet_end: p.quietEnd,
      serious_in_quiet: p.seriousInQuiet,
      email_digest: p.emailDigest,
    };
    await ctx.db.insertInto('alert_prefs').values({ user_id: user.id, ...values }).onConflict((oc) => oc.column('user_id').doUpdateSet(values)).execute();
    return buildMe(ctx, user.id, user.mfa);
  });

  app.post('/v1/me/push-subscriptions', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const sub = parse(PushSubscriptionInputSchema, req.body);
    await ctx.db
      .insertInto('push_subscriptions')
      .values({ user_id: user.id, kind: 'webpush', endpoint: sub.endpoint, keys: JSON.stringify(sub.keys), user_agent: req.headers['user-agent']?.slice(0, 300) ?? null, created_at: now(), last_seen_at: now() })
      .onConflict((oc) => oc.column('endpoint').doUpdateSet({ user_id: user.id, keys: JSON.stringify(sub.keys), last_seen_at: now() }))
      .execute();
    return { ok: true };
  });

  app.delete('/v1/me/push-subscriptions', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const { endpoint } = parse(z.object({ endpoint: z.string() }), req.body);
    await ctx.db.deleteFrom('push_subscriptions').where('user_id', '=', user.id).where('endpoint', '=', endpoint).execute();
    return { ok: true };
  });

  app.post('/v1/me/push-subscriptions/test', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const subs = await ctx.db.selectFrom('push_subscriptions').select(['id', 'endpoint', 'keys']).where('user_id', '=', user.id).execute();
    let delivered = 0;
    for (const s of subs) {
      const ok = await ctx.push.send({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, { title: 'HelpIn', body: 'Notifications are working. 🎉', url: '/notifications' });
      if (ok) delivered++;
      else await ctx.db.deleteFrom('push_subscriptions').where('id', '=', s.id).execute();
    }
    return { delivered, enabled: ctx.push.enabled };
  });

  app.get('/v1/me/karma', async (req) => {
    const user = await requireUser(ctx, req);
    return karmaHistory(ctx, user.id);
  });

  app.get('/v1/me/export', async (req, reply) => {
    const user = await requireUser(ctx, req, { verified: false, onboarded: false });
    reply.header('Content-Disposition', 'attachment; filename="helpin-export.json"');
    return exportData(ctx, user.id);
  });

  app.delete('/v1/me', async (req) => {
    const user = await requireUser(ctx, req, { verified: false, onboarded: false });
    const { confirm } = parse(z.object({ confirm: z.literal('DELETE') }), req.body);
    void confirm;
    await deleteAccount(ctx, user.id);
    return { ok: true };
  });

  // ---- Public profiles (A-04: anonymous problems never appear here)
  app.get('/v1/users/:id', async (req) => {
    const viewer = await requireUser(ctx, req);
    const { id } = req.params as { id: string };
    const user = await publicUser(ctx, id);
    if (!user) throw notFound('That person');
    const [profile, posts, block, status] = await Promise.all([
      ctx.db.selectFrom('profiles').select(['bio']).where('user_id', '=', id).executeTakeFirst(),
      ctx.db.selectFrom('posts').select(sql<number>`count(*)::int`.as('n')).where('author_id', '=', id).where('status', '=', 'visible').executeTakeFirst(),
      ctx.db.selectFrom('blocks').select('blocked_id').where('blocker_id', '=', viewer.id).where('blocked_id', '=', id).executeTakeFirst(),
      ctx.db.selectFrom('users').select(['created_at', 'status']).where('id', '=', id).executeTakeFirstOrThrow(),
    ]);
    if (status.status === 'deleted') throw notFound('That person');
    return { user, bio: profile?.bio ?? '', memberSince: status.created_at.toISOString(), postsCount: posts?.n ?? 0, blockedByMe: !!block };
  });

  app.get('/v1/users/:id/solver-history', async (req) => {
    await requireUser(ctx, req);
    const { id } = req.params as { id: string };
    const rows = await ctx.db
      .selectFrom('help_offers as o')
      .innerJoin('problems as p', 'p.id', 'o.problem_id')
      .leftJoin('profiles as ap', 'ap.user_id', 'p.owner_id')
      .select(['p.id', 'p.title', 'p.category', 'p.solved_at', 'p.is_anonymous', 'ap.display_name'])
      .where('o.helper_id', '=', id)
      .where('o.status', '=', 'credited')
      .where('p.status', '=', 'solved')
      .orderBy('p.solved_at', 'desc')
      .limit(50)
      .execute();
    return rows.map((r) => ({
      problemId: r.id,
      title: r.title,
      categoryId: r.category,
      solvedAt: (r.solved_at ?? now()).toISOString(),
      askerName: r.is_anonymous ? null : (r.display_name ?? null),
    }));
  });

  // ---- Meta (Architecture §11)
  app.get('/v1/meta/config', async () => {
    const area = await ctx.db.selectFrom('launch_areas').select(['id', 'name', 'flags', 'enabled']).where('id', '=', LAUNCH_AREA.id).executeTakeFirst();
    return {
      categoryGroups: CATEGORY_GROUPS,
      urgency: URGENCY,
      limits: LIMITS,
      languages: LANGUAGES,
      launchArea: { ...LAUNCH_AREA, enabled: area?.enabled ?? false, flags: area?.flags ?? {} },
      vapidPublicKey: ctx.push.publicKey,
    };
  });
}

export { refreshOnboarded };

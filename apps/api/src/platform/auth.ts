import { SignJWT, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { Ctx } from './context';
import { now } from './clock';
import { forbidden, unauthorized } from './errors';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;

export interface Claims {
  sub: string;
  sid: string;
  role: 'user' | 'moderator' | 'admin';
  mfa: boolean;
}

const key = (ctx: Ctx) => new TextEncoder().encode(ctx.env.JWT_SECRET);

export async function signAccessToken(ctx: Ctx, claims: Claims): Promise<string> {
  return new SignJWT({ sid: claims.sid, role: claims.role, mfa: claims.mfa })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt(Math.floor(now().getTime() / 1000))
    .setExpirationTime(Math.floor(now().getTime() / 1000) + ACCESS_TTL_SECONDS)
    .setIssuer('helpin')
    .sign(key(ctx));
}

export async function verifyAccessToken(ctx: Ctx, token: string): Promise<Claims> {
  try {
    const { payload } = await jwtVerify(token, key(ctx), { issuer: 'helpin', currentDate: now() });
    return { sub: String(payload.sub), sid: String(payload.sid), role: payload.role as Claims['role'], mfa: !!payload.mfa };
  } catch {
    throw unauthorized('Your session has expired. Please log in again.');
  }
}

export interface AuthedUser {
  id: string;
  role: Claims['role'];
  sessionId: string;
  mfa: boolean;
  status: string;
  phoneVerified: boolean;
  onboarded: boolean;
}

const cache = new WeakMap<FastifyRequest, AuthedUser | null>();

export async function optionalUser(ctx: Ctx, req: FastifyRequest): Promise<AuthedUser | null> {
  if (cache.has(req)) return cache.get(req)!;
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    cache.set(req, null);
    return null;
  }
  const claims = await verifyAccessToken(ctx, header.slice(7));
  const row = await ctx.db
    .selectFrom('users')
    .innerJoin('sessions', 'sessions.user_id', 'users.id')
    .select(['users.id', 'users.role', 'users.status', 'users.phone_verified_at', 'users.onboarded_at', 'users.last_seen_at', 'sessions.revoked_at'])
    .where('users.id', '=', claims.sub)
    .where('sessions.id', '=', claims.sid)
    .executeTakeFirst();
  if (!row || row.revoked_at || row.status === 'deleted') throw unauthorized();
  const user: AuthedUser = {
    id: row.id,
    role: row.role as Claims['role'],
    sessionId: claims.sid,
    mfa: claims.mfa,
    status: row.status,
    phoneVerified: !!row.phone_verified_at,
    onboarded: !!row.onboarded_at,
  };
  // R-60 "Asker last active": refresh at most every 5 minutes.
  const t = now();
  if (!row.last_seen_at || t.getTime() - row.last_seen_at.getTime() > 5 * 60_000) {
    await ctx.db.updateTable('users').set({ last_seen_at: t }).where('id', '=', row.id).execute();
  }
  cache.set(req, user);
  return user;
}

/**
 * Every endpoint except sign-in and onboarding needs a verified phone and finished onboarding
 * (ADR-018). Restricted accounts can read but not create (S-09).
 */
export async function requireUser(
  ctx: Ctx,
  req: FastifyRequest,
  opts: { verified?: boolean; onboarded?: boolean; write?: boolean } = {},
): Promise<AuthedUser> {
  const user = await optionalUser(ctx, req);
  if (!user) throw unauthorized();
  if ((opts.verified ?? true) && !user.phoneVerified) throw forbidden('PHONE_NOT_VERIFIED', 'Please verify your phone number first.');
  if ((opts.onboarded ?? true) && !user.onboarded) throw forbidden('ONBOARDING_REQUIRED', 'Please finish setting up your account.');
  if (opts.write && user.status === 'restricted') throw forbidden('ACCOUNT_RESTRICTED', 'Your account is restricted. Check your notifications for details.');
  return user;
}

/** S-10: admin and moderator actions need the role and a second factor in this session. */
export async function requireStaff(ctx: Ctx, req: FastifyRequest, role: 'moderator' | 'admin' = 'moderator'): Promise<AuthedUser> {
  const user = await requireUser(ctx, req, { onboarded: false });
  const ok = role === 'admin' ? user.role === 'admin' : user.role === 'admin' || user.role === 'moderator';
  if (!ok) throw forbidden('FORBIDDEN', 'Admins only.');
  if (!user.mfa) throw forbidden('MFA_REQUIRED', 'Confirm your two-factor code to continue.');
  return user;
}

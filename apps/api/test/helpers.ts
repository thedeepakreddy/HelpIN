import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createDb, sql } from '@helpin/db';
import { latLngToCell } from 'h3-js';
import { buildApp } from '../src/app';
import { signAccessToken } from '../src/platform/auth';
import { clock } from '../src/platform/clock';
import type { Ctx } from '../src/platform/context';
import { loadEnv } from '../src/platform/env';
import { geocoderFromEnv } from '../src/platform/geocoder';
import { consoleMessaging } from '../src/platform/messaging';
import { memoryPush } from '../src/platform/push';
import { localStorage } from '../src/platform/storage';
import { drainAll } from '../src/jobs/dispatcher';
import { TEST_DATABASE_URL } from './global-setup';

export const T0 = new Date('2026-10-01T09:00:00Z');
export const H = 3_600_000;
export const D = 24 * H;

/** Points in Budapest used across tests (District XI unless noted). */
export const SPOT = {
  bartok: { lat: 47.47721, lng: 19.04802 },
  pond: { lat: 47.4791, lng: 19.0398 },
  rady: { lat: 47.4846, lng: 19.0663 }, // IX
  vienna: { lat: 48.2082, lng: 16.3738 },
};

export interface TestUser {
  id: string;
  sid: string;
  role: 'user' | 'moderator' | 'admin';
  mfa: boolean;
  name: string;
}

export interface Harness {
  app: FastifyInstance;
  ctx: Ctx;
  push: ReturnType<typeof memoryPush>;
  close(): Promise<void>;
  reset(): Promise<void>;
  /** A fully onboarded user (phone verified, profile, home area). */
  user(name: string, opts?: { phone?: string; languages?: string[]; home?: { lat: number; lng: number }; role?: 'admin' | 'moderator' }): Promise<TestUser>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are checked field by field
  req(user: TestUser | null, method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }>;
  drain(): Promise<void>;
}

let phoneSeq = 1000000;

export async function harness(): Promise<Harness> {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: 'test-secret-test-secret-test-secret',
    AUTH_DEV_CODE: '123456',
    STORAGE_DIR: mkdtempSync(join(tmpdir(), 'helpin-test-')),
    PUBLIC_API_URL: 'http://api.test',
    ADMIN_EMAILS: 'founder@helpin.test',
  });
  const { db, pool } = createDb(env.DATABASE_URL, { max: 20 });
  const messaging = consoleMessaging(() => undefined);
  const push = memoryPush();
  const ctx: Ctx = {
    env,
    db,
    storage: localStorage(env),
    sms: messaging.sms,
    email: messaging.email,
    sent: messaging.sent,
    push,
    geocoder: geocoderFromEnv(env, db),
    hub: null,
    log: { info: () => undefined, warn: () => undefined, error: (m, e) => console.error(m, e) },
  };
  const app = await buildApp(ctx);

  const req: Harness['req'] = async (user, method, url, body, headers = {}) => {
    const auth = user ? { authorization: `Bearer ${await signAccessToken(ctx, { sub: user.id, sid: user.sid, role: user.role, mfa: user.mfa })}` } : {};
    const res = await app.inject({ method: method as 'GET', url, payload: body as object, headers: { ...auth, ...headers } });
    let parsed: unknown;
    try {
      parsed = res.json();
    } catch {
      parsed = res.body;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see Harness.req
    return { status: res.statusCode, body: parsed as any };
  };

  return {
    app,
    ctx,
    push,
    async close() {
      clock.reset();
      await app.close();
      await db.destroy().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
    async reset() {
      clock.freeze(T0);
      const tables = await sql<{ tablename: string }>`SELECT tablename FROM pg_tables WHERE schemaname = 'app' AND tablename NOT IN ('launch_areas', 'launch_area_cells')`.execute(db);
      await sql.raw(`TRUNCATE ${tables.rows.map((t) => `app.${t.tablename}`).join(', ')} RESTART IDENTITY CASCADE`).execute(db);
      push.sent.length = 0;
      messaging.sent.sms.length = 0;
      messaging.sent.email.length = 0;
    },
    async user(name, opts = {}) {
      const phone = opts.phone ?? `+3630${phoneSeq++}`;
      const otp = await req(null, 'POST', '/v1/auth/otp', { channel: 'sms', destination: phone });
      if (otp.status !== 200) throw new Error(`otp failed: ${JSON.stringify(otp.body)}`);
      const session = await req(null, 'POST', '/v1/auth/verify', { challengeId: otp.body.challengeId, code: otp.body.devCode });
      if (session.status !== 200) throw new Error(`verify failed: ${JSON.stringify(session.body)}`);
      const id = session.body.me.id as string;
      const sid = (await db.selectFrom('sessions').select('id').where('user_id', '=', id).orderBy('created_at', 'desc').executeTakeFirstOrThrow()).id;
      if (opts.role) await db.updateTable('users').set({ role: opts.role }).where('id', '=', id).execute();
      const u: TestUser = { id, sid, role: opts.role ?? 'user', mfa: !!opts.role, name };
      const steps = [
        await req(u, 'PATCH', '/v1/me/profile', { displayName: name, bio: '', languages: opts.languages ?? ['hu', 'en'], isNewcomer: false }),
        await req(u, 'POST', '/v1/me/onboarding', { adult: true, guidelines: true }),
        await req(u, 'PUT', '/v1/me/home-area', { cell: latLngToCell((opts.home ?? SPOT.bartok).lat, (opts.home ?? SPOT.bartok).lng, 7) }),
      ];
      for (const s of steps) if (s.status !== 200) throw new Error(`onboarding failed: ${JSON.stringify(s.body)}`);
      return u;
    },
    req,
    drain: () => drainAll(ctx),
  };
}

export const problemInput = (over: Record<string, unknown> = {}) => ({
  categoryId: 'borrow_lend',
  kind: 'request',
  title: 'Borrow a ladder for an hour',
  description: 'Need to change a lightbulb on a high ceiling.',
  urgency: 'basic',
  precision: 'standard',
  point: SPOT.bartok,
  saveExactPrivately: true,
  languageNeeded: null,
  anonymous: false,
  mediaIds: [],
  communityId: null,
  ...over,
});

/** Walks a JSON value and returns every key path. */
export function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => keyPaths(v, `${prefix}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [`${prefix}.${k}`, ...keyPaths(v, `${prefix}.${k}`)]);
  }
  return [];
}

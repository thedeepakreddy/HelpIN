import { createDb } from '@helpin/db';
import type { Ctx } from './platform/context';
import { loadEnv, type Env } from './platform/env';
import { geocoderFromEnv } from './platform/geocoder';
import { messagingFromEnv } from './platform/messaging';
import { pushFromEnv } from './platform/push';
import { storageFromEnv } from './platform/storage';

export function createCtx(env: Env = loadEnv()): Ctx & { close: () => Promise<void> } {
  const { db, pool } = createDb(env.DATABASE_URL);
  const log = {
    info: (m: string) => console.log(m),
    warn: (m: string) => console.warn(m),
    error: (m: string, e?: unknown) => console.error(m, e ?? ''),
  };
  const messaging = messagingFromEnv(env, (m) => log.info(m));
  return {
    env,
    db,
    storage: storageFromEnv(env),
    sms: messaging.sms,
    email: messaging.email,
    sent: messaging.sent,
    push: pushFromEnv(env),
    geocoder: geocoderFromEnv(env, db),
    hub: null,
    log,
    close: async () => {
      await db.destroy().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
  };
}

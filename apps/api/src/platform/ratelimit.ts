import { sql, type Db, type Tx } from '@helpin/db';
import { now } from './clock';
import { tooMany } from './errors';

/** Fixed-window counters in Postgres (no Redis in the MVP, ADR-006). */
export async function rateLimit(
  db: Db | Tx,
  scope: { userId: string } | { key: string },
  action: string,
  limit: { max: number; windowHours: number },
  message?: string,
) {
  const windowMs = limit.windowHours * 3_600_000;
  const start = new Date(Math.floor(now().getTime() / windowMs) * windowMs);
  const row =
    'userId' in scope
      ? await sql<{ count: number }>`
          INSERT INTO app.rate_limit_counters (user_id, action, window_start, count) VALUES (${scope.userId}, ${action}, ${start}, 1)
          ON CONFLICT (user_id, action, window_start) DO UPDATE SET count = rate_limit_counters.count + 1
          RETURNING count`.execute(db)
      : await sql<{ count: number }>`
          INSERT INTO app.rate_limit_keys (key, action, window_start, count) VALUES (${scope.key}, ${action}, ${start}, 1)
          ON CONFLICT (key, action, window_start) DO UPDATE SET count = rate_limit_keys.count + 1
          RETURNING count`.execute(db);
  if ((row.rows[0]?.count ?? 0) > limit.max) throw tooMany(message);
}

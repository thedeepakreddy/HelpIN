import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './schema';

export type { DB } from './schema';
export * as Tables from './schema';
export { migrate } from './migrate';
export { sql };

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

// Postgres bigint ids (karma entries, messages, outbox) fit safely in JS numbers for our scale.
pg.types.setTypeParser(20, (v) => Number(v));

export function createDb(connectionString: string, opts: { max?: number } = {}): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 });
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  }).withSchema('app');
  return { db, pool };
}

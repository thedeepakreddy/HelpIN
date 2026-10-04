import pg from 'pg';
import { migrate } from '@helpin/db';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://helpin:helpin@localhost:5432/helpin_test';

/** Fresh schema for every test run: drop everything, then apply all migrations. */
export default async function setup() {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS app CASCADE; DROP TABLE IF EXISTS public.schema_migrations;');
  await c.end();
  await migrate(TEST_DATABASE_URL, () => undefined);
}

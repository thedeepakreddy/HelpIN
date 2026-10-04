/**
 * Development only: drops everything HelpIn created and re-applies all migrations.
 * Refuses to run when NODE_ENV=production.
 */
import pg from 'pg';
import { migrate } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to reset a production database.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('DROP SCHEMA IF EXISTS app CASCADE');
  await client.query('DROP TABLE IF EXISTS public.schema_migrations');
} finally {
  await client.end();
}
const applied = await migrate(url, () => undefined);
console.log(`database reset (${applied.length} migrations applied)`);

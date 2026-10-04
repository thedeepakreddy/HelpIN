/**
 * Applies migrations/*.sql in order, each in its own transaction, and records them in
 * public.schema_migrations. Re-runnable: applied files are skipped (Roadmap Phase 0).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(databaseUrl: string, log: (m: string) => void = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    // One migrator at a time (e.g. two API replicas starting together).
    await client.query('SELECT pg_advisory_lock(727274)');
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM public.schema_migrations')).rows.map((r) => r.name));
    const applied: string[] = [];
    for (const name of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      const sql = readFileSync(DIR + name, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${(e as Error).message}`, { cause: e });
      }
      // The SQL files change search_path for their own convenience; reset it.
      await client.query('RESET search_path');
      applied.push(name);
      log(`applied ${name}`);
    }
    await client.query('SELECT pg_advisory_unlock(727274)');
    return applied;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  migrate(url)
    .then((applied) => console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date'))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}

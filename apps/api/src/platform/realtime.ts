import { sql, type Db, type Tx } from '@helpin/db';
import pg from 'pg';

/**
 * Realtime is a hint, not a source of truth (ADR-007). Commands call `publish` inside their
 * transaction; Postgres delivers NOTIFY only on commit, to every API process, which forwards it
 * to the user's open event streams (SSE). Clients refetch on any event or reconnect.
 */
export interface RealtimeEvent {
  type: 'notification' | 'message' | 'problem' | 'conversation' | 'me' | 'feed';
  id?: string;
}

const CHANNEL = 'helpin_events';

export async function publish(tx: Tx | Db, userIds: string[], event: RealtimeEvent) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  await sql`SELECT pg_notify(${CHANNEL}, ${JSON.stringify({ u: ids, e: event })})`.execute(tx);
}

type Listener = (event: RealtimeEvent) => void;

export class RealtimeHub {
  private listeners = new Map<string, Set<Listener>>();
  private client: pg.Client | null = null;

  async start(databaseUrl: string) {
    this.client = new pg.Client({ connectionString: databaseUrl });
    await this.client.connect();
    this.client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const { u, e } = JSON.parse(msg.payload) as { u: string[]; e: RealtimeEvent };
        for (const id of u) this.listeners.get(id)?.forEach((l) => l(e));
      } catch {
        /* malformed payload: ignore */
      }
    });
    await this.client.query(`LISTEN ${CHANNEL}`);
  }

  subscribe(userId: string, listener: Listener): () => void {
    const set = this.listeners.get(userId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(userId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(userId);
    };
  }

  async stop() {
    await this.client?.end();
    this.client = null;
  }
}

import type { Db } from '@helpin/db';
import type { Env } from './env';
import type { Geocoder } from './geocoder';
import type { EmailSender, Outbox, SmsSender } from './messaging';
import type { PushSender } from './push';
import type { RealtimeHub } from './realtime';
import type { Storage } from './storage';

/** Everything a module needs, injected once at startup (and replaced with fakes in tests). */
export interface Ctx {
  env: Env;
  db: Db;
  storage: Storage;
  sms: SmsSender;
  email: EmailSender;
  push: PushSender;
  geocoder: Geocoder;
  hub: RealtimeHub | null;
  /** Console/test messaging keeps sent messages here. */
  sent: Outbox;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}

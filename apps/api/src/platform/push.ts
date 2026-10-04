import webpush from 'web-push';
import type { Env } from './env';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  actions?: { action: string; title: string }[];
}

export interface PushSender {
  readonly enabled: boolean;
  readonly publicKey: string | null;
  /** Returns false when the subscription is gone (410/404) so the caller can delete it. */
  send(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: PushPayload): Promise<boolean>;
}

/** Web Push with VAPID (Architecture §8.1). Disabled when no keys are configured. */
export function pushFromEnv(env: Env): PushSender {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return { enabled: false, publicKey: null, send: async () => true };
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  return {
    enabled: true,
    publicKey: env.VAPID_PUBLIC_KEY,
    async send(sub, payload) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
        return true;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return false;
        throw e;
      }
    },
  };
}

/** Test double: records what would have been pushed. */
export function memoryPush(): PushSender & { sent: { endpoint: string; payload: PushPayload }[] } {
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  return {
    enabled: true,
    publicKey: 'test-public-key',
    sent,
    async send(sub, payload) {
      sent.push({ endpoint: sub.endpoint, payload });
      return true;
    },
  };
}

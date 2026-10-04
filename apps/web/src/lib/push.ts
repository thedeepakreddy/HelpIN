import { api } from '../api';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iPhone gets Web Push only when HelpIn is added to the Home Screen (Architecture §8.1). */
export const isIosBrowser = () =>
  typeof navigator !== 'undefined' &&
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone);

export type PushResult = 'enabled' | 'denied' | 'unsupported' | 'unavailable' | 'needs-install';

export async function enablePush(): Promise<PushResult> {
  if (isIosBrowser()) return 'needs-install';
  if (!pushSupported()) return 'unsupported';
  const { vapidPublicKey } = await api.getConfig();
  if (!vapidPublicKey) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.addPushSubscription({ endpoint: json.endpoint, keys: json.keys });
  return 'enabled';
}

export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.removePushSubscription(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
}

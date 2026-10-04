/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

/**
 * HelpIn service worker (Architecture §8.1): offline app shell plus Web Push.
 * The SW never holds the session token, so notification actions only open the right screen;
 * the page performs the action itself with the signed-in user's token.
 */

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/v1\//] }));

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  actions?: { action: string; title: string }[];
}

self.addEventListener('push', (event) => {
  let data: PushPayload;
  try {
    data = event.data?.json() as PushPayload;
  } catch {
    data = { title: 'HelpIn', body: event.data?.text() ?? '', url: '/notifications' };
  }
  if (!data?.title) return;
  const options: NotificationOptions & { actions?: { action: string; title: string }[]; renotify?: boolean } = {
    body: data.body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url || '/notifications' },
    lang: 'en',
  };
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  if (data.actions?.length) options.actions = data.actions.slice(0, 2);
  event.waitUntil(self.registration.showNotification(data.title, options));
});

/** Maps a notification button to a URL; the problem screen opens the matching sheet. */
function targetUrl(base: string, action: string): string {
  if (!action) return base;
  const url = new URL(base, self.location.origin);
  url.searchParams.set('action', action);
  return url.pathname + url.search;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const base = (event.notification.data as { url?: string } | null)?.url ?? '/notifications';
  const target = targetUrl(base, event.action);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        await open.navigate(target).catch(() => open.postMessage({ type: 'NAVIGATE', url: target }));
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/**
 * sw.ts: the service worker, for Workbox's injectManifest strategy (vite-plugin-pwa `strategies: 'injectManifest'`,
 * or workbox-build / workbox-cli injectManifest). The build replaces `self.__WB_MANIFEST` with the hashed file list.
 *
 * What it does:
 *   - Precaches the app shell so every launch comes from disk, online or offline, like a native binary.
 *   - Navigations: an SPA gets the precached shell for every URL; a multi-page app goes network-first and falls back
 *     to a precached offline page instead of the browser's error page. Pick one in NAVIGATION.
 *   - Runtime-caches images and fonts (cache-first, with expiry, status 200 only).
 *   - Updates on prompt: a new version waits until the page posts SKIP_WAITING (the user clicked "Reload" in
 *     sw-client.ts), so code is never swapped under someone mid-typing. The first install takes control at once.
 *   - Push: always shows a notification (Safari revokes subscriptions for silent pushes, Chrome shows a generic one),
 *     sets the app badge, and leaves Safari's Declarative Web Push notifications to Safari.
 *   - notificationclick: focuses the open window and asks it to route in place (no reload, drafts intact), or opens
 *     the URL when no window exists.
 *
 * Rules: no state in worker globals (the browser stops idle workers after ~30 s and iOS sooner; keep counts in
 * IndexedDB), every async job inside event.waitUntil(), never rename or move this file (users with the old URL would be
 * stranded), serve it with Cache-Control: no-cache, and keep the manifest's scope and start_url inside its scope.
 * Decisions live in sw-logic.ts (unit-tested); check this wiring end to end against the production build.
 *
 * TypeScript: compile with lib ["ES2022", "WebWorker"] in its own tsconfig (the DOM and WebWorker libs conflict in
 * one program).
 *
 * Browsers: service workers Chrome 40+, Firefox 44+, Safari 11.1+/iOS 11.3+. Push: Chrome/Edge, Firefox, Safari 16+
 * macOS, iOS/iPadOS 16.4+ only inside a Home Screen app. Badging in the worker: Chromium desktop, Safari 17 macOS web
 * apps, iOS 16.4+ Home Screen apps. Declarative Web Push: Safari 18.4+ iOS, 18.5+ macOS.
 *
 * Adapt: NAVIGATION, APP_SHELL / OFFLINE_PAGE, NAVIGATION_DENYLIST, the runtime cache names in KEEP_CACHES.
 */
import { clientsClaim } from 'workbox-core';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  matchPrecache,
  type PrecacheEntry,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { DEFAULT_TITLE, isSkipWaiting, isStaleCache, navigateMessage, noticeData, noticeUrl, parsePush, pickWindow } from './sw-logic';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

type NavigationMode = 'app-shell' | 'network-first';
/** 'app-shell' for single-page apps with path routes (hash routers are served by the precache alone). */
const NAVIGATION: NavigationMode = 'app-shell';
const APP_SHELL = 'index.html';
/** Self-contained (inline CSS/SVG, no external fonts) and included in the precache globPatterns. */
const OFFLINE_PAGE = 'offline.html';
/** Paths that must never get the app shell or the offline page: APIs, files, auth callbacks. */
const NAVIGATION_DENYLIST = [/^\/api\//, /\/[^/?]+\.[^/]+$/];

const MEDIA_CACHE = 'media-v1';
const PAGES_CACHE = 'pages-v1';
/** Runtime caches this version keeps. Version the names; Workbox never deletes runtime caches for you. */
const KEEP_CACHES: ReadonlySet<string> = new Set([MEDIA_CACHE, PAGES_CACHE]);

// Precache: delete precaches from older Workbox formats, then serve the build's files from disk.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// The first install controls the open page without a reload (so "install, then go offline" works). Later versions
// still wait for the user's Reload (SKIP_WAITING below).
clientsClaim();

function navigationRoute(mode: NavigationMode): NavigationRoute {
  if (mode === 'app-shell') {
    // Every in-scope navigation gets the precached shell; the client-side router reads the URL.
    return new NavigationRoute(createHandlerBoundToURL(APP_SHELL), { denylist: NAVIGATION_DENYLIST });
  }
  const offlineFallback = { handlerDidError: async () => (await matchPrecache(OFFLINE_PAGE)) ?? Response.error() };
  return new NavigationRoute(
    new NetworkFirst({ cacheName: PAGES_CACHE, networkTimeoutSeconds: 3, plugins: [offlineFallback] }),
    { denylist: NAVIGATION_DENYLIST },
  );
}
registerRoute(navigationRoute(NAVIGATION));

// Images and fonts appear instantly on revisits and offline. Status 200 only: an opaque (no-cors) response hides its
// status and costs ~7 MB of quota each in Chrome. Content-addressed URLs are ideal here.
registerRoute(
  ({ request }) => request.destination === 'image' || request.destination === 'font',
  new CacheFirst({
    cacheName: MEDIA_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
);

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => isStaleCache(n, KEEP_CACHES)).map((n) => caches.delete(n)))),
  );
});

// The page posts this when the user accepts "A new version is ready - Reload".
self.addEventListener('message', (event) => {
  if (isSkipWaiting(event.data)) void self.skipWaiting();
});

self.addEventListener('push', (event) => {
  // Safari Declarative Web Push with "mutable": the push carries a notification Safari will show itself unless we
  // replace it (e.g. after decrypting). Leave it to Safari here.
  if (Reflect.get(event, 'notification') instanceof Notification) return;

  const scope = self.registration.scope;
  const n = parsePush(event.data?.text(), scope);
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(n?.title ?? DEFAULT_TITLE, {
        ...(n?.body === undefined ? {} : { body: n.body }),
        ...(n?.tag === undefined ? {} : { tag: n.tag }),
        data: n ? noticeData(n) : {},
        icon: new URL('pwa-192x192.png', scope).href, // Chromium/Firefox; Safari uses the app icon
      });
      if (n?.badge !== undefined && 'setAppBadge' in self.navigator) {
        await (n.badge > 0 ? self.navigator.setAppBadge(n.badge) : self.navigator.clearAppBadge()).catch(() => {});
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = noticeUrl(event.notification.data, self.registration.scope);
  // focus() and openWindow() are only allowed during the click's activation window: no slow awaits before them.
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = pickWindow(windows);
      if (!win) {
        await self.clients.openWindow(url); // in-scope URLs open inside the installed app's window
        return;
      }
      win.postMessage(navigateMessage(url, event.action)); // the page routes without reloading (sw-client.ts)
      await win.focus();
    })(),
  );
});

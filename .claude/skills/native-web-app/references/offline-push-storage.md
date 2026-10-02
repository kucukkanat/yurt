<!-- verified 2026-10-02: 3 corrections -->
# Service worker, offline, push, storage and lifecycle

How an installed web app starts from disk, updates without yanking the UI, notifies while closed, keeps its data, and survives suspension and relaunch. Support as of Oct 2026 (MDN BCD 8.1: Chrome 154, Safari 27, Firefox 157).
Worker snippets (`// sw.ts`) assume their own tsconfig with lib `["ES2022", "WebWorker"]` and `declare const self: ServiceWorkerGlobalScope`. Names like `saveDrafts()`, `toast()`, `router` are your code. Working code: [sw.ts](../templates/sw.ts), [sw-client.ts](../templates/sw-client.ts), [sw-logic.ts](../templates/sw-logic.ts), [lifecycle.ts](../templates/lifecycle.ts).

## Checklist

- [ ] **must** — Precache the hashed build and `index.html` so every launch comes from disk → [Precache](#precache-the-app-shell-with-workbox-injectmanifest-vs-generatesw)
- [ ] **must** — Give each resource type its own runtime strategy, cache name and expiry → [Runtime caching](#pick-a-runtime-caching-strategy-for-each-resource-type-with-expiry)
- [ ] **must** — Ship updates through a waiting worker, a non-modal Reload prompt and `SKIP_WAITING` → [Update flow](#update-flow-waiting-worker-prompt-skip_waiting-message-reload-once)
- [ ] **must** — Serve `sw.js` with `no-cache` from a URL that never changes, and keep a kill switch ready → [sw.js headers](#swjs-caching-headers-a-stable-url-scope-and-a-kill-switch)
- [ ] **must** — Delete outdated precaches and unknown runtime caches on activate → [Cache cleanup](#cleanupoutdatedcaches-plus-your-own-runtime-cache-cleanup)
- [ ] **must** — Reload once, after saving, when a lazy chunk from the old build is gone → [Chunk errors](#recover-from-chunk-load-errors-after-a-deploy)
- [ ] **must** — Subscribe to Web Push from a click with `userVisibleOnly` and VAPID → [Push subscription](#web-push-subscription-vapid-user-gesture-uservisibleonly)
- [ ] **must** — Show a notification for every push, inside `waitUntil` → [Every push](#every-push-must-show-a-notification-and-set-the-badge)
- [ ] **must** — Show notifications through the worker registration; use the page constructor only as a fallback → [Show](#show-notifications-through-the-worker-registration-with-a-page-fallback)
- [ ] **must** — On `notificationclick`, focus the open window and route in place → [notificationclick](#notificationclick-focus-the-open-window-and-route-in-place-or-open-one)
- [ ] **must** — Ask for notification permission in context and render every state → [Permission UX](#notification-permission-ux-ask-at-the-right-moment-cover-every-state)
- [ ] **must** — Request persistent storage once data matters; show usage → [persist()](#request-persistent-storage-and-show-usage)
- [ ] **must** — Plan for Safari's 7-day eviction: install, persist, back up → [7-day eviction](#survive-safaris-7-day-eviction-of-script-written-storage)
- [ ] **must** — Detect the first installed launch on iOS and offer restore, not a landing page → [iOS storage](#ios-home-screen-apps-have-their-own-storage-onboard-inside-the-app)
- [ ] **must** — Validate every IndexedDB read, use strict durability for must-keep writes, reopen dropped connections → [IndexedDB](#indexeddb-done-right-validated-reads-durable-writes-reconnects)
- [ ] **must** — Derive offline / reconnecting / online from `onLine` plus the transport's real state → [Online/offline](#onlineoffline-detection-beyond-navigatoronline)
- [ ] **must** — Save on `visibilitychange` to hidden and on `pagehide`, never on unload → [Page Lifecycle](#page-lifecycle-save-on-hidden-not-on-unload)
- [ ] **must** — Restore route, scroll anchor and drafts on a bare relaunch → [Restore](#restore-route-scroll-position-and-drafts-on-relaunch)
- [ ] **must** — On resume, reconnect, resync, check for updates and refresh the badge → [Resume](#resume-from-background-reconnect-resync-refresh)
- [ ] **must** — Keep worker decisions pure and tested; test the wiring against the production build → [Testing](#test-the-worker-pure-decision-module-plus-e2e-against-the-production-build)
- [ ] **should** — Serve a precached offline page when network-first navigations fail → [Offline page](#offline-fallback-page-for-network-first-navigations)
- [ ] **should** — Enable navigation preload, but only for network-first navigations → [Navigation preload](#navigation-preload-network-first-navigations-only)
- [ ] **should** — Call `registration.update()` on return to the app and every hour → [Update checks](#check-for-updates-during-long-lived-sessions)
- [ ] **should** — `clientsClaim()` on first install and say "Ready to work offline" once → [First install](#take-control-on-first-install-and-announce-ready-to-work-offline)
- [ ] **should** — Send Declarative Web Push payloads (Safari) that other browsers handle in the worker → [Declarative push](#declarative-web-push-safari-184-notifications-without-waking-a-worker)
- [ ] **should** — Use `tag` and `data` everywhere, other notification options progressively → [Options](#notification-options-what-each-browser-honours)
- [ ] **should** — Close notifications for content that was read, and keep the badge in sync → [Close when read](#close-notifications-once-the-content-is-read-and-keep-the-badge-in-sync)
- [ ] **should** — Re-check and repair the push subscription on launch and on return → [Keep alive](#keep-push-subscriptions-alive)
- [ ] **should** — Write every outgoing action to an IndexedDB outbox first; flush through Background Sync or on reconnect → [Outbox](#outbox-plus-background-sync-with-a-fallback-that-works-everywhere)
- [ ] **should** — Elect one leader tab with Web Locks; spread state with BroadcastChannel → [Multi-tab](#multi-tab-coordination-web-locks-plus-broadcastchannel)
- [ ] **should** — Keep pages bfcache-eligible; close sockets on `pagehide`, reopen on `pageshow` → [bfcache](#backforward-cache-eligibility)
- [ ] **should** — Keep no state in worker globals; wrap every async job in `waitUntil` → [Worker state](#no-state-in-service-worker-globals-always-waituntil)
- [ ] **nice** — Bypass the worker for API and media requests with static routes → [Static routing](#service-worker-static-routing-api-bypass-the-worker-for-some-requests)
- [ ] **nice** — Apply a waiting update at boot or while hidden, when nobody can notice → [Silent updates](#apply-waiting-updates-silently-when-nobody-can-notice)
- [ ] **nice** — Prefetch content with Periodic Background Sync (Chromium, installed) → [Periodic sync](#periodic-background-sync-chromium-installed-apps-only)
- [ ] **nice** — Hand large transfers to Background Fetch (Chromium) → [Background Fetch](#background-fetch-for-large-downloads-and-uploads-chromium)
- [ ] **nice** — Put large or binary data and SQLite in OPFS → [OPFS](#origin-private-file-system-opfs-for-large-or-binary-data-and-sqlite)
- [ ] **nice** — Split data into Storage Buckets with their own eviction policy (Chromium) → [Buckets](#storage-buckets-separate-eviction-policies-per-kind-of-data-chromium)
- [ ] **nice** — Queue last-chance sends with `fetchLater`, or `sendBeacon` on hide → [fetchLater](#last-chance-network-sends-fetchlater-and-sendbeacon)
- [ ] **nice** — List offline content in Chrome Android with the Content Index → [Content Index](#content-index-api-list-offline-content-in-the-os-chrome-android)

## Precache the app shell with Workbox (injectManifest vs generateSW)

Precache the hashed build and `index.html` at install so every launch comes from disk: no blank screen, no offline dinosaur. `generateSW` writes the worker; `injectManifest` injects `self.__WB_MANIFEST` into your own `sw.ts`, which you need once you have push, `notificationclick` or messages.

```ts
// sw.ts
import { cleanupOutdatedCaches, createHandlerBoundToURL, type PrecacheEntry, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// History-API routers (/c/general): every navigation gets the cached shell. Hash routers don't need this.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }));
```

With Vite: `VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', injectRegister: false, registerType: 'prompt', injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] } })`. `injectRegister: false` lets the page register the worker itself, as the update prompt needs.

**Support:** Service workers: Chrome 40+, Firefox 44+, Safari 11.1+, iOS 11.3+ (tabs and Home Screen apps). Workbox 7, vite-plugin-pwa 1.x.

**Gotchas:**
- Precache only the shell. Workbox skips files over `maximumFileSizeToCacheInBytes` (2 MiB) with a warning; vite-plugin-pwa 0.20.2+ makes it a build error.
- The DOM and WebWorker TS libs conflict, so give `sw.ts` its own tsconfig.
- History routes need the `NavigationRoute` with a denylist so API and file URLs don't get `index.html`.
- vite-plugin-pwa `registerType: 'autoUpdate'` turns on skipWaiting and clientsClaim; avoid it ([Update flow](#update-flow-waiting-worker-prompt-skip_waiting-message-reload-once)).
- Dev servers have no worker; test offline start against the production build.
- The cached shell is the first frame: [motion-performance.md](motion-performance.md#app-shell-instant-start-the-first-frame-comes-from-html-and-the-cache-not-from-js).

**Sources:** https://developer.chrome.com/docs/workbox/modules/workbox-precaching · https://vite-pwa-org.netlify.app/guide/inject-manifest

## Offline fallback page for network-first navigations

Multi-page or SSR apps navigate over the network. When that fails, serve a precached, self-contained "You're offline · Try again" page instead of the browser's error page.

```ts
// sw.ts (multi-page / SSR apps)
import { offlineFallback } from 'workbox-recipes';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

registerRoute(new NavigationRoute(new NetworkFirst({ cacheName: 'pages', networkTimeoutSeconds: 3 })));
offlineFallback({ pageFallback: '/offline.html' }); // precaches it at install; call it after your routes
```

```html
<!-- offline.html: inline CSS and SVG only, app colours, no web fonts -->
<main><h1>You're offline</h1><button id="retry" type="button">Try again</button></main>
<script>
  document.getElementById('retry').addEventListener('click', () => location.reload());
  addEventListener('online', () => location.reload());
</script>
```

**Support:** Everywhere service workers work. `workbox-recipes` ships with Workbox 7.

**Gotchas:**
- `offlineFallback` installs the global `setCatchHandler`, replacing any earlier one.
- An SPA with a precached shell doesn't need it; show offline state in the app ([navigation-ui-patterns.md](navigation-ui-patterns.md#designed-empty-loading-error-and-offline-states-on-every-screen)).
- Inline the page's styles; an inline script needs a CSP nonce or hash.

**Sources:** https://developer.chrome.com/docs/workbox/modules/workbox-recipes · https://web.dev/articles/offline-fallback-page

## Pick a runtime caching strategy for each resource type, with expiry

Route by kind: immutable or content-addressed files → CacheFirst with expiry; avatars → StaleWhileRevalidate; fresh API data → NetworkFirst with a short timeout; personal or streaming traffic → network only. Media then appears instantly offline, and a hung network can't freeze the UI past the timeout.

```ts
// sw.ts
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

registerRoute(({ request }) => request.destination === 'image' || request.destination === 'font',
  new CacheFirst({ cacheName: 'media-v1', plugins: [
    new CacheableResponsePlugin({ statuses: [200] }), // no opaque (status 0) responses
    new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 86400, purgeOnQuotaError: true }),
  ] }));
registerRoute(({ url }) => url.pathname.startsWith('/api/feed'), new NetworkFirst({ cacheName: 'api-v1', networkTimeoutSeconds: 3 }));
registerRoute(({ url }) => url.pathname.startsWith('/avatars/'), new StaleWhileRevalidate({ cacheName: 'avatars-v1' }));
```

**Support:** Every engine with service workers.

**Gotchas:**
- Opaque cross-origin responses hide their status, and Workbox says Chrome counts each as about 7 MB of quota. Use CORS (`crossorigin="anonymous"`) and cache only 200s.
- Never cache per-user API responses in a shared cache unless you delete them on logout.
- Version runtime cache names; Workbox never deletes them ([cleanup](#cleanupoutdatedcaches-plus-your-own-runtime-cache-cleanup)). Don't runtime-cache what the precache serves.
- Cached audio/video needs `RangeRequestsPlugin`: media elements (Safari especially) send Range requests.

**Sources:** https://developer.chrome.com/docs/workbox/caching-strategies-overview · https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video

## Navigation preload (network-first navigations only)

Starts the navigation request while the worker boots and hands it over as `event.preloadResponse`, removing worker startup (tens to hundreds of ms on phones) from network-bound page loads.

```ts
// sw.ts (with Workbox: navigationPreload.enable() from 'workbox-navigation-preload'; NetworkFirst then uses it)
self.addEventListener('activate', (e) => {
  if ('navigationPreload' in self.registration) e.waitUntil(self.registration.navigationPreload.enable());
});
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith((async () => {
    const pre: unknown = await e.preloadResponse;
    return pre instanceof Response ? pre : fetch(e.request);
  })());
});
```

**Support:** Chrome 59+, Firefox 99+, Safari/iOS 15.4+.

**Gotchas:**
- Leave it off when navigations come from a precached shell; it only wastes a request.
- The server sees `Service-Worker-Navigation-Preload: true`; `setHeaderValue()` can send a hint.
- Once enabled, always consume `preloadResponse`, or Chrome warns about a cancelled preload.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/NavigationPreloadManager

## Service Worker Static Routing API (bypass the worker for some requests)

Declare rules at install ("these URLs go to the network", "these from cache"); the browser applies them without starting the worker, so API calls and media skip worker startup on cold launches.

```ts
// sw.ts
type RouterRule = {
  condition: { urlPattern?: string | { pathname: string }; requestMethod?: string; requestMode?: RequestMode; requestDestination?: RequestDestination; runningStatus?: 'running' | 'not-running' };
  source: 'network' | 'cache' | 'fetch-event' | 'race-network-and-fetch-handler' | { cacheName: string };
};
const canRoute = (e: ExtendableEvent): e is ExtendableEvent & { addRoutes(r: RouterRule[]): Promise<void> } =>
  'addRoutes' in e && typeof e.addRoutes === 'function';

self.addEventListener('install', (e) => {
  if (canRoute(e)) e.waitUntil(e.addRoutes([
    { condition: { urlPattern: { pathname: '/api/*' } }, source: 'network' },
    { condition: { requestDestination: 'video' }, source: 'network' },
  ]));
});
```

**Support:** Chrome/Edge 123+ (desktop, Android). Safari 27 (macOS and iOS). Not Firefox. Feature-detect.

**Gotchas:**
- Rules can be added only during install and are fixed for that worker version.
- Workbox entries for unhashed files carry a `__WB_REVISION__` query, so a `{ cacheName }` source won't match them; use `network` rules.
- `urlPattern` must not contain regexp groups; rule count and nesting are limited.
- TS libs don't type `addRoutes` yet, hence the guard.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes · https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

## Update flow: waiting worker, prompt, SKIP_WAITING message, reload once

When a new worker is waiting, show a persistent, non-modal "A new version is ready · Reload" toast. On accept: save drafts, post `SKIP_WAITING`, reload once it controls the page. Auto-update (skipWaiting plus clientsClaim) swaps code under a running page, possibly mid-typing.

```ts
// page
import { Workbox } from 'workbox-window';

const wb = new Workbox('/sw.js'); // Vite: import.meta.env.BASE_URL + 'sw.js'
let reloading = false;
wb.addEventListener('waiting', () => toast({
  title: 'A new version is ready', actionLabel: 'Reload',
  duration: 0, // stays until answered: never interrupt someone mid-message
  onAction: async () => {
    await saveDrafts();
    wb.addEventListener('controlling', () => { if (!reloading) { reloading = true; location.reload(); } });
    wb.messageSkipWaiting(); // posts { type: 'SKIP_WAITING' } to the waiting worker
  },
}));
void wb.register();
```

```ts
// sw.ts: messages are untrusted input
const isSkipWaiting = (m: unknown): boolean => typeof m === 'object' && m !== null && 'type' in m && m.type === 'SKIP_WAITING';
self.addEventListener('message', (e) => { if (isSkipWaiting(e.data)) void self.skipWaiting(); });
```

**Support:** Every engine. `workbox-window` 7 provides `waiting`, `controlling`, `messageSkipWaiting()`. Vite/React: vite-plugin-pwa's `registerSW({ onNeedRefresh })` / `useRegisterSW()`.

**Gotchas:**
- A waiting worker activates only when every client closes; installed apps sit in the app switcher for days.
- Make the toast `role=status`, not a dialog ([navigation-ui-patterns.md](navigation-ui-patterns.md#toasts-and-snackbars-top-layer-safe-areas-live-region-bounded-queue)). Reload only on a click.
- `waiting` also fires on load for a worker already waiting (`event.wasWaitingBeforeRegister`).
- Guard the reload so DevTools "Update on reload" can't loop it. Other tabs also get `controlling`: have them prompt, not reload.

**Sources:** https://developer.chrome.com/docs/workbox/modules/workbox-window · https://web.dev/articles/service-worker-lifecycle

## Apply waiting updates silently when nobody can notice

Also apply updates when nothing visible is lost: at boot before first paint (reload behind the splash), or while hidden with no unsaved input. Like native "updated on next launch", most users never see a prompt.

```ts
// main.ts, before the first render
const swapOnce = (): boolean => {
  try { if (sessionStorage.getItem('sw-swapped')) return false; sessionStorage.setItem('sw-swapped', '1'); return true; }
  catch { return false; } // storage blocked: never risk a reload loop
};
const reg = await navigator.serviceWorker?.getRegistration();
const activateWaiting = (r: ServiceWorkerRegistration): void => {
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  r.waiting?.postMessage({ type: 'SKIP_WAITING' });
};
if (reg?.waiting && swapOnce()) activateWaiting(reg);
else renderApp();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && reg?.waiting && !hasUnsavedInput()) {
    saveUiState(); // route, scroll anchor, drafts: see "Restore route, scroll position and drafts"
    activateWaiting(reg);
  }
});
```

**Support:** Every engine. `sessionStorage` can throw when storage is blocked.

**Gotchas:**
- `skipWaiting` affects every tab of the scope; other tabs must prompt on `controllerchange`.
- A hidden reload is invisible only if route, scroll and drafts restore exactly.
- iOS may suspend before the reload runs; harmless, the new worker is active next launch.

**Sources:** https://web.dev/articles/service-worker-lifecycle

## Check for updates during long-lived sessions

Browsers check `sw.js` only on navigations and functional events (at most once per 24 h). An installed SPA may never navigate, so call `registration.update()` when the app becomes visible (throttled) and hourly.

```ts
const reg = await navigator.serviceWorker.ready;
let last = 0;
const check = (): void => {
  if (!navigator.onLine || reg.installing || Date.now() - last < 60 * 60_000) return;
  last = Date.now();
  reg.update().catch(() => { /* offline or 404: try again later */ });
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
setInterval(check, 60 * 60_000);
```

**Support:** Chrome 45+, Firefox 44+, Safari 11.1+.

**Gotchas:**
- `update()` rejects offline or on a failed script load; always catch.
- A found update flows into the `waiting` prompt; don't reload from here.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update · https://vite-pwa-org.netlify.app/guide/periodic-sw-updates

## sw.js caching headers, a stable URL, scope, and a kill switch

Serve `sw.js` and `index.html` with `no-cache`, hashed assets as immutable. Never rename the worker. Keep manifest `scope` and `start_url` inside the worker scope so the installed app always launches controlled. Keep a self-destroying worker for emergencies: a stuck old worker runs broken code indefinitely.

```text
/sw.js        Cache-Control: no-cache
/index.html   Cache-Control: no-cache
/assets/*     Cache-Control: public, max-age=31536000, immutable
```

```ts
// page
void navigator.serviceWorker.register('/app/sw.js', { scope: '/app/', updateViaCache: 'none' });
```

```ts
// sw.ts: emergency kill switch, deployed at the SAME URL when a release goes bad
self.addEventListener('install', () => { void self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) void c.navigate(c.url);
})()));
```

**Support:** `updateViaCache`: Chrome 68+, Firefox 57+, Safari 11.1+; its default (`imports`) already bypasses the HTTP cache for the main script. `WindowClient.navigate`: Safari 16+.

**Gotchas:**
- Renaming `sw.js` strands users: the old precache keeps registering the old URL.
- Scope defaults to the script's directory; wider needs `Service-Worker-Allowed`.
- Hosts that can't set headers are fine for `sw.js` thanks to `updateViaCache`; Workbox revisions cover `index.html`.
- `start_url` outside scope = uncontrolled launch, no offline ([install-and-identity.md](install-and-identity.md#start_url-and-scope)).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register · https://web.dev/articles/service-worker-lifecycle

## cleanupOutdatedCaches plus your own runtime-cache cleanup

Call `cleanupOutdatedCaches()`, version every runtime cache name, and delete unknown caches on activate. Otherwise storage grows to quota and the browser evicts everything, drafts included.

```ts
// sw.ts
import { cleanupOutdatedCaches } from 'workbox-precaching';
cleanupOutdatedCaches();

const KEEP = new Set(['media-v2', 'api-v3', 'avatars-v1']);
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (!k.startsWith('workbox-precache') && !KEEP.has(k)) await caches.delete(k);
})()));
```

**Support:** Every engine with service workers.

**Gotchas:**
- `cleanupOutdatedCaches` removes only precaches in older Workbox formats; `precacheAndRoute` prunes entries that left the manifest. Neither touches runtime caches.
- Old chunks vanish on activate, so a tab on the old build must reload ([chunk errors](#recover-from-chunk-load-errors-after-a-deploy)).

**Sources:** https://developer.chrome.com/docs/workbox/modules/workbox-precaching

## Recover from chunk-load errors after a deploy

A lazy chunk from the previous build may be gone. Catch the failure, save, reload once, instead of a blank panel or "Failed to fetch dynamically imported module".

```ts
const isChunkLoadError = (r: unknown): boolean => r instanceof Error && (r.name === 'ChunkLoadError' || // webpack
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(r.message));
const recover = (e: Event): void => {
  try { if (sessionStorage.getItem('chunk-reload')) return; sessionStorage.setItem('chunk-reload', '1'); }
  catch { return; } // one try per session: no loops
  e.preventDefault();
  void saveDrafts().finally(() => location.reload());
};
window.addEventListener('vite:preloadError', recover); // Vite's own event
window.addEventListener('unhandledrejection', (e) => { if (isChunkLoadError(e.reason)) recover(e); });
```

**Support:** The messages are Chrome's, Firefox's and Safari's. `vite:preloadError` is Vite's; webpack throws `ChunkLoadError`. In React, the route error boundary offers "Reload" as a last resort.

**Gotchas:**
- Serve the HTML with `no-cache`, or old asset references come back.
- Precache every lazy chunk so the running version stays consistent offline.
- Hosts that replace the whole site on deploy remove old chunks at once.

**Sources:** https://vite.dev/guide/build#load-error-handling

## Take control on first install and announce 'Ready to work offline'

`clientsClaim()` makes the first visit controlled without a reload; otherwise "open once, then go offline" fails. Then say once that the app works offline.

```ts
// sw.ts
import { clientsClaim } from 'workbox-core';
clientsClaim(); // later versions still wait for the user's Reload (SKIP_WAITING)
```

```ts
// page (wb from the update flow)
wb.addEventListener('activated', (e) => { if (!e.isUpdate) toast({ title: 'Ready to work offline' }); });
```

**Support:** `clients.claim()`: Chrome 42+, Firefox 44+, Safari 11.1+.

**Gotchas:**
- Safe on first install (the precache is complete); with the prompt flow, updates still wait for consent.
- Show the notice at most once per device.
- Field-tested: without `clientsClaim`, E2E tests must reload once before going offline.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim

## Web Push subscription (VAPID, user gesture, userVisibleOnly)

From a click, request permission, then `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` and store the subscription with your sender. Push is the only way to notify while the app is closed.

```ts
const canPush = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

/** Call from a click handler. vapidKey: base64url public key → bytes (base64UrlToBytes in sw-client.ts). */
export async function enablePush(vapidKey: Uint8Array<ArrayBuffer>): Promise<'unsupported' | 'denied' | 'granted'> {
  if (!canPush()) return 'unsupported'; // e.g. an iOS Safari tab: suggest Add to Home Screen
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey }));
  await fetch('/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
  return 'granted';
}
// Sender (e.g. npm web-push): sendNotification(sub, payload, { TTL: 3600, urgency: 'high', topic: 'chat-42' })
```

**Support:** Chrome/Edge 42+, Firefox 44+ (desktop and Android), Safari 16+ on macOS 13+. iOS/iPadOS 16.4+: only in a Home Screen web app, never a Safari tab. iOS 26 opens Home Screen sites as web apps by default; keep `display: standalone`.

**Gotchas:**
- Call `requestPermission` and `subscribe` in the same click; Safari and Firefox require a gesture.
- Encrypted payloads are limited to about 4 KB.
- `Topic` (≤32 URL-safe chars) collapses pending pushes per thread; `Urgency: high` suits chat.
- E2EE/serverless: RFC 8291 encryption needs only `p256dh` and `auth`, so the client can encrypt and a tiny relay adds just the VAPID `Authorization`, never seeing plaintext.
- Allow `*.push.apple.com`. Apple rejects a VAPID `sub` that isn't a valid `mailto:` or `https:` URL.
- Android 13+ also needs the OS notification permission for the browser.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe · https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ · https://www.rfc-editor.org/rfc/rfc8291

## Every push must show a notification (and set the badge)

In `push`, validate the payload and always await `showNotification` inside `waitUntil`, updating the badge in the same step. Safari revokes subscriptions whose pushes show nothing; Chrome shows a generic "updated in the background" notice.

```ts
// sw.ts
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const m = parsePush(e.data?.text()); // unknown until validated; never throws
    if (!m) return self.registration.showNotification('New activity'); // still show something
    await self.registration.showNotification(m.title, { body: m.body, tag: m.tag, data: { url: m.url } });
    await self.navigator.setAppBadge?.(m.unread).catch(() => {});
  })());
});
```

**Support:** Push event: Chrome 40+, Firefox 44+, Safari 16 (macOS), iOS 16.4+ Home Screen apps. Badging: Chrome desktop 81+ (ChromeOS 91), Safari 17 installed macOS apps, iOS 16.4+ Home Screen apps; not Chrome Android or Firefox ([install-and-identity.md](install-and-identity.md#app-icon-badge-badging-api)).

**Gotchas:**
- Without `waitUntil` the worker can stop first, which counts as a silent push.
- Chrome tolerates a missing notification while a tab is visible; Safari doesn't.
- Silent "mark read" pushes don't work on Safari; clear stale notifications on the next open ([close when read](#close-notifications-once-the-content-is-read-and-keep-the-badge-in-sync)).
- Firefox gives notification-less pushes a quota that resets on visit.
- Notification text shows on the lock screen; in E2EE apps decrypt in the worker and show only what the user opted into.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Push_API · https://webkit.org/blog/12945/meet-web-push/

## Declarative Web Push (Safari 18.4+): notifications without waking a worker

The payload is JSON the browser understands (`{ web_push: 8030, notification: { title, navigate, … } }`); it shows it and opens `navigate` on tap with no worker code. With `mutable: true` the worker's `push` gets `event.notification` and may replace it (e.g. after decrypting). More reliable on iOS: no worker to fail, no revocation penalty, deep links from a killed app.

```json
{
  "web_push": 8030,
  "notification": {
    "title": "Bo in #general",
    "body": "New message",
    "navigate": "https://app.example/c/general",
    "tag": "chat:general",
    "data": { "url": "/c/general" }
  },
  "mutable": true,
  "app_badge": 3
}
```

```ts
// sw.ts: one handler for Safari (declarative + mutable) and everyone else (a plain push carrying the same JSON)
const declaredOf = (e: PushEvent): Notification | null =>
  'notification' in e && e.notification instanceof Notification ? e.notification : null;

self.addEventListener('push', (e) => {
  const declared = declaredOf(e);
  if (declared) { e.waitUntil(decryptAndShow(declared)); return; } // show nothing and Safari shows the declared one
  const m = parseDeclarative(e.data?.text()); // validated { title, body, tag, navigate } or null
  e.waitUntil(m
    ? self.registration.showNotification(m.title, { body: m.body, tag: m.tag, data: { url: m.navigate } })
    : self.registration.showNotification('New activity'));
});
```

**Support:** Safari 18.4+ on iOS/iPadOS (Home Screen apps) and macOS. In the W3C Push API editor's draft. `window.pushManager` and `PushEvent.notification`: Safari 18.4+ only. `Notification.navigate`: Safari 18.4+, Firefox Nightly. Not Chrome.

**Gotchas:**
- `navigate` is required, for every action too. Without `mutable`, Safari never fires `push`.
- Top-level `app_badge` is WebKit's, not yet in the spec draft; verify on a device.
- Other browsers deliver the JSON to your worker, so keep the fallback branch.
- Field reports (unverified): if the iOS app is already running, a tap only foregrounds it, with no `notificationclick`. Re-check and route on `visibilitychange`.
- A `window.pushManager` subscription has no worker, so `mutable` can't take effect.

**Sources:** https://webkit.org/blog/16535/meet-declarative-web-push/ · https://w3c.github.io/push-api/

## Show notifications through the worker registration, with a page fallback

Use `registration.showNotification()` when supported; `new Notification()` only in desktop tabs before the worker is ready. Worker notifications are the only kind phones show, outlive the page, and route through `notificationclick`.

```ts
const workerCanNotify = (r: { showNotification?: unknown; getNotifications?: unknown }): boolean =>
  typeof r.showNotification === 'function' && typeof r.getNotifications === 'function';

export async function notify(title: string, opts: NotificationOptions, open: () => void): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return; // iOS tab: no Notification
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg && workerCanNotify(reg)) return reg.showNotification(title, opts);
  try {
    const n = new Notification(title, opts); // desktop tab without a worker yet
    n.onclick = () => { window.focus(); open(); n.close(); };
  } catch { /* Chrome Android: worker-only */ }
}
```

**Support:** The constructor throws a TypeError on Chrome Android and Samsung Internet. On iOS 16.4+ `Notification` exists only in Home Screen apps. An iOS Safari tab's registration lacks `showNotification` and `getNotifications`.

**Gotchas:**
- Field-tested: `getNotifications()` in an iOS Safari tab crashed a "mark read" path. Detect both methods.
- Check `typeof Notification` before reading `.permission`.
- Keep page notifications in a per-conversation map so you can close them.
- Don't notify for the conversation that is visible and focused.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification · https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification

## Notification options: what each browser honours

Use `tag` and `data` everywhere; add the rest progressively. One notification per thread, updated in place, with a proper status-bar glyph reads as native.

```ts
type RichOptions = NotificationOptions & {
  renotify?: boolean; image?: string; timestamp?: number; actions?: { action: string; title: string }[];
};
const opts: RichOptions = {
  body, tag: `chat:${chatId}`, data: { url },
  icon: '/icons/192.png',       // Safari ignores it (uses the app icon)
  badge: '/icons/badge-96.png', // Android status bar: a monochrome alpha mask
  renotify: true,               // Chromium: alert again when replacing the same tag
  timestamp: sentAt,            // Chromium: shows the send time of a delayed push
};
if ('maxActions' in Notification && typeof Notification.maxActions === 'number' && Notification.maxActions > 0)
  opts.actions = [{ action: 'read', title: 'Mark read' }];
await reg.showNotification(title, opts);
```

**Support:** MDN BCD, Oct 2026:

| Option | Supported in |
|---|---|
| `data` | All engines |
| `tag`, `icon` | Chrome and Firefox. Safari ignores them. |
| `badge`, `image`, `renotify`, `timestamp` | Chromium only |
| `actions` | Chromium 48+, Firefox 152+. Not Safari. |
| `requireInteraction` | Chromium; Firefox 117+ on Windows only |
| `silent` | Chrome 43+, Firefox 132+, Safari 16.6 macOS. Not iOS. |

**Gotchas:**
- `renotify: true` with an empty `tag` throws a TypeError.
- Safari ignores `tag`, so its notifications stack; close older ones yourself.
- Android draws `badge` from alpha only: an opaque icon becomes a white blob.
- Actions need `notificationclick` to read `e.action`. No inline reply on the web.
- Collapse bursts into one notification per thread ("3 new messages").

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification

## notificationclick: focus the open window and route in place, or open one

Close the notification, read the route from `data`, focus an existing window and `postMessage` the route; `openWindow(url)` only when none exists. The tap lands on the right conversation with drafts and scroll intact.

```ts
// sw.ts
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = noticeUrl(e.notification.data, self.registration.scope); // validated in-scope URL, else the scope
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((c) => c.focused) ?? wins.find((c) => c.visibilityState === 'visible') ?? wins[0];
    if (!win) { await self.clients.openWindow(url); return; }
    win.postMessage({ type: 'app:navigate', url, action: e.action }); // the SPA routes without reloading
    await win.focus();
  })());
});
```

```ts
// page
navigator.serviceWorker.addEventListener('message', (e: MessageEvent<unknown>) => {
  const target = navigateTargetOf(e.data, location.origin); // { url, action } on this origin, else null
  if (target) router.go(target.url);
});
```

**Support:** `openWindow`, `focus`: Chrome 40/42+, Firefox 44+, Safari 11.1+. `notificationclick`: Chrome, Firefox, Safari 16+ (macOS); MDN BCD lists it unsupported on iOS, though it fires in Home Screen apps in practice and is reported unreliable on cold launch (WebKit bug 268797).

**Gotchas:**
- `focus()`/`openWindow()` work only during the click's activation window; call them before slow awaits.
- In Chrome, an in-scope `openWindow` opens inside the installed app's window.
- `client.navigate()` reloads and loses state; prefer `postMessage`.
- iOS fallback: declarative `navigate`, plus a heuristic: on `visibilitychange`, a notification missing from `getNotifications()` was probably tapped.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event · https://bugs.webkit.org/show_bug.cgi?id=268797

## Close notifications once the content is read, and keep the badge in sync

When a conversation is read, close its notifications by matching `data` (not `tag`), then update or clear the badge. Stale notifications and a wrong count are a constant web tell.

```ts
export async function closeFor(url: string, unread: number): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg && typeof reg.getNotifications === 'function')
    for (const n of await reg.getNotifications()) if (urlOf(n.data) === url) n.close(); // data, because Safari ignores tag
  await (unread > 0 ? navigator.setAppBadge?.(unread) : navigator.clearAppBadge?.())?.catch(() => {}); // not installed: no icon
}
```

**Support:** `getNotifications`: Chrome 40+, Firefox 44+, Safari 16 (macOS 13+), iOS 16.4+ Home Screen apps only. Badge: see [Every push](#every-push-must-show-a-notification-and-set-the-badge); Chrome Android shows notification dots instead.

**Gotchas:**
- `getNotifications({ tag })` filters only where `tag` works.
- On iOS the badge needs notification permission; a rejection when not installed is expected.
- Mark read only while visible (and focused on desktop).
- Not installed: badge the title and favicon ([navigation-ui-patterns.md](navigation-ui-patterns.md#favicon-and-app-icon-badges-reflect-live-state)).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/getNotifications · https://developer.mozilla.org/en-US/docs/Web/API/Navigator/setAppBadge

## Notification permission UX: ask at the right moment, cover every state

Never prompt on load. An in-app "Enable notifications" button triggers the prompt. Render unsupported (iOS: "Add to Home Screen first"), default, denied (how to unblock) and granted (with an in-app mute), and watch for changes.

```ts
const label = (s: NotificationPermission | PermissionState | 'unsupported', ios: boolean): string =>
  s === 'unsupported' ? (ios ? 'Add to Home Screen to get notifications' : 'Not supported in this browser')
  : s === 'denied' ? 'Blocked: allow notifications in site settings'
  : s === 'granted' ? 'Notifications on' : 'Enable notifications';

enableButton.addEventListener('click', async () => showPushState(await enablePush(vapidKey))); // the click reaches the prompt
const status = await navigator.permissions?.query({ name: 'notifications' }).catch(() => null);
status?.addEventListener('change', () => showPushState(status.state)); // revoked in OS or site settings
```

**Support:** `permissions.query`: Chrome 43+, Firefox 46+, Safari 16+. Safari and Firefox 72+ need a gesture for the prompt; Chrome quiets prompts on often-blocked sites. Since late 2025 Chrome's Safety Check auto-revokes notification permission from low-engagement, high-volume sites; installed web apps are exempt.

**Gotchas:**
- Code can't re-prompt after `denied`.
- Keep an app-level mute separate from the browser permission.
- The `push` permission name isn't supported everywhere; catch query errors.
- On iOS show the button only in standalone mode ([install-and-identity.md](install-and-identity.md#detect-the-installed-app)). General rules: [device-apis.md](device-apis.md#permission-ux-ask-in-context-never-on-load).

**Sources:** https://web.dev/articles/push-notifications-permissions-ux · https://blog.google/chromium/automatic-notification-permission/

## Keep push subscriptions alive

Subscriptions vanish (iOS especially) and the app silently stops notifying. On launch and on becoming visible, compare `getSubscription()` with the server's copy and resubscribe if permission is granted but the subscription is gone; handle `pushsubscriptionchange`; delete server-side subscriptions answered with 404/410.

```ts
export async function ensureSubscription(vapidKey: Uint8Array<ArrayBuffer>): Promise<void> {
  if (!canPush() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey }).catch(() => null)); // Firefox may want a gesture
  if (sub && sub.endpoint !== (await kv.get('pushEndpoint'))) { await postSubscription(sub); await kv.set('pushEndpoint', sub.endpoint); }
}
```

```ts
// sw.ts: the browser rotated the subscription; read the VAPID key from IndexedDB (Firefox has no e.oldSubscription)
self.addEventListener('pushsubscriptionchange', (e) => { if (e instanceof ExtendableEvent) e.waitUntil(resubscribeFromWorker()); });
```

**Support:** `pushsubscriptionchange`: Chrome 138+, Firefox 44+ (no `oldSubscription`/`newSubscription`), Safari 16 macOS. Not iOS. `expirationTime` is usually null.

**Gotchas:**
- Resubscribing in the worker needs the `applicationServerKey` (from `oldSubscription?.options` or IndexedDB).
- On iOS the Home Screen app and Safari tabs hold separate subscriptions; store them per device.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event

## Outbox plus Background Sync, with a fallback that works everywhere

Write every outgoing action to an IndexedDB outbox first and show it as pending. With Background Sync, the worker flushes when connectivity returns, even after the tab closed; elsewhere flush on `online`, on visible and at launch. Sending works in a tunnel, like native messaging. Pending UI: [motion-performance.md](motion-performance.md#optimistic-ui-apply-the-result-immediately-reconcile-later-and-use-undo-instead-of-confirmation).

```ts
type SyncReg = ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } };
const hasSync = (r: ServiceWorkerRegistration): r is SyncReg => 'sync' in r;

export async function send(msg: Outgoing): Promise<void> {
  await outbox.add(msg); // durable first
  const reg = await navigator.serviceWorker.ready;
  if (hasSync(reg)) await reg.sync.register('outbox').catch(() => flushOutbox());
  else void flushOutbox();
}
window.addEventListener('online', () => void flushOutbox());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void flushOutbox(); });
```

```ts
// sw.ts (fetch-based APIs can instead use Workbox's BackgroundSyncPlugin on POST routes)
self.addEventListener('sync', (e) => {
  if (e instanceof ExtendableEvent && 'tag' in e && e.tag === 'outbox') e.waitUntil(flushOutboxFromWorker());
});
```

**Support:** Background Sync: Chromium only (Chrome/Edge 49+). Without it, Workbox's `Queue`/`BackgroundSyncPlugin` replays at worker startup.

**Gotchas:**
- Chrome retries a failed sync only a few times; the outbox must outlive it.
- Use idempotent IDs; take a Web Lock so page and worker don't flush at once.
- Sockets: the worker can open one inside `waitUntil`, but events are capped (~5 min); flushing on reconnect is simpler.
- Show the queued count ("Offline · 2 messages queued").

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API · https://developer.chrome.com/docs/workbox/modules/workbox-background-sync

## Periodic Background Sync (Chromium, installed apps only)

The browser wakes the worker every N hours on a good network to prefetch, so the app opens to fresh content like a native background refresh.

```ts
type PeriodicReg = ServiceWorkerRegistration & { periodicSync: { register(tag: string, o: { minInterval: number }): Promise<void> } };
const hasPeriodic = (r: ServiceWorkerRegistration): r is PeriodicReg => 'periodicSync' in r;
const perms: { query(d: { name: string }): Promise<PermissionStatus> } = navigator.permissions; // name not in TS's PermissionName

const reg = await navigator.serviceWorker.ready;
const state = (await perms.query({ name: 'periodic-background-sync' }).catch(() => null))?.state;
if (hasPeriodic(reg) && state === 'granted') await reg.periodicSync.register('refresh', { minInterval: 12 * 60 * 60_000 });
```

```ts
// sw.ts
self.addEventListener('periodicsync', (e) => {
  if (e instanceof ExtendableEvent && 'tag' in e && e.tag === 'refresh') e.waitUntil(prefetchLatest());
});
```

**Support:** Chrome/Edge 80+ only, granted only to an installed app; frequency follows engagement (minimum about 12 h). Not Firefox or Safari.

**Gotchas:**
- Not for real-time messaging; timing isn't guaranteed and it never fires at zero engagement.
- Test with DevTools > Application > Periodic background sync.

**Sources:** https://developer.chrome.com/docs/capabilities/periodic-background-sync

## Background Fetch for large downloads and uploads (Chromium)

Hand big transfers to the browser so they survive closing the app, with system download UI and a worker event on completion: native "download for offline".

```ts
type BgFetchReg = ServiceWorkerRegistration & {
  backgroundFetch: { fetch(id: string, urls: string[], o: { title: string; downloadTotal?: number }): Promise<unknown> };
};
const hasBgFetch = (r: ServiceWorkerRegistration): r is BgFetchReg => 'backgroundFetch' in r;
const reg = await navigator.serviceWorker.ready;
if (hasBgFetch(reg)) await reg.backgroundFetch.fetch('ep42', ['/media/ep42.mp4'], { title: 'Episode 42', downloadTotal: 120_000_000 });
else await downloadWithProgress('/media/ep42.mp4'); // fetch + ReadableStream progress; the page must stay open
```

```ts
// sw.ts (BackgroundFetch* types aren't in TS's lib)
type BgFetchEvent = ExtendableEvent & {
  registration: { matchAll(): Promise<{ request: Request; responseReady: Promise<Response> }[]> };
  updateUI(o: { title: string }): Promise<void>;
};
const isBgFetch = (e: Event): e is BgFetchEvent => e instanceof ExtendableEvent && 'registration' in e && 'updateUI' in e;
self.addEventListener('backgroundfetchsuccess', (e) => {
  if (!isBgFetch(e)) return;
  e.waitUntil((async () => {
    const cache = await caches.open('downloads');
    for (const r of await e.registration.matchAll()) await cache.put(r.request, await r.responseReady);
    await e.updateUI({ title: 'Episode 42 is ready offline' });
  })());
});
```

**Support:** Chrome/Edge 74+ only. Not Firefox or Safari.

**Gotchas:**
- Exceeding a set `downloadTotal` fails the fetch.
- Users can cancel from browser UI (`backgroundfetchabort`).
- Every other browser needs the fallback path.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Background_Fetch_API

## Request persistent storage and show usage

Call `navigator.storage.persist()` once the user has data worth keeping, and show `estimate()` in Settings. Persistent origins are exempt from storage-pressure eviction (and, per WebKit, from eviction in Safari 17+).

```ts
export async function protectData(): Promise<'persisted' | 'best-effort' | 'unsupported'> {
  if (typeof navigator.storage?.persist !== 'function') return 'unsupported';
  if (await navigator.storage.persisted()) return 'persisted';
  return (await navigator.storage.persist()) ? 'persisted' : 'best-effort';
}
const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {};
const storageLine = `${(usage / 1e6).toFixed(1)} MB used of ${(quota / 1e9).toFixed(0)} GB`;
```

**Support:** `persist`: Chrome 55+, Firefox 57+, Safari 15.2+. `estimate`: Chrome 61+, Firefox 57+, Safari 17+. Firefox prompts; Chrome, Edge and Safari decide silently from engagement (Safari, e.g., for a Home Screen web app).

**Gotchas:**
- Firefox prompts, so call it from a click or after a meaningful action, never on load.
- Per-origin quotas (MDN):

  | Browser | Quota |
  |---|---|
  | Chromium | 60% of disk |
  | Firefox, best-effort | Smaller of 10% of disk and 10 GiB (group limit) |
  | Firefox, persistent | 50% of disk, up to 8 TiB |
  | Safari 17+ | About 60% for browsers and Home Screen/Dock web apps, about 15% for other WKWebView apps |

  The old "50 MB on Safari" advice is obsolete.
- `estimate()` is approximate and padded. Users can still clear data, so keep a backup or export.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria · https://webkit.org/blog/14403/updates-to-storage-policy/

## Survive Safari's 7-day eviction of script-written storage

With tracking prevention on (the default), Safari deletes all script-written data of an origin (IndexedDB, localStorage, Cache API, the worker registration) after 7 days of Safari use without interaction. Server-set cookies are exempt. Home Screen web apps keep their own counter, so normal use doesn't trigger it.

```ts
if (!isStandalone() && isAppleWebKit()) offerInstall('Add to Home Screen so your data stays on this device');
await protectData(); // persist(): Safari 17+ exempts persistent-mode origins from eviction
await syncBackup();  // a server or relay copy, or an export file the user keeps
// E2EE identity keys: show the recovery phrase or export during onboarding, not later
```

**Support:** Safari on macOS and iOS/iPadOS, and every WebKit-based iOS browser. In the EU (iOS 17.4+), other-engine browsers follow their own policies.

**Gotchas:**
- Never let browser storage be the only copy of irreplaceable data, especially private keys.
- Days of Safari use, not calendar days: untestable directly, so test that a restore path exists.
- WebKit is vague on whether persistent mode also stops the 7-day deletion; keep the backup.

**Sources:** https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ · https://webkit.org/blog/14403/updates-to-storage-policy/

## iOS Home Screen apps have their own storage: onboard inside the app

An iOS Home Screen web app has its own cookies, localStorage, IndexedDB and push subscription, separate from Safari. Users sign in in Safari, install, and land logged out. Detect the first standalone launch and offer restore or transfer.

```ts
// First launch as the installed app with no local identity: go to restore, not marketing
if (isStandalone() && !(await kv.get('identity'))) router.replace('/welcome-back');
// Offer: passkey sign-in (shared through iCloud Keychain), a one-time code or QR shown in the Safari tab,
// or a recovery phrase / invite link pasted into the app. Avoid magic links: a tapped link opens Safari, not the app.
```

**Support:** iOS/iPadOS Home Screen web apps; iOS 26 opens Home Screen sites as web apps by default, so more users hit it. macOS Safari 17+ Dock apps also get separate storage (cookies copied once at creation). Chrome/Edge installed apps and Firefox Taskbar Tabs share the profile.

**Gotchas:**
- Deleting the icon deletes its data.
- Assume nothing (Cache Storage, worker registration) is shared with Safari.
- Say so before install ("you'll sign in once more inside the app"): [install-and-identity.md](install-and-identity.md#install-promotion-ux).

**Sources:** https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ · https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios

## IndexedDB done right: validated reads, durable writes, reconnects

Wrap IndexedDB: validate every read, use `durability: 'strict'` for must-keep writes, close on `versionchange`, reopen after Safari drops the connection. Corrupt data must never crash the launch, and a background disconnect must not break resume.

```ts
import { createStore, get } from 'idb-keyval';
const store = createStore('app', 'kv');
/** Stored data is untrusted input: an old or corrupt value falls back instead of crashing the launch. */
export const load = async <T>(key: string, parse: (raw: unknown) => T | null, fallback: T): Promise<T> =>
  parse(await get<unknown>(key, store).catch(() => undefined)) ?? fallback;

export function putDraft(db: IDBDatabase, key: string, draft: string): void { // must-not-lose (drafts flushed on hide)
  const tx = db.transaction('drafts', 'readwrite', { durability: 'strict' });
  tx.objectStore('drafts').put(draft, key);
  tx.commit();
}
export const watchVersion = (db: IDBDatabase): void => {
  db.onversionchange = () => { db.close(); toast({ title: 'Updated in another tab', actionLabel: 'Reload', onAction: () => location.reload() }); };
};
let conn: Promise<IDBDatabase> | null = null;
export async function withDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try { return await run(await (conn ??= openDb())); }
  catch (err) {
    if (!(err instanceof DOMException) || err.name !== 'UnknownError') throw err;
    conn = null; // iOS dropped the connection while suspended: reopen once
    return run(await (conn ??= openDb()));
  }
}
```

**Support:** IndexedDB: all engines. `durability`: Chrome 83+, Firefox 126+, Safari 15+. `commit()`: Chrome 76+, Firefox 74+, Safari 15+.

**Gotchas:**
- iOS 17.4+ can throw `UnknownError: Connection to Indexed Database server lost` after backgrounding (WebKit bug 273827). Reopen; if it persists, keep data in memory and reload.
- Default durability differs per browser.
- `localStorage` is synchronous and ~5 MB: tiny boot hints only. Wrap all storage access in try/catch.
- An unhandled `versionchange` blocks upgrades in other tabs.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction · https://bugs.webkit.org/show_bug.cgi?id=273827

## Origin Private File System (OPFS) for large or binary data and SQLite

A private, origin-scoped file system. Synchronous access handles in a dedicated worker give fast byte-level I/O for SQLite-WASM and large media, without IndexedDB blob juggling.

```ts
// page
const root = await navigator.storage.getDirectory();
const fh = await root.getFileHandle('media.bin', { create: true });
if ('createWritable' in fh) { const w = await fh.createWritable(); await w.write(blob); await w.close(); }
```

```ts
// worker.ts (dedicated worker only)
const dir = await navigator.storage.getDirectory();
const h = await (await dir.getFileHandle('db.sqlite3', { create: true })).createSyncAccessHandle();
h.write(bytes, { at: 0 }); h.flush(); h.close();
```

**Support:** `getDirectory`: Chrome 86+ (Android 109+), Firefox 111+, Safari 15.2+. `createSyncAccessHandle` (dedicated workers): Chrome 102+ (Android 109+), Firefox 111+, Safari 15.2+. `createWritable`: Chrome 86+, Firefox 111+, Safari 26+.

**Gotchas:**
- Same quota and eviction rules as other storage, Safari's 7-day rule included.
- A sync access handle locks the file exclusively; coordinate tabs with Web Locks.
- Invisible to users; export via File System Access or a download ([device-apis.md](device-apis.md#file-system-access-pickers-with-fallbacks)).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system

## Storage Buckets: separate eviction policies per kind of data (Chromium)

Named buckets, each with its own IndexedDB, Cache Storage and OPFS, persistence, durability and expiry. Under pressure the browser evicts the media cache, not unsent drafts.

```ts
type Bucket = { indexedDB: IDBFactory; caches: CacheStorage; getDirectory(): Promise<FileSystemDirectoryHandle> };
type Buckets = { open(name: string, o?: { persisted?: boolean; durability?: 'strict' | 'relaxed'; expires?: number }): Promise<Bucket> };
const nav: Navigator & { storageBuckets?: Buckets } = navigator;
const draftsDb = nav.storageBuckets ? (await nav.storageBuckets.open('drafts', { persisted: true, durability: 'strict' })).indexedDB : indexedDB;
const mediaCache = nav.storageBuckets ? (await nav.storageBuckets.open('media', { durability: 'relaxed', expires: Date.now() + 30 * 864e5 })).caches : caches;
```

**Support:** Chrome/Edge 122+ only (experimental). Not Firefox or Safari.

**Gotchas:**
- `persisted: true` can be refused, like `persist()`.
- Keep one code path that falls back to the default bucket.

**Sources:** https://developer.chrome.com/docs/web-platform/storage-buckets

## Multi-tab coordination: Web Locks plus BroadcastChannel

A Web Lock makes one tab own connections and the outbox flush; a BroadcastChannel spreads logout, read marks and new versions to every tab. Without them: duplicate sends, notifications and sounds, and tabs still logged in after logout.

```ts
// Leader election: the callback's promise never settles, so this tab holds the lock until it closes
void navigator.locks.request('leader', () => new Promise<never>(() => startConnections()));
// Exclusive sections shared by tabs and the worker
await navigator.locks.request('outbox', () => flushOutbox());

const bus = new BroadcastChannel('app'); // never delivers to the sender: the leader applies its own events
bus.onmessage = (e: MessageEvent<unknown>) => { if (parseBusMessage(e.data)?.type === 'logout') location.reload(); };
bus.postMessage({ type: 'logout', v: 1 }); // versioned: another tab may run another build
```

**Support:** Web Locks: Chrome 69+, Firefox 96+, Safari 15.4+. BroadcastChannel: Chrome 54+, Firefox 38+, Safari 15.4+. Both work in workers.

**Gotchas:**
- On mobile a hidden leader is suspended; a visible tab can take over with `{ steal: true }` when the leader's heartbeat is stale.
- `{ ifAvailable: true }` is a try-lock; a `signal` gives up waiting.
- Locks are per origin and storage partition: an iOS Home Screen app doesn't share them with Safari.
- Validate bus messages. Whether held locks block bfcache varies by engine (unverified).
- Presence and multi-window UX: [navigation-ui-patterns.md](navigation-ui-patterns.md#multiple-windows-and-tabs-one-leader-shared-state-active-window).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API · https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel

## Online/offline detection beyond navigator.onLine

`onLine === false` means offline; `true` means only maybe online. Derive offline / reconnecting / online from the flag plus your transport's real state, retry with backoff and jitter, and show a calm self-clearing banner, not hanging spinners or "Network error" alerts.

```ts
export type Net = 'online' | 'reconnecting' | 'offline';
export const netState = (browserOnline: boolean, transportUp: boolean): Net =>
  !browserOnline ? 'offline' : transportUp ? 'online' : 'reconnecting';
export const backoff = (attempt: number): number => Math.min(30_000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);

window.addEventListener('online', () => reconnectNow()); // skip the remaining backoff wait
window.addEventListener('offline', () => renderConnection());
// HTTP apps: probe an endpoint the worker never answers from cache
const probe = (): Promise<boolean> =>
  fetch('/ping', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(4000) }).then((r) => r.ok, () => false);
```

**Support:** `online`/`offline` and `navigator.onLine`: all engines. `AbortSignal.timeout`: Chrome 103+, Firefox 100+, Safari 16+.

**Gotchas:**
- `onLine` is true behind captive portals, on a LAN without uplink, or with a dead VPN.
- A `no-store` fetch still goes through the worker; exclude the probe route or give it a static `network` route.
- Debounce the banner (~2 s).
- Save-Data and connection hints: [device-apis.md](device-apis.md#network-information-save-data-and-battery-status-dont).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine

## Page Lifecycle: save on 'hidden', not on unload

Persist drafts and UI state continuously (debounced) and flush when `visibilityState` becomes `hidden`, the last reliable event before a phone suspends or kills the app. Add `pagehide`, plus `freeze` and `wasDiscarded` on Chromium.

```ts
const flush = (): void => { void saveDrafts(); saveUiState(); }; // start the IndexedDB writes synchronously
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush); // Safari/iOS, and bfcache entry
document.addEventListener('freeze', flush); // Chromium only
const doc: Document & { wasDiscarded?: boolean } = document;
if (doc.wasDiscarded) restoreUiState(); // Chromium: the tab was discarded while hidden
```

**Support:** `visibilitychange`, `pagehide`: all engines. `freeze`, `resume`, `wasDiscarded`: Chrome 68+ only. `beforeunload` doesn't fire on iOS Safari. Chrome's staged removal of `unload` handlers reached 100% of page loads in Sept 2026.

**Gotchas:**
- The hidden handler gets very little time on iOS: start IndexedDB writes synchronously, don't await network ([fetchLater](#last-chance-network-sends-fetchlater-and-sendbeacon)).
- Attach `beforeunload` only while unsaved changes exist.
- Background timers are throttled or frozen; recompute from `Date.now()`.
- A desktop window behind others still reports `visible`; check `document.hasFocus()`.
- Headless browsers always report visible: unit-test the decision, keep the wiring tiny.

**Sources:** https://developer.chrome.com/docs/web-platform/page-lifecycle-api · https://developer.chrome.com/docs/web-platform/deprecating-unload

## Restore route, scroll position and drafts on relaunch

Store the last route, a scroll anchor (top visible item ID, not pixels) and per-conversation drafts. On a bare standalone launch, restore the route before first paint, then anchor and draft. iOS evicts background web apps often; landing on home with the draft gone is a web tell.

```ts
// Save from the 'hidden' flush and, debounced, on navigation
const saveUi = (): void => {
  try { localStorage.setItem('ui', JSON.stringify({ route: location.hash, anchor: topVisibleId(), at: Date.now() })); }
  catch { /* storage blocked */ }
};
// Boot, before render: a synchronous read, so the home screen never flashes first
history.scrollRestoration = 'manual';
const ui = parseUi(readJson('ui')); // validated { route, anchor, at }, or null
const bare = isStandalone() && (location.hash === '' || location.hash === '#/');
if (bare && ui && Date.now() - ui.at < 7 * 864e5) history.replaceState(null, '', ui.route);
// Drafts: IndexedDB key `draft:<chatId>`, saved on input (300 ms debounce) and on hide, restored on mount
```

**Support:** Standard APIs; `history.scrollRestoration` in all engines.

**Gotchas:**
- A deep link (notification, share target, invite) beats the restore.
- `sessionStorage` dies with a killed app; read the boot hint from `localStorage` synchronously.
- Expire and validate snapshots. Don't resume into confirm, payment or expired-auth screens.
- Scroll to the anchor only after final layout; chat views restore distance from the bottom.
- Per-screen scroll on Back: [navigation-ui-patterns.md](navigation-ui-patterns.md#preserve-scroll-per-screen-and-resume-the-last-screen-on-relaunch).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/History/scrollRestoration

## Resume from background: reconnect, resync, refresh

On becoming visible or a bfcache restore, assume sockets died and timers froze: ping or reconnect, fetch since the last cursor, check for an update, refresh the badge, mark the visible conversation read.

```ts
const resume = (): void => {
  reconnectIfStale();           // ping; no pong within ~3-5 s → new socket
  void syncSince(lastCursor);   // everything since the last event id
  void reg.update().catch(() => {});
  markVisibleChatRead();        // also closes its notifications
  refreshBadge();
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resume(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) resume(); }); // bfcache restore
document.addEventListener('resume', resume); // Chromium: unfrozen
let beat = Date.now(); // a heartbeat that comes back late means the page was suspended
setInterval(() => { if (Date.now() - beat > 30_000) resume(); beat = Date.now(); }, 10_000);
```

**Support:** All engines. Chrome throttles chained timers in pages hidden over 5 minutes to about once a minute. iOS suspends hidden web apps within seconds; only push runs in the background.

**Gotchas:**
- A WebSocket killed during suspension may still report `OPEN`; use an app-level ping with timeout.
- Publish presence "away" on hidden, "online" on visible.
- Missed-message alerts while suspended can only come from push.
- Platform summary: [platform-quirks-testing.md](#resume-from-background-reconnect-resync-refresh).

**Sources:** https://developer.chrome.com/blog/timer-throttling-in-chrome-88 · https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event

## Back/forward cache eligibility

No `unload` listeners, avoid `Cache-Control: no-store` on app HTML, close sockets on `pagehide` and reopen on `pageshow` when `persisted`, and log `notRestoredReasons`. Back/forward then restore instantly; this matters for tabs, multi-page entry points and OAuth or payment round-trips.

```ts
window.addEventListener('pagehide', (e) => { if (e.persisted) socket.close(1000, 'bfcache'); });
// pageshow with e.persisted → the resume handler above reconnects and resyncs
const nav = performance.getEntriesByType('navigation')[0];
if (nav && 'notRestoredReasons' in nav && nav.notRestoredReasons) report('bfcache-miss', nav.notRestoredReasons); // Chrome 125+
```

**Support:** All engines have a bfcache. Chrome admits `no-store` pages in some cases but evicts them on cookie changes and after about 3 minutes. Chrome 149 closes open WebSockets on entry instead of refusing the page (field reports say rollout is gradual). Safari closes them; Firefox refuses pages with open sockets. `notRestoredReasons`: Chrome 125+.

**Gotchas:**
- Third-party scripts often add `unload`; audit in DevTools > Application > Back/forward cache.
- Open WebRTC, IndexedDB connections blocking a `versionchange`, and `window.opener` can block or evict.
- After a restore, socket `close` fires; make sure reconnect can't double-connect.
- An installed SPA is one document, so this mostly matters for entry points and round-trips.

**Sources:** https://web.dev/articles/bfcache · https://developer.chrome.com/docs/web-platform/bfcache-ccns

## Last-chance network sends: fetchLater and sendBeacon

For server-side state (analytics, read position, "last seen"), queue a request the browser delivers even if the page is killed: `fetchLater` on Chromium, `sendBeacon` from the hidden handler elsewhere.

```ts
type FetchLater = (url: string, init: RequestInit & { activateAfter?: number }) => { readonly activated: boolean };
const w: Window & { fetchLater?: FetchLater } = window;
let pending: AbortController | undefined;
let beaconBody: string | undefined;
export function queueState(body: string): void {
  if (!w.fetchLater) { beaconBody = body; return; }
  pending?.abort(); // keep one deferred request, not one per call
  pending = new AbortController();
  w.fetchLater('/api/state', { method: 'POST', body, signal: pending.signal, activateAfter: 60_000 });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || beaconBody === undefined) return;
  navigator.sendBeacon('/api/state', new Blob([beaconBody], { type: 'text/plain' }));
  beaconBody = undefined;
});
```

**Support:** `fetchLater`: Chrome/Edge 135+ only. `sendBeacon`: Chrome 39+, Firefox 31+, Safari 11.1+.

**Gotchas:**
- `sendBeacon` is POST only with a ~64 KB in-flight budget; cross-origin Blobs need a CORS-safelisted type (`text/plain`).
- Local-first apps without a server flush to IndexedDB instead ([Page Lifecycle](#page-lifecycle-save-on-hidden-not-on-unload)).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater · https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon

## Content Index API: list offline content in the OS (Chrome Android)

Register cached articles or pages and Chrome Android lists them in its offline content surface, like a native app's downloads.

```ts
type IndexReg = ServiceWorkerRegistration & {
  index: { add(d: { id: string; url: string; title: string; description: string; category?: string }): Promise<void>; delete(id: string): Promise<void> };
};
const hasIndex = (r: ServiceWorkerRegistration): r is IndexReg => 'index' in r;
const reg = await navigator.serviceWorker.ready;
if (hasIndex(reg)) await reg.index.add({ id: 'post-42', url: '/posts/42', title, description, category: 'article' });
// sw.ts: on 'contentdelete' (removed in Chrome's UI), delete that entry from your cache
```

**Support:** Chrome Android 84+ only (experimental).

**Gotchas:**
- Register only URLs that really work offline; remove entries when you evict their cache.
- A minor nicety, not core UX.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Content_Index_API

## No state in service-worker globals; always waitUntil

Browsers stop idle workers (Chrome: ~30 s), cap events (~5 min) and may kill them sooner on iOS. Keep state in IndexedDB or the Cache API and pass every async job to `waitUntil()`, or badges reset and notifications never show.

```ts
// sw.ts. BAD: `let unread = 0;` resets whenever the browser restarts the worker
import { createStore, get, set } from 'idb-keyval';
const store = createStore('app', 'kv');
self.addEventListener('push', (e) => e.waitUntil((async () => {
  const unread = ((await get<number>('unread', store)) ?? 0) + 1;
  await set('unread', unread, store);
  await self.navigator.setAppBadge?.(unread).catch(() => {});
  await self.registration.showNotification('New message', { tag: 'inbox', data: { unread } });
})()));
```

**Support:** All engines. The timeouts are implementation details, not guarantees.

**Gotchas:**
- No `setTimeout`-based work in the worker.
- No DOM or `localStorage` in the worker: only IndexedDB, Cache API, `postMessage`.
- Workbox modules are safe; they hold no cross-event state.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ExtendableEvent/waitUntil

## Test the worker: pure decision module plus e2e against the production build

Keep worker decisions (message parsing, notification data, URLs, capability detection) in a pure, unit-tested module ([sw-logic.ts](../templates/sw-logic.ts)); `sw.ts` and page glue only wire events. Test the wiring end to end against the built app. Field-tested: a missing `getNotifications` on iOS was a production-only crash. E2E setup: [platform-quirks-testing.md](platform-quirks-testing.md#e2e-against-the-production-build).

```ts
// Playwright: simulate an iOS Safari tab, whose registration can't notify
await page.addInitScript(() => {
  Reflect.deleteProperty(ServiceWorkerRegistration.prototype, 'getNotifications');
  Reflect.deleteProperty(ServiceWorkerRegistration.prototype, 'showNotification');
});
```

**Support:** Playwright with Chromium supports service workers, `setOffline` and notification grants. iOS-only behaviour (push, storage isolation, 7-day eviction, killed-app relaunch) needs a device check ([platform-quirks-testing.md](platform-quirks-testing.md#ios-simulator-and-safari-web-inspector)).

**Gotchas:**
- Dev servers have no worker (vite-plugin-pwa `devOptions` behave differently).
- Turn off DevTools "Update on reload" when testing the prompt flow.
- Simulate a push in DevTools > Application > Service workers; Background services records sync, fetch, push and notification events.
- A fresh browser context means a fresh worker.

**Sources:** https://playwright.dev/docs/service-workers · https://developer.chrome.com/docs/devtools/application/background-services

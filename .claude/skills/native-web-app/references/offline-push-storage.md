# Service worker, offline, push, storage and lifecycle

How an installed web app starts from disk, updates without pulling the UI out from under the user, notifies while closed, keeps its data, and survives being suspended, killed and relaunched. Support is as of Oct 2026 (MDN browser-compat-data: Chrome 154, Safari 27, Firefox 157, plus vendor notes).
TS snippets compile under `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Worker snippets (`// sw.ts`) assume their own tsconfig with lib `["ES2022", "WebWorker"]` and `declare const self: ServiceWorkerGlobalScope`. Names like `saveDrafts()`, `toast()` or `router` stand for your own code. Working code: [sw.ts](../templates/sw.ts), [sw-client.ts](../templates/sw-client.ts), [sw-logic.ts](../templates/sw-logic.ts), [lifecycle.ts](../templates/lifecycle.ts).

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

At install time, precache the hashed build output and `index.html` so every launch is served from disk, online or offline. That removes the blank screen, the browser's offline dinosaur and the cold start that waits on the network. `generateSW` writes the worker for you. `injectManifest` injects the file list (`self.__WB_MANIFEST`) into your own `sw.ts`, and you need it as soon as you have push, `notificationclick` or message handling.

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

With Vite: `VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', injectRegister: false, registerType: 'prompt', injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] } })`. With `injectRegister: false` the page registers the worker itself, which the update prompt needs.

**Support:** Service workers: Chrome 40+, Firefox 44+, Safari 11.1+, iOS 11.3+ (tabs and Home Screen apps). Workbox 7.4.1 and vite-plugin-pwa 1.3.0 are current.

**Gotchas:**
- Precache only the shell. Large media or locale bundles slow the first install and are downloaded again on every revision. Workbox skips files over `maximumFileSizeToCacheInBytes` (2 MiB) with only a warning. vite-plugin-pwa 0.20.2+ turns that warning into a build error.
- The DOM and WebWorker TS libs conflict in one program, so give `sw.ts` its own tsconfig.
- Hash routes are served by `precacheAndRoute`'s `directoryIndex` alone. History routes need the `NavigationRoute`, with a denylist so API and file URLs don't receive `index.html`.
- vite-plugin-pwa `generateSW` defaults to `cleanupOutdatedCaches: true` and `navigateFallback: 'index.html'`. `registerType: 'autoUpdate'` also turns on skipWaiting and clientsClaim. Avoid it; see [Update flow](#update-flow-waiting-worker-prompt-skip_waiting-message-reload-once).
- Dev servers have no worker, so test offline start against the production build.
- The cached shell is the first frame, so it should already look like the app: see [motion-performance.md](motion-performance.md#app-shell-instant-start-the-first-frame-comes-from-html-and-the-cache-not-from-js).

**Sources:** https://developer.chrome.com/docs/workbox/modules/workbox-precaching · https://vite-pwa-org.netlify.app/guide/inject-manifest · https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API

## Offline fallback page for network-first navigations

In a server-rendered or multi-page app, navigations go to the network. When that fetch fails, serve a precached, self-contained offline page instead of the browser's error page. A branded "You're offline · Try again" screen looks like an app that can't reach its server. The browser's error page looks like a website.

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

**Support:** Only Service Worker and Cache API features, so it works wherever service workers do. `workbox-recipes` ships with Workbox 7.

**Gotchas:**
- `offlineFallback` installs the single global `setCatchHandler`, which replaces any catch handler you set earlier.
- An SPA with a precached shell doesn't need this, because the shell is its offline page. Show offline state inside the app instead ([navigation-ui-patterns.md](navigation-ui-patterns.md#designed-empty-loading-error-and-offline-states-on-every-screen)).
- The page can use only what is cached. Inline its styles, and keep it within your CSP (an inline script needs a nonce or hash).

**Sources:** https://developer.chrome.com/docs/workbox/modules/workbox-recipes · https://web.dev/articles/offline-fallback-page

## Pick a runtime caching strategy for each resource type, with expiry

Route requests by kind:
- Immutable or content-addressed files: CacheFirst with expiry.
- Avatars and other non-critical data: StaleWhileRevalidate.
- Fresh API data: NetworkFirst with a short timeout.
- Personal or streaming traffic: network only.

Images and fonts then appear instantly on revisits and offline, with no grey boxes or reflow, and a hung network can't freeze the UI past the timeout.

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

**Support:** Cache API and Workbox strategies work in every engine that has service workers.

**Gotchas:**
- Opaque (no-cors) cross-origin responses hide their status, and Workbox's docs say Chrome counts each one as about 7 MB of quota. Request with `crossorigin="anonymous"` and CORS headers, and cache only status 200.
- Never cache per-user API responses under a shared cache name unless you delete them on logout.
- Content-addressed URLs (a hash in the path) suit CacheFirst with a long expiry. Don't runtime-cache what the precache already serves.
- Put a version in runtime cache names, because Workbox never deletes them for you ([cleanup](#cleanupoutdatedcaches-plus-your-own-runtime-cache-cleanup)).
- Cached audio or video needs `RangeRequestsPlugin`. Media elements (Safari especially) send Range requests, which a full cached 200 doesn't satisfy.

**Sources:** https://developer.chrome.com/docs/workbox/caching-strategies-overview · https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video

## Navigation preload (network-first navigations only)

Navigation preload starts the navigation request while the worker boots, then hands the response to the fetch handler as `event.preloadResponse`. That removes the worker's startup delay (tens to hundreds of ms on phones) from every network-bound page load, so a site with a worker isn't slower than one without.

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

**Support:** Chrome 59+, Firefox 99+, Safari 15.4+ / iOS 15.4+.

**Gotchas:**
- If navigations are served from a precached shell (a cache-first SPA), leave preload off, because it only wastes a request.
- The server receives `Service-Worker-Navigation-Preload: true`. `navigationPreload.setHeaderValue()` can send a state hint so the server returns a smaller payload.
- Once preload is enabled, always consume `preloadResponse`, or Chrome logs a cancelled-preload warning.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/NavigationPreloadManager · https://developer.chrome.com/docs/workbox/modules/workbox-navigation-preload

## Service Worker Static Routing API (bypass the worker for some requests)

During install, declare rules such as "these URLs go straight to the network" or "these come from cache". The browser then applies them without starting the worker. API calls, uploads and media streams skip worker startup and JS overhead, which matters most on cold launches on slow phones.

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

**Support:** Chrome/Edge 123+ (desktop and Android). Safari 27 on macOS and iOS (shipped Sept 2026). Not in Firefox. Engines without it ignore the rules, so always feature-detect.

**Gotchas:**
- Rules can be added only during install and are fixed for that worker version.
- Workbox precache entries for unhashed files carry a `__WB_REVISION__` query, so a `{ cacheName }` source won't match them. Use `network` rules for traffic the worker never handles.
- `urlPattern` must not contain regexp groups. Safari 27 enforces the spec's limits on rule count and nesting.
- TS libs don't type `addRoutes` yet, hence the guard.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes · https://developer.chrome.com/blog/service-worker-static-routing · https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

## Update flow: waiting worker, prompt, SKIP_WAITING message, reload once

Register with a prompt flow. When a new worker is waiting, show a persistent, non-modal "A new version is ready · Reload" toast. When the user accepts, save drafts, post `SKIP_WAITING` to the waiting worker, and reload once it takes control. Native apps update between launches and never pull the UI out from under you. Auto-update (skipWaiting plus clientsClaim) swaps code under a running page and can break it while someone is typing.

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

**Support:** Lifecycle events and `skipWaiting` work in every engine with service workers. `workbox-window` 7 provides `waiting`, `controlling` and `messageSkipWaiting()`. With Vite/React, vite-plugin-pwa's `registerSW({ onNeedRefresh })` or `useRegisterSW()` gives the same flow.

**Gotchas:**
- A waiting worker activates only once every client of the scope has closed. Installed apps sit in the app switcher for days, so without a prompt an update may not apply until the OS kills the app.
- Make the toast `role=status`, not a dialog, so it doesn't steal focus from a composer ([navigation-ui-patterns.md](navigation-ui-patterns.md#toasts-and-snackbars-top-layer-safe-areas-live-region-bounded-queue)). Reload only on an explicit click.
- `waiting` also fires on load when a worker was already waiting from an earlier tab (`event.wasWaitingBeforeRegister`).
- Guard the reload so DevTools "Update on reload" can't loop it.
- Other open tabs also get `controlling`. Have them show the prompt instead of reloading.

**Sources:** https://developer.chrome.com/docs/workbox/modules/workbox-window · https://vite-pwa-org.netlify.app/guide/prompt-for-update · https://web.dev/articles/service-worker-lifecycle

## Apply waiting updates silently when nobody can notice

Besides the prompt, apply the update at moments when nothing visible is lost:
- At boot, before first paint: a waiting worker means the user hasn't seen this page yet, so activate it and reload behind the splash.
- While the app is hidden and has no unsaved input.

This matches native "updated on next launch" behaviour. Most users never see a prompt and still stay current.

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

**Support:** Standard Service Worker API, so every engine. Access to `sessionStorage` can throw when storage is blocked, hence the `try`.

**Gotchas:**
- `skipWaiting` affects every tab of the scope. Other tabs must handle `controllerchange` by prompting, not by reloading.
- Reloading a hidden page is invisible only if route, scroll and drafts are restored exactly.
- iOS may suspend the page before the reload runs. That's harmless, because the new worker is active on the next launch.

**Sources:** https://web.dev/articles/service-worker-lifecycle · https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/controllerchange_event

## Check for updates during long-lived sessions

Call `registration.update()` when the app becomes visible (throttled) and on an interval. Otherwise browsers check `sw.js` only on navigations and on functional events such as push or sync (at most once per 24 h). An installed SPA may never navigate again, so users keep running a weeks-old build while the team believes a fix has shipped.

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

**Support:** `registration.update()`: Chrome 45+, Firefox 44+, Safari 11.1+. It returns a promise in all current engines.

**Gotchas:**
- `update()` rejects when offline or when the script fails to load, so always catch. vite-plugin-pwa's guide first fetches the worker URL with `cache: 'no-store'` and skips the update while the server is down.
- An update found here flows into the `waiting` prompt above, so don't reload from here.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update · https://vite-pwa-org.netlify.app/guide/periodic-sw-updates

## sw.js caching headers, a stable URL, scope, and a kill switch

Serve `sw.js` and `index.html` with `Cache-Control: no-cache` and hashed assets as immutable. Never rename or move the worker. Keep the manifest's `scope` and `start_url` inside the worker's scope. Keep a self-destroying worker ready for emergencies. A stuck old worker is the worst web failure, because users run broken code indefinitely. A correct scope means the installed app always launches controlled, which is what makes offline work.

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

**Support:** `updateViaCache`: Chrome 68+, Firefox 57+, Safari 11.1+. Its default, `imports`, already bypasses the HTTP cache for the main script, and browsers cap `sw.js` HTTP caching at 24 h anyway. `WindowClient.navigate` works in Safari only since 16 (before that it threw `NotSupportedError`).

**Gotchas:**
- Renaming `sw.js` strands users, because pages served from the old precache keep registering the old URL.
- Scope defaults to the script's directory. A wider scope needs the `Service-Worker-Allowed` response header.
- Static hosts that can't set headers (GitHub Pages sends `max-age=600` for everything) are fine for `sw.js` thanks to `updateViaCache`, and Workbox revisions cover `index.html`.
- If `start_url` or `scope` falls outside the worker scope, the installed app launches uncontrolled, with no offline support and no notification routing ([install-and-identity.md](install-and-identity.md#start_url-and-scope)).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register · https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache · https://web.dev/articles/service-worker-lifecycle

## cleanupOutdatedCaches plus your own runtime-cache cleanup

Call `cleanupOutdatedCaches()` to delete precaches left in older Workbox formats. Put a version in every runtime cache name and delete unknown caches in `activate`. Otherwise storage grows until the origin hits its quota and the browser evicts everything, which the user experiences as a fresh install with lost drafts.

```ts
// sw.ts
import { cleanupOutdatedCaches } from 'workbox-precaching';
cleanupOutdatedCaches();

const KEEP = new Set(['media-v2', 'api-v3', 'avatars-v1']);
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (!k.startsWith('workbox-precache') && !KEEP.has(k)) await caches.delete(k);
})()));
```

**Support:** Cache API: every engine with service workers.

**Gotchas:**
- `cleanupOutdatedCaches` removes only precaches in older Workbox formats (after a Workbox upgrade). Within one format, `precacheAndRoute`'s own activate step deletes entries that left the manifest. Neither touches runtime caches.
- Old chunks are deleted when the new worker activates. A tab still running the old build then can't lazy-load them offline, so reload it ([chunk errors](#recover-from-chunk-load-errors-after-a-deploy)).

**Sources:** https://developer.chrome.com/docs/workbox/modules/workbox-precaching

## Recover from chunk-load errors after a deploy

A lazily imported chunk from the previous build may already be deleted by the host or the new worker. Catch that failure, save state and reload once, instead of showing a broken route. A blank panel or a "Failed to fetch dynamically imported module" crash after every release is a classic web tell. Native apps never half-update.

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

**Support:** The import-failure messages are Chrome's, Firefox's and Safari's respectively. `vite:preloadError` is documented in Vite's build guide, and webpack throws `ChunkLoadError`. In React, the route's error boundary can offer "Reload" as the last resort.

**Gotchas:**
- Vite's docs say to serve the HTML with `Cache-Control: no-cache`, or the old asset references come back.
- Precache every lazy chunk (`globPatterns` includes `js`) so the running version stays self-consistent offline.
- Hosts that replace the whole site on deploy (GitHub Pages, many CDNs) remove old chunks at once.

**Sources:** https://vite.dev/guide/build#load-error-handling

## Take control on first install and announce 'Ready to work offline'

Call `clientsClaim()` so the very first visit is controlled without a reload, then tell the user once that the app works offline. Without it, the first session is uncontrolled: runtime caching misses everything, and "open once, then go offline" fails.

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
- Claiming on first install is safe because the whole precache is already in place. With the prompt flow, a new version activates only after the user agrees, and the page reloads then anyway.
- Show the offline notice at most once per device.
- Field-tested: without `clientsClaim`, E2E tests must reload once before going offline.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim · https://vite-pwa-org.netlify.app/guide/prompt-for-update

## Web Push subscription (VAPID, user gesture, userVisibleOnly)

From a click, request notification permission, then call `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` and store the subscription (endpoint and keys) with your push sender. Messages then reach the user while the app is closed. Without push, a web app can notify only while it's open, which is the biggest functional gap against native.

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

**Support:** Chrome/Edge 42+ (desktop and Android), Firefox 44+ (desktop and Android), Safari 16+ on macOS 13+. On iOS/iPadOS 16.4+, push works only inside a Home Screen web app whose manifest `display` isn't `browser`, never in a Safari tab. iOS 26 opens every Home Screen site as a web app by default, but keep `display: standalone`.

**Gotchas:**
- Call `requestPermission` and `subscribe` from the same click. Firefox 72+ (Android 79+) requires a gesture for `subscribe`, and Safari and Firefox require one for the permission.
- Encrypted payloads are limited to about 4 KB.
- The `Topic` header (up to 32 URL-safe characters) collapses pending pushes for one thread. `Urgency: high` suits chat.
- Push needs a sending server. Serverless and E2EE apps can get by with a tiny relay that holds the VAPID private key. RFC 8291 payload encryption needs only the subscription's `p256dh` and `auth`, so the sending client can encrypt and the relay adds only the VAPID `Authorization` header, never seeing plaintext.
- Allow `*.push.apple.com` outbound. Apple rejects a VAPID JWT whose `sub` isn't a valid `mailto:` or `https:` URL.
- Android 13+ also needs the OS-level notification permission for the browser.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe · https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ · https://www.rfc-editor.org/rfc/rfc8291

## Every push must show a notification (and set the badge)

In the `push` handler, validate the payload, then always await `showNotification` inside `event.waitUntil`, and update the app badge in the same step. Safari revokes subscriptions whose pushes don't show anything, and Chrome shows a generic "This site has been updated in the background" instead. Either way the illusion breaks and delivery silently stops.

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

**Support:** Push event: Chrome 40+, Firefox 44+, Safari 16 (macOS), iOS 16.4+ in Home Screen apps. Badging (in the worker too): Chrome desktop 81+ (ChromeOS 91), Safari 17 installed macOS apps, iOS 16.4+ Home Screen apps; not Chrome Android or Firefox. Full Badging API: [install-and-identity.md](install-and-identity.md#app-icon-badge-badging-api).

**Gotchas:**
- Without `waitUntil` the worker can stop before the notification shows, and that counts as a silent push.
- Chrome reportedly tolerates a missing notification while a tab of the origin is visible. Safari doesn't, so always show one.
- Silent "mark as read" pushes for cross-device sync don't work on Safari. Clear stale notifications on the next open instead ([close when read](#close-notifications-once-the-content-is-read-and-keep-the-badge-in-sync)).
- Firefox gives pushes that show no notification a quota, which resets when the user visits.
- Notification text appears on the lock screen. In E2EE apps, keep secrets out of it, or decrypt in the worker and show only what the user has opted into.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Push_API · https://webkit.org/blog/12945/meet-web-push/ · https://developer.mozilla.org/en-US/docs/Web/API/Navigator/setAppBadge

## Declarative Web Push (Safari 18.4+): notifications without waking a worker

The push payload is JSON the browser understands: `{ web_push: 8030, notification: { title, navigate, … } }`. The browser shows it and opens `navigate` on tap with no worker code. With `mutable: true`, the worker's `push` event receives `event.notification` and may replace it, for example after decrypting. On iOS this delivers more reliably (no worker to fail, no revocation penalty), uses less battery, and deep-links from a killed app.

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

**Support:** Safari iOS/iPadOS 18.4+ (Home Screen apps) and macOS Safari (18.4 per MDN BCD; WebKit's notes announce it for macOS in 18.5). It is in the W3C Push API editor's draft. `window.pushManager` (subscribe without a worker) and `PushEvent.notification`: Safari 18.4+ only. `Notification.navigate`: Safari 18.4+ and Firefox Nightly. Chrome hasn't implemented it.

**Gotchas:**
- `navigate` is required, and every action needs one too. Without `mutable`, Safari never fires `push`.
- `app_badge` sits at the top level in WebKit's implementation but isn't in the current spec draft (a spec PR to add it is open). Verify it on a device.
- Browsers without declarative push deliver the JSON to your worker, so keep the fallback branch.
- Reported in the field (unverified): when the iOS app is already running, tapping a declarative notification only foregrounds it, with no `notificationclick` and no navigation. Re-check notifications and route on `visibilitychange`.
- A subscription made through `window.pushManager` has no worker, so `mutable` can't take effect.

**Sources:** https://webkit.org/blog/16535/meet-declarative-web-push/ · https://w3c.github.io/push-api/ · https://developer.mozilla.org/en-US/docs/Web/API/Notification/navigate

## Show notifications through the worker registration, with a page fallback

Use `registration.showNotification()` whenever the registration supports it. Fall back to `new Notification()` only in desktop tabs before the worker is ready. Worker notifications are the only kind phones show, they outlive the page, and they route through `notificationclick`.

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

**Support:** The `Notification` constructor throws a TypeError on Chrome Android and Samsung Internet. On iOS 16.4+ the `Notification` interface exists only in Home Screen apps (a `ReferenceError` in tabs), and only worker notifications show there. Safari in an iOS tab registers a worker whose registration lacks `showNotification` and `getNotifications`.

**Gotchas:**
- Field-tested: calling `getNotifications()` in an iOS Safari tab crashed the "mark as read" path. Detect both methods, not just one.
- Check `typeof Notification` before reading `.permission`.
- Keep page notifications in a per-conversation map so you can close them. Hand off to the worker as soon as it registers.
- Don't notify for the conversation the user is looking at (visible and focused).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification · https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification

## Notification options: what each browser honours

Use `tag` and `data` everywhere, and add `icon`, `badge`, `image`, `actions`, `renotify`, `timestamp`, `requireInteraction` and `silent` progressively. One notification per thread, updated in place, with the right small icon reads as native. A stack of duplicates with a white square in the Android status bar doesn't.

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
| `tag` | Chrome and Firefox. Safari accepts it with no effect. |
| `icon` | Chrome and Firefox. Safari ignores it. |
| `badge`, `image`, `renotify`, `timestamp` | Chromium only |
| `actions` | Chromium 48+ and Firefox 152+. Not Safari. |
| `requireInteraction` | Chromium, and Firefox on Windows only |
| `silent` | Chrome 43+, Firefox 132+, Safari 16.6 on macOS. Not iOS. |

**Gotchas:**
- `renotify: true` with an empty `tag` throws a TypeError.
- Safari ignores `tag`, so its notifications stack. Close older ones yourself ([close when read](#close-notifications-once-the-content-is-read-and-keep-the-badge-in-sync)).
- Android draws `badge` from the alpha channel only, so an opaque full-colour icon becomes a white blob. Use a dedicated monochrome glyph.
- Actions need `notificationclick` to read `e.action`. Inline reply isn't available on the web.
- Collapse bursts into one notification per thread ("3 new messages").

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification · https://developer.mozilla.org/en-US/docs/Web/API/Notification/maxActions_static

## notificationclick: focus the open window and route in place, or open one

Close the notification and read the route from `notification.data`. Then focus an existing window and `postMessage` the route to it. Call `clients.openWindow(url)` only when no window exists. Tapping a notification then lands on the right conversation in the already-open app, with drafts and scroll intact, instead of a second tab or a reload at the home screen.

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

**Support:** `clients.openWindow` and `WindowClient.focus`: Chrome 40/42+, Firefox 44+, Safari 11.1+. `notificationclick`: Chrome, Firefox, Safari 16+ (macOS). MDN BCD lists it as unsupported on iOS. In practice it fires in Home Screen apps, but reports (WebKit bug 268797) say it's unreliable when the tap cold-launches the app.

**Gotchas:**
- `focus()` and `openWindow()` are allowed only during the click's activation window, so call them before any slow awaits.
- In Chrome, `openWindow` with an in-scope URL opens inside the installed app's window.
- `client.navigate()` reloads the page and loses state, so prefer `postMessage`. `matchAll` returns windows in most-recently-focused order.
- iOS fallback: use the declarative `navigate`. On `visibilitychange`, compare `getNotifications()` with what you showed before hiding; a notification that vanished was probably tapped. That last check is a heuristic.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event · https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow · https://bugs.webkit.org/show_bug.cgi?id=268797

## Close notifications once the content is read, and keep the badge in sync

When a conversation is opened or marked read, close its notifications by matching `notification.data` (not `tag`), then update or clear the app badge. Native apps clear notifications for things you've already read. Stale notifications plus a wrong count are a constant reminder that the app is a website.

```ts
export async function closeFor(url: string, unread: number): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg && typeof reg.getNotifications === 'function')
    for (const n of await reg.getNotifications()) if (urlOf(n.data) === url) n.close(); // data, because Safari ignores tag
  await (unread > 0 ? navigator.setAppBadge?.(unread) : navigator.clearAppBadge?.())?.catch(() => {}); // not installed: no icon
}
```

**Support:** `getNotifications`: Chrome 40+, Firefox 44+, Safari 16 (macOS 13+), and iOS 16.4+ in Home Screen apps only (absent in iOS tabs). `setAppBadge`/`clearAppBadge`: Chrome desktop 81+, Safari 17 (installed macOS apps), iOS 16.4+ (Home Screen apps). Not Chrome Android (it shows notification dots) or Firefox.

**Gotchas:**
- `getNotifications({ tag })` filters only where `tag` works, so match on `data`.
- On iOS the badge needs notification permission. A badge call from a non-installed page rejects; that's expected, not an error.
- Mark read only while the document is visible (and focused on desktop), never in a hidden tab.
- Fallback when not installed: badges in the title and favicon ([navigation-ui-patterns.md](navigation-ui-patterns.md#favicon-and-app-icon-badges-reflect-live-state)).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/getNotifications · https://developer.mozilla.org/en-US/docs/Web/API/Navigator/setAppBadge

## Notification permission UX: ask at the right moment, cover every state

Never prompt on load. Show an in-app explainer with an "Enable notifications" button that triggers the browser prompt. Render each state: unsupported (on iOS, "Add to Home Screen first"), default, denied (with how to unblock) and granted (with an in-app mute). Watch for changes. Native apps ask in context. A prompt on page load gets quieted by Chrome or denied for good.

```ts
const label = (s: NotificationPermission | PermissionState | 'unsupported', ios: boolean): string =>
  s === 'unsupported' ? (ios ? 'Add to Home Screen to get notifications' : 'Not supported in this browser')
  : s === 'denied' ? 'Blocked: allow notifications in site settings'
  : s === 'granted' ? 'Notifications on' : 'Enable notifications';

enableButton.addEventListener('click', async () => showPushState(await enablePush(vapidKey))); // the click reaches the prompt
const status = await navigator.permissions?.query({ name: 'notifications' }).catch(() => null);
status?.addEventListener('change', () => showPushState(status.state)); // revoked in OS or site settings
```

**Support:** `permissions.query`: Chrome 43+, Firefox 46+, Safari 16+. Safari and Firefox 72+ require a gesture for the prompt. Chrome shows a quieter prompt on sites users tend to block. Since late 2025, Chrome's Safety Check (desktop and Android) auto-revokes notification permission from sites with low engagement and high notification volume. Installed web apps are exempt.

**Gotchas:**
- Code can't re-prompt after `denied`.
- Keep an app-level mute separate from the browser permission, so a user who wants quiet doesn't have to revoke it.
- The `push` permission name isn't supported everywhere, so wrap queries in try/catch.
- On iOS, show the button only in standalone mode ([install-and-identity.md](install-and-identity.md#detect-the-installed-app)). General permission rules: [device-apis.md](device-apis.md#permission-ux-ask-in-context-after-explaining-never-on-load-plus-the-new-capability-elements).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static · https://web.dev/articles/push-notifications-permissions-ux · https://blog.google/chromium/automatic-notification-permission/

## Keep push subscriptions alive

On every launch and on becoming visible, compare `pushManager.getSubscription()` with what the server holds:
- Resubscribe when permission is granted but the subscription is gone.
- Handle `pushsubscriptionchange` where it exists.
- On the server, delete subscriptions the push service answers with 404 or 410.

Subscriptions vanish (on iOS especially). Without this upkeep the app silently stops notifying, and users conclude it's broken.

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

**Support:** `pushsubscriptionchange`: Chrome 138+, Firefox 44+ (without `oldSubscription`/`newSubscription`), Safari 16 on macOS. Not iOS. `PushSubscription.expirationTime` exists but is usually null.

**Gotchas:**
- Resubscribing in the worker needs the `applicationServerKey`, from `e.oldSubscription?.options` or stored in IndexedDB.
- On iOS the Home Screen app and Safari tabs hold separate subscriptions. Store sender-side subscriptions per device.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event · https://developer.mozilla.org/en-US/docs/Web/API/PushManager/getSubscription

## Outbox plus Background Sync, with a fallback that works everywhere

Write every outgoing action to an IndexedDB outbox first, and show it as pending right away. Where Background Sync exists, register a sync so the worker flushes the outbox once connectivity returns, even after the tab has closed. Everywhere else, flush on `online`, on becoming visible and at launch. Sending then works in a tunnel, the way native messaging apps do, with no error toast and no lost message. Pending-state UI: [motion-performance.md](motion-performance.md#optimistic-ui-apply-the-result-immediately-reconcile-later-and-use-undo-instead-of-confirmation).

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

**Support:** Background Sync: Chromium only (Chrome/Edge 49+, Samsung Internet). Not Firefox or Safari. Where sync is missing, Workbox's `Queue`/`BackgroundSyncPlugin` replays at worker startup.

**Gotchas:**
- Chrome retries a failed sync (a rejected `waitUntil`) only a few times with backoff, so the outbox must outlive the sync giving up.
- Use idempotent IDs so retries don't duplicate.
- Take a Web Lock so the page and the worker don't flush at the same time.
- Socket protocols (WebSocket and similar): the worker can open a socket inside `waitUntil`, but events are capped at about 5 minutes. Flushing on reconnect is usually simpler.
- Show the queued count in the UI ("Offline · 2 messages queued").

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API · https://developer.chrome.com/docs/workbox/modules/workbox-background-sync

## Periodic Background Sync (Chromium, installed apps only)

Ask the browser to wake the worker roughly every N hours on a good network to prefetch content. The app then opens to fresh content (a feed or digest) with no spinner, like a native app's background refresh.

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

**Support:** Chrome/Edge 80+ (desktop and Android) only. Chrome grants it only to an installed app launched as an app. How often it fires depends on site engagement, with a minimum of about 12 h. Not in Firefox or Safari.

**Gotchas:**
- It isn't for real-time messaging, and timing isn't guaranteed. Events don't fire at zero engagement.
- Test it with DevTools > Application > Periodic background sync.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API · https://developer.chrome.com/docs/capabilities/periodic-background-sync

## Background Fetch for large downloads and uploads (Chromium)

Hand big transfers to the browser so they continue after the page or app closes, with system download UI and a worker event on completion. That matches native "download for offline": closing the app doesn't kill the transfer.

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

**Support:** Chrome/Edge 74+ (desktop and Android) only. Not in Firefox or Safari.

**Gotchas:**
- If `downloadTotal` is set and the download exceeds it, the fetch fails.
- The user can cancel from the browser UI (`backgroundfetchabort`).
- Every other browser needs the fallback path.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Background_Fetch_API

## Request persistent storage and show usage

Call `navigator.storage.persist()` once the user has data worth keeping, and read `navigator.storage.estimate()` to show usage in Settings. Native apps don't lose your data when the disk fills up. Persistent origins are exempt from storage-pressure eviction, and WebKit says they are exempt from eviction in Safari 17+ too.

```ts
export async function protectData(): Promise<'persisted' | 'best-effort' | 'unsupported'> {
  if (typeof navigator.storage?.persist !== 'function') return 'unsupported';
  if (await navigator.storage.persisted()) return 'persisted';
  return (await navigator.storage.persist()) ? 'persisted' : 'best-effort';
}
const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {};
const storageLine = `${(usage / 1e6).toFixed(1)} MB used of ${(quota / 1e9).toFixed(0)} GB`;
```

**Support:** `persist`/`persisted`: Chrome 55+, Firefox 57+, Safari 15.2+. `estimate`: Chrome 61+, Firefox 57+, Safari 17+. Firefox shows a prompt. Chrome, Edge and Safari decide silently from engagement (Safari, for example, when the site is opened as a Home Screen web app).

**Gotchas:**
- Firefox prompts, so call `persist()` from a click (Settings > "Keep data on this device") or right after a meaningful action, never on load.
- Per-origin quotas (MDN):

  | Browser | Quota |
  |---|---|
  | Chromium | 60% of disk |
  | Firefox, best-effort | The smaller of 10% of disk and a 10 GiB group limit |
  | Firefox, persistent | 50% of disk, up to 8 TiB |
  | Safari 17+ | About 60% for browser apps and Home Screen/Dock web apps, about 15% for other WKWebView apps |

  The old "50 MB on Safari" advice is obsolete.
- `estimate()` values are approximate and padded.
- Users can still clear data, so keep a backup or export.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria · https://webkit.org/blog/14403/updates-to-storage-policy/ · https://web.dev/articles/persistent-storage

## Survive Safari's 7-day eviction of script-written storage

With tracking prevention on (the default), Safari deletes all script-written data of an origin if the user hasn't interacted with it during the last 7 days of Safari use. That includes IndexedDB, localStorage, Cache API and the service worker registration. Server-set cookies are exempt. Home Screen web apps keep their own day counter, so normal use of the app doesn't trigger it. A user who returns after a holiday to a blank, logged-out app with drafts gone won't trust it again.

```ts
if (!isStandalone() && isAppleWebKit()) offerInstall('Add to Home Screen so your data stays on this device');
await protectData(); // persist(): Safari 17+ exempts persistent-mode origins from eviction
await syncBackup();  // a server or relay copy, or an export file the user keeps
// E2EE identity keys: show the recovery phrase or export during onboarding, not later
```

**Support:** Safari on macOS and iOS/iPadOS, plus every iOS browser that uses WebKit. In the EU (iOS 17.4+), browsers with their own engine follow their own policies.

**Gotchas:**
- Never treat browser storage as the only copy of irreplaceable data, especially private keys. An app whose identity lives only in IndexedDB loses the account on eviction.
- The 7 days count days of Safari use, not calendar days, so eviction is unpredictable in practice. You can't fast-forward it in a test, so test that a restore path exists.
- Whether persistent mode also stops the 7-day deletion (rather than only pressure eviction) is stated only loosely by WebKit. Keep the backup either way.

**Sources:** https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ · https://webkit.org/blog/14403/updates-to-storage-policy/ · https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria

## iOS Home Screen apps have their own storage: onboard inside the app

A web app on the iOS Home Screen has its own cookie jar, localStorage, IndexedDB and push subscription, separate from Safari tabs. Signing in or creating data in Safari doesn't carry over after Add to Home Screen. Users install, tap the icon and land on a logged-out landing page, which feels broken. Detect the first standalone launch and offer restore or transfer.

```ts
// First launch as the installed app with no local identity: go to restore, not marketing
if (isStandalone() && !(await kv.get('identity'))) router.replace('/welcome-back');
// Offer: passkey sign-in (shared through iCloud Keychain), a one-time code or QR shown in the Safari tab,
// or a recovery phrase / invite link pasted into the app. Avoid magic links: a tapped link opens Safari, not the app.
```

**Support:** iOS/iPadOS Home Screen web apps (every version with standalone apps). iOS 26 opens any site added to the Home Screen as a web app by default, so more users hit this. macOS Safari 17+ Dock web apps also get separate storage (Safari copies the cookies once, at creation). Chrome and Edge installed apps share the profile's storage with tabs. Firefox Taskbar Tabs share the profile.

**Gotchas:**
- Deleting the icon deletes its data.
- Old reports that Cache Storage or the worker registration are shared with Safari aren't reliable, so assume nothing is shared.
- Say so before the user installs ("you'll sign in once more inside the app"). Install flow and detection: [install-and-identity.md](install-and-identity.md#install-promotion-ux).

**Sources:** https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ · https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios · https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing

## IndexedDB done right: validated reads, durable writes, reconnects

Keep app state in IndexedDB behind a small wrapper:
- Validate everything you read.
- Use `durability: 'strict'` for writes you can't lose.
- Close the connection on `versionchange`.
- Reopen after Safari drops the connection.

Corrupt or old-format data must never crash the launch, and the user should never have to clear site data. Losing the connection in the background must not break the app on resume.

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

**Support:** IndexedDB: all engines. Transaction `durability`: Chrome 83+, Firefox 126+, Safari 15+. `commit()`: Chrome 76+, Firefox 74+, Safari 15+. idb-keyval 6.

**Gotchas:**
- iOS 17.4+ reports `UnknownError: Connection to Indexed Database server lost` after backgrounding (WebKit bug 273827, Dexie issue 2008). Reopen; if it keeps failing, keep data in memory and reload.
- Default durability differs per browser.
- `localStorage` is synchronous and about 5 MB, so keep it for tiny boot hints. Wrap every storage access in try/catch for private modes and blocked storage.
- An unhandled `versionchange` blocks upgrades in other tabs.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction · https://bugs.webkit.org/show_bug.cgi?id=273827 · https://github.com/dexie/Dexie.js/issues/2008

## Origin Private File System (OPFS) for large or binary data and SQLite

OPFS is a private, origin-scoped file system. Synchronous access handles in a dedicated worker give fast byte-level I/O, which is what SQLite-WASM and large media caches need. Local-first apps can then hold big databases or attachments and query them at native speed, without slow IndexedDB blob juggling.

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

**Support:** `getDirectory`: Chrome 86+ (Android 109+), Firefox 111+, Safari 15.2+. `createSyncAccessHandle`: the same versions, dedicated workers only. `createWritable`: Chrome 86+, Firefox 111+, Safari 26+.

**Gotchas:**
- OPFS follows the same quota and eviction rules as other site storage, including Safari's 7-day rule.
- A sync access handle locks the file exclusively, so coordinate tabs with Web Locks.
- Files aren't visible to the user. For a real export, use the File System Access API or a download ([device-apis.md](device-apis.md#file-system-access-showopenfilepicker--showsavefilepicker-with-fallbacks-opfs)).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system

## Storage Buckets: separate eviction policies per kind of data (Chromium)

Open named buckets, each with its own IndexedDB, Cache Storage and OPFS and its own persistence, durability and expiry. Drafts can be persisted and strict while a media cache stays best-effort and expires. Under storage pressure the browser then evicts the media cache, not the user's unsent messages.

```ts
type Bucket = { indexedDB: IDBFactory; caches: CacheStorage; getDirectory(): Promise<FileSystemDirectoryHandle> };
type Buckets = { open(name: string, o?: { persisted?: boolean; durability?: 'strict' | 'relaxed'; expires?: number }): Promise<Bucket> };
const nav: Navigator & { storageBuckets?: Buckets } = navigator;
const draftsDb = nav.storageBuckets ? (await nav.storageBuckets.open('drafts', { persisted: true, durability: 'strict' })).indexedDB : indexedDB;
const mediaCache = nav.storageBuckets ? (await nav.storageBuckets.open('media', { durability: 'relaxed', expires: Date.now() + 30 * 864e5 })).caches : caches;
```

**Support:** Chrome/Edge 122+ only. Not in Firefox or Safari (MDN marks it experimental).

**Gotchas:**
- `persisted: true` can be refused, just like `persist()`.
- Keep one code path that falls back to the default bucket elsewhere.

**Sources:** https://developer.chrome.com/docs/web-platform/storage-buckets

## Multi-tab coordination: Web Locks plus BroadcastChannel

A Web Lock makes one tab the owner of the long-lived connections and the outbox flush. A BroadcastChannel spreads state changes (logout, read marks, new version) to every tab and window. Without them you get two tabs sending the same message, duplicate notifications and sounds, and a tab still logged in after logout elsewhere. A native app has one process and none of these problems.

```ts
// Leader election: the callback's promise never settles, so this tab holds the lock until it closes
void navigator.locks.request('leader', () => new Promise<never>(() => startConnections()));
// Exclusive sections shared by tabs and the worker
await navigator.locks.request('outbox', () => flushOutbox());

const bus = new BroadcastChannel('app'); // never delivers to the sender: the leader applies its own events
bus.onmessage = (e: MessageEvent<unknown>) => { if (parseBusMessage(e.data)?.type === 'logout') location.reload(); };
bus.postMessage({ type: 'logout', v: 1 }); // versioned: another tab may run another build
```

**Support:** Web Locks: Chrome 69+, Firefox 96+, Safari 15.4+. BroadcastChannel: Chrome 54+, Firefox 38+, Safari 15.4+. Both also work in workers.

**Gotchas:**
- On mobile a hidden leader tab is suspended. A newly visible tab can take over with `{ steal: true }` when the leader's heartbeat is stale.
- `{ ifAvailable: true }` is a try-lock. Pass a `signal` to give up a held lock.
- Locks are per origin and storage partition. A Chromium installed-app window and a tab of the same origin share them; an iOS Home Screen app doesn't share them with Safari.
- Validate bus messages.
- Release or reacquire locks around bfcache (`pagehide`/`pageshow`). Whether held locks block the bfcache varies by engine (unverified).
- Presence from visibility plus focus, and multi-window UX: [navigation-ui-patterns.md](navigation-ui-patterns.md#multiple-windows-and-tabs-one-leader-shared-state-and-which-window-is-active).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API · https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel

## Online/offline detection beyond navigator.onLine

`navigator.onLine === false` means definitely offline. `true` means only maybe online. Derive a three-state status (offline, reconnecting, online) from the browser flag plus your transport's real state, and retry with backoff and jitter. A calm banner ("Offline · 2 messages queued", "Reconnecting…") that clears itself feels native. Spinners that hang or "Network error" alerts don't.

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

**Support:** `online`/`offline` events and `navigator.onLine`: all engines (MDN notes older Chrome on Linux always reported true). `AbortSignal.timeout`: Chrome 103+, Firefox 100+, Safari 16+.

**Gotchas:**
- `onLine` is true behind captive portals, on a LAN with no uplink, or with a dead VPN.
- A page fetch still goes through the service worker even with `cache: 'no-store'`. Exclude the probe route from worker routes, or give it a static `network` route.
- Debounce the banner (about 2 s) so short blips don't flash it.
- Save-Data and connection-quality hints: [device-apis.md](device-apis.md#network-status-onlineoffline-events-network-information-chromium-battery-status-dont).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine · https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static

## Page Lifecycle: save on 'hidden', not on unload

Persist drafts and UI state continuously (debounced on input) and flush when `visibilityState` becomes `hidden`. That's the last event you can count on before a phone OS suspends or kills a backgrounded app. Add `pagehide`, plus `freeze` and `wasDiscarded` on Chromium. Saving on hide is what makes "switched apps, came back, everything's still there" work.

```ts
const flush = (): void => { void saveDrafts(); saveUiState(); }; // start the IndexedDB writes synchronously
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush); // Safari/iOS, and bfcache entry
document.addEventListener('freeze', flush); // Chromium only
const doc: Document & { wasDiscarded?: boolean } = document;
if (doc.wasDiscarded) restoreUiState(); // Chromium: the tab was discarded while hidden
```

**Support:** `visibilitychange` and `pagehide`: all engines (Safari 14.1+ fires `visibilitychange` reliably on app switch). `freeze`, `resume` and `document.wasDiscarded`: Chrome 68+ only. `beforeunload` doesn't fire on iOS Safari. Chrome no longer runs `unload` handlers by default: the rollout reached 100% of page loads in Chrome 154 (Sept 2026).

**Gotchas:**
- The hidden handler gets very little time on iOS. Start the IndexedDB writes synchronously and don't await network calls ([fetchLater](#last-chance-network-sends-fetchlater-and-sendbeacon) for server state).
- Attach `beforeunload` only while unsaved changes exist, and remove it afterwards.
- Timers are throttled or frozen in the background, so recompute from `Date.now()` on return.
- A desktop window behind other windows still reports `visible`; check `document.hasFocus()` too.
- Headless test browsers always report visible. Unit-test the decision ("should this save?") and keep the event wiring to a line or two.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API · https://developer.chrome.com/docs/web-platform/page-lifecycle-api · https://developer.chrome.com/docs/web-platform/deprecating-unload

## Restore route, scroll position and drafts on relaunch

Store the last route, a scroll anchor (the ID of the top visible item, not pixels) and per-conversation drafts. On a cold standalone launch at `start_url`, go back to the saved route before first paint, then restore the anchor and the draft. Native apps resume where you left off, and iOS evicts background web apps often. Landing on the home screen with your half-typed message gone is a web tell.

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

**Support:** Standard APIs. `history.scrollRestoration` works in all engines.

**Gotchas:**
- An explicit deep link (notification tap, share target, invite link) beats the restore. Restore only when the app was launched bare at `start_url`.
- `sessionStorage` dies with a killed app, so use `localStorage` or IndexedDB. Read the boot hint from `localStorage` synchronously; an async read would flash the home screen first.
- Expire old snapshots, and validate them like any external input.
- Don't resume into a confirm, payment or expired-auth screen.
- Scroll into the anchor only after the content has its final height. Chat views restore the distance from the bottom instead.
- Per-screen scroll on Back within a session: [navigation-ui-patterns.md](navigation-ui-patterns.md#preserve-state-scroll-per-screen-and-resume-the-last-screen-on-relaunch).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/History/scrollRestoration · https://developer.chrome.com/docs/web-platform/page-lifecycle-api

## Resume from background: reconnect, resync, refresh

When the app becomes visible, or is restored from bfcache, assume sockets died and timers were frozen:
- Ping or reconnect.
- Fetch everything since the last cursor.
- Check for an update.
- Refresh the badge.
- Mark the visible conversation read.

Content is then current the moment the app reappears, with no stale "online" dots and no messages that appear only after a manual refresh.

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

**Support:** All engines. Chrome throttles chained timers in pages hidden for more than 5 minutes to about once a minute. iOS suspends hidden web apps within seconds and gives them no background execution except the push handler.

**Gotchas:**
- A WebSocket killed during suspension may never fire `close` and may still report `OPEN`. Rely on an application-level ping with a timeout.
- Publish presence "away" on hidden and "online" on visible. Mark read only while visible.
- Missed-message alerts while suspended can only come from push.
- Platform summary: [platform-quirks-testing.md](platform-quirks-testing.md#background-suspension-reconnect-and-catch-up-on-resume).

**Sources:** https://developer.chrome.com/blog/timer-throttling-in-chrome-88 · https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event

## Back/forward cache eligibility

Keep pages bfcache-eligible:
- No `unload` listeners.
- No `Cache-Control: no-store` on app HTML where you can avoid it.
- Close sockets on `pagehide` and reopen them on `pageshow` when `persisted`.
- Check `notRestoredReasons` in the field.

Back and forward then restore instantly with state intact, like native navigation, instead of a full reload. That matters for tab users, for multi-page entry points, and for OAuth or payment round-trips.

```ts
window.addEventListener('pagehide', (e) => { if (e.persisted) socket.close(1000, 'bfcache'); });
// pageshow with e.persisted → the resume handler above reconnects and resyncs
const nav = performance.getEntriesByType('navigation')[0];
if (nav && 'notRestoredReasons' in nav && nav.notRestoredReasons) report('bfcache-miss', nav.notRestoredReasons); // Chrome 125+
```

**Support:** All engines have a bfcache. Since a 2025 rollout, Chrome admits `no-store` pages but evicts them on cookie changes and after about 3 minutes. Chrome 149 closes open WebSockets on entry instead of refusing the page (field reports say this is still rolling out). Safari has always closed them, and Firefox still refuses pages with open sockets. `notRestoredReasons`: Chrome 125+.

**Gotchas:**
- Third-party scripts often add `unload` handlers. Audit them in DevTools > Application > Back/forward cache.
- Open WebRTC connections, IndexedDB connections that block a `versionchange`, and `window.opener` references can block or evict, depending on the engine.
- After a restore, socket `close` events fire, so make sure your reconnect logic can't double-connect.
- An installed SPA is one document, so this mostly matters for its entry points and external round-trips.

**Sources:** https://web.dev/articles/bfcache · https://developer.chrome.com/docs/web-platform/bfcache-ccns · https://developer.mozilla.org/en-US/docs/Web/API/PerformanceNavigationTiming/notRestoredReasons

## Last-chance network sends: fetchLater and sendBeacon

For server-backed state such as analytics, read position or "last seen", queue a request that the browser delivers even if the page is killed: `fetchLater` on Chromium, or `sendBeacon` from the hidden handler. The server gets the state even when the OS kills the app, and the app isn't blocked from closing.

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

**Support:** `fetchLater`: Chrome/Edge 135+ only (MDN marks it experimental). `sendBeacon`: Chrome 39+, Firefox 31+, Safari 11.1+.

**Gotchas:**
- `sendBeacon` is POST only and has a small in-flight budget (about 64 KB).
- Since Chrome 59, a cross-origin Blob must have a CORS-safelisted type (`text/plain`).
- Local-first apps with no server should flush to IndexedDB instead ([Page Lifecycle](#page-lifecycle-save-on-hidden-not-on-unload)).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater · https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon

## Content Index API: list offline content in the OS (Chrome Android)

Register pages or articles that are cached for offline use, and Chrome Android shows them in its offline content surface. Offline content becomes discoverable outside the app, the way a native app's downloads are.

```ts
type IndexReg = ServiceWorkerRegistration & {
  index: { add(d: { id: string; url: string; title: string; description: string; category?: string }): Promise<void>; delete(id: string): Promise<void> };
};
const hasIndex = (r: ServiceWorkerRegistration): r is IndexReg => 'index' in r;
const reg = await navigator.serviceWorker.ready;
if (hasIndex(reg)) await reg.index.add({ id: 'post-42', url: '/posts/42', title, description, category: 'article' });
// sw.ts: on 'contentdelete' (removed in Chrome's UI), delete that entry from your cache
```

**Support:** Chrome Android 84+ only (MDN marks it experimental).

**Gotchas:**
- Register only URLs that really work offline, and remove entries when you evict their cache.
- Treat it as a minor nicety, not core UX.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Content_Index_API

## No state in service-worker globals; always waitUntil

The browser stops an idle worker after about 30 s (Chrome), caps each event at about 5 minutes, and may kill it sooner on iOS. Keep every bit of state in IndexedDB or the Cache API, and pass every async job to `event.waitUntil()`. Unread counts, badges and notification grouping then stay correct across worker restarts. Otherwise badges reset and notifications silently never show.

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

**Support:** All engines. The timeouts are implementation details (Chrome: about 30 s idle, about 5 min per event), not guarantees.

**Gotchas:**
- No `setTimeout`-based work in the worker.
- The worker has no DOM and no `localStorage`; it has only IndexedDB, the Cache API and `postMessage`.
- Workbox modules are safe, because they hold no cross-event state.

**Sources:** https://developer.chrome.com/blog/longer-esw-lifetimes · https://developer.mozilla.org/en-US/docs/Web/API/ExtendableEvent/waitUntil

## Test the worker: pure decision module plus e2e against the production build

Keep every worker decision in a pure, unit-tested module: message parsing, notification data, URL building, capability detection (see [sw-logic.ts](../templates/sw-logic.ts)). `sw.ts` and the page glue only wire events. Test that wiring end to end against the built app, where the worker actually exists. Worker bugs show up only in production builds and on phones. That's how a missing `getNotifications` became a crash on iOS. The E2E setup (build, preview, reload-for-control, offline start, notification permission) is in [platform-quirks-testing.md](platform-quirks-testing.md#e2e-against-the-production-build-manifest-icons-service-worker-offline-notifications-a11y).

```ts
// Playwright: simulate an iOS Safari tab, whose registration can't notify
await page.addInitScript(() => {
  Reflect.deleteProperty(ServiceWorkerRegistration.prototype, 'getNotifications');
  Reflect.deleteProperty(ServiceWorkerRegistration.prototype, 'showNotification');
});
```

**Support:** Playwright with Chromium supports service workers, `setOffline` and notification permission grants. iOS-only behaviour (push, storage isolation, 7-day eviction, killed-app relaunch) needs a manual device check ([platform-quirks-testing.md](platform-quirks-testing.md#ios-simulator-safari-web-inspector-and-a-real-device-checklist)).

**Gotchas:**
- Dev servers have no worker (vite-plugin-pwa `devOptions` behave differently).
- DevTools "Update on reload" changes the lifecycle, so turn it off when testing the prompt flow.
- To simulate a push, use DevTools > Application > Service workers > Push. Background services records sync, fetch, push and notification events.
- A fresh browser context means a fresh worker, so each test starts clean.

**Sources:** https://playwright.dev/docs/service-workers · https://developer.chrome.com/docs/devtools/application/background-services

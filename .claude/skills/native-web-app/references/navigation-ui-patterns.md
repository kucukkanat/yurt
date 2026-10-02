<!-- verified 2026-10-02: 11 corrections -->
# Navigation model and native UI patterns

How an app-like page moves between screens and which native controls and conventions it uses: back stacks, overlays and close requests, routing, deep links, windows, adaptive navigation, theming, dialogs, menus, pickers, toasts, focus and accessibility parity.
Support as of Oct 2026 (MDN browser-compat-data 8.1.4: Chrome 154, Safari 27, Firefox 157). TS snippets target `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; undeclared helpers (`render`, `routeTo`…) are yours.

## Checklist

- [ ] **must** — Close the topmost overlay on Back/Esc with dialog, popover or CloseWatcher → [Back closes the topmost overlay first](#back-closes-the-topmost-overlay-first-closewatcher-dialog-and-popover)
- [ ] **must** — Give each open overlay one history entry where CloseWatcher is missing; never push after a back → [History-entry fallback for overlays](#history-entry-fallback-for-overlays-one-entry-per-open-overlay)
- [ ] **must** — Push only new screens; replace refinements; keep transient UI out of history → [Classify every UI state](#classify-every-ui-state-push-replace-or-no-history)
- [ ] **must** — Encode full screen state in the URL and parse it without throwing → [Deep links restore the full screen state; parsers never throw](#deep-links-restore-the-full-screen-state-parsers-never-throw)
- [ ] **must** — Ship an in-app back control that goes Up when deep-linked → [Up vs Back](#up-vs-back-an-in-app-back-button-that-never-exits-the-app)
- [ ] **must** — Make full-screen panels history entries; skip your animation when the UA animated → [iOS edge-swipe back, swipe-to-close and no double animations](#ios-edge-swipe-back-swipe-to-close-and-no-double-animations)
- [ ] **must** — Open external and off-scope links in a new context, never in the app window → [External links and app scope](#external-links-and-app-scope-leave-the-app-deliberately)
- [ ] **must** — Bottom tabs on phones, rail or sidebar when wider, chosen by width → [Adaptive navigation](#adaptive-navigation-bottom-tabs-on-phones-rail-or-sidebar-when-wider)
- [ ] **must** — Use the system font stack for UI text → [System font stack and platform type conventions](#system-font-stack-and-platform-type-conventions)
- [ ] **must** — Declare color-scheme, theme tokens with light-dark(), and accent-color → [color-scheme, light-dark() and accent-color](#color-scheme-light-dark-and-accent-color)
- [ ] **must** — Follow the system theme, allow an override, sync theme-color, no flash → [Dark mode](#dark-mode-follow-the-system-allow-an-override-sync-theme-color-no-flash)
- [ ] **must** — Build modals on dialog.showModal() with requestClose and light dismiss → [Modals with dialog](#modals-with-dialog-showmodal-requestclose-closedby-invoker-commands)
- [ ] **must** — Inert closed drawers and the page behind custom overlays → [inert for off-canvas drawers and backgrounds](#inert-for-off-canvas-drawers-and-backgrounds)
- [ ] **must** — Design empty, loading, error and offline states for every screen → [Designed empty, loading, error and offline states on every screen](#designed-empty-loading-error-and-offline-states-on-every-screen)
- [ ] **must** — Move focus and update title on navigation; return focus on Back → [Focus management and accessibility parity on navigation](#focus-management-and-accessibility-parity-on-navigation)
- [ ] **must** — Disable selection and callouts on chrome, keep them in content → [Text selection off on app chrome, on in content](#text-selection-off-on-app-chrome-on-in-content)
- [ ] **should** — Route through the Navigation API with a History API fallback → [Navigation API as the router core, with a History API fallback](#navigation-api-as-the-router-core-with-a-history-api-fallback)
- [ ] **should** — Pick hash or path routing that survives your host and offline → [Hash vs path routing on static hosts](#hash-vs-path-routing-on-static-hosts)
- [ ] **should** — Restore scroll per screen and resume the last route on relaunch → [Preserve scroll per screen and resume the last screen on relaunch](#preserve-scroll-per-screen-and-resume-the-last-screen-on-relaunch)
- [ ] **should** — Reuse the app window with launch_handler, launchQueue and notificationclick → [Single-window launches](#single-window-launches-launch_handler-launchqueue-and-link-capturing)
- [ ] **should** — Put the screen and unread count in document.title → [Window and tab title carry context and unread count](#window-and-tab-title-carry-context-and-unread-count)
- [ ] **should** — Badge the favicon and app icon with live state → [Favicon and app-icon badges reflect live state](#favicon-and-app-icon-badges-reflect-live-state)
- [ ] **should** — Follow tab bar conventions: re-tap scrolls to top, then pops to root → [Tab bar conventions and the thumb zone](#tab-bar-conventions-and-the-thumb-zone)
- [ ] **should** — Use sticky translucent headers with collapsing large titles → [Large titles and sticky translucent headers](#large-titles-and-sticky-translucent-headers)
- [ ] **should** — Size text in rem and opt into Dynamic Type and OS text scale → [Respect the user's text size](#respect-the-users-text-size-rem-ios-dynamic-type-chromium-text-scale)
- [ ] **should** — Anchor menus with Popover API and CSS anchor positioning → [Menus and popovers](#menus-and-popovers-popover-api-plus-css-anchor-positioning)
- [ ] **should** — Use bottom sheets on touch and anchored menus on desktop → [Action sheets and bottom sheets on touch, anchored menus on desktop](#action-sheets-and-bottom-sheets-on-touch-anchored-menus-on-desktop)
- [ ] **should** — Use native date/time inputs, showPicker() and the real select → [Native pickers](#native-pickers-datetime-inputs-showpicker-and-customizable-select)
- [ ] **should** — Build switches and segmented controls from real inputs → [Switches and segmented controls from real inputs](#switches-and-segmented-controls-from-real-inputs)
- [ ] **should** — Show toasts in a top-layer popover with a separate live region → [Toasts and snackbars](#toasts-and-snackbars-top-layer-safe-areas-live-region-bounded-queue)
- [ ] **should** — Refresh live data on return; offer pull-to-refresh only for on-demand data → [Pull-to-refresh and live data](#pull-to-refresh-and-live-data)
- [ ] **should** — Keep state visible in forced-colors and prefers-contrast → [forced-colors and prefers-contrast](#forced-colors-and-prefers-contrast)
- [ ] **should** — Mirror layout, icons and gestures in RTL → [RTL](#rtl-logical-properties-dirauto-mirrored-gestures-and-icons)
- [ ] **should** — Add platform-correct shortcuts and a command palette on desktop → [Keyboard shortcuts and a command palette on desktop](#keyboard-shortcuts-and-a-command-palette-on-desktop)
- [ ] **should** — Add context menus on app objects, not on content → [Context menus](#context-menus-right-click-keyboard-and-long-press-not-on-content)
- [ ] **should** — Gate hover styles and tooltips behind hover-capable pointers → [Hover effects and tooltips only on hover-capable pointers](#hover-effects-and-tooltips-only-on-hover-capable-pointers)
- [ ] **should** — Adapt UI to display-mode (installed vs tab) → [Adapt to display-mode](#adapt-to-display-mode-installed-vs-browser-tab)
- [ ] **nice** — Coordinate multiple windows with Web Locks and BroadcastChannel → [Multiple windows and tabs](#multiple-windows-and-tabs-one-leader-shared-state-active-window)
- [ ] **nice** — Draw your own title bar with Window Controls Overlay → [Window Controls Overlay](#window-controls-overlay-your-own-title-bar-on-desktop-installs)
- [ ] **nice** — Use details name accordions and hidden=until-found → [Native disclosure](#native-disclosure-details-name-details-content-hiddenuntil-found)

## Back closes the topmost overlay first: CloseWatcher, dialog and popover

A "close request" is Esc on desktop or the Android back gesture/button. Modal `<dialog>`, `popover="auto"` and `CloseWatcher` instances form one stack, and a close request closes the top item before history goes back. Pressing Back with a menu open and leaving the screen (or the app) is the biggest Android web tell; this removes it for drawers, sheets, panels and lightboxes too.

```ts
// Platform overlays need no code: showModal() dialogs and [popover] (auto) already answer Esc and Android Back.
// For custom overlays (drop this declaration if your lib.dom already ships CloseWatcher):
interface CloseWatcherLike extends EventTarget { destroy(): void; requestClose(): void; close(): void }
declare const CloseWatcher: (new (opts?: { signal?: AbortSignal }) => CloseWatcherLike) | undefined;

/** Registers `close` for the next close request; returns the cleanup to run when the overlay closes another way. */
export function onCloseRequest(close: () => void): () => void {
  if (typeof CloseWatcher === 'function') {
    const w = new CloseWatcher();
    w.addEventListener('close', close, { once: true });
    return () => w.destroy();
  }
  return pushOverlayEntry(close); // history fallback, next section
}

// Call inside the click handler that opens the drawer (user activation matters):
// const release = onCloseRequest(() => setDrawer(false));
// ...and when the drawer closes via its own X button or the scrim: release();
```

**Support:** `CloseWatcher`: Chromium 126+ desktop and Android; Firefox 149+ (BCD also lists Firefox Android 149, but its back-button wiring is tracked in Mozilla bug 1966467, so verify on device); Safari macOS: Technology Preview only; Safari iOS (tab and home-screen app): no. Android Back closing a modal `<dialog>`/auto popover: Chrome 120+. `<dialog>`: Baseline 2022 (Safari 15.4). Popover: Baseline Jan 2025 (Chrome 114, Firefox 125, Safari 17).

**Gotchas:**
- Anti-abuse: `cancel` fires only with transient user activation, once per activation. Watchers created without activation are grouped, so one Back closes all of them, and two close requests in a row without activation always go through. You cannot build an "are you sure?" trap on Back.
- Create watchers in the gesture handler that opens the overlay.
- Always `destroy()` the watcher when the overlay closes another way, or the next Back is swallowed doing nothing.
- Don't also listen for `keydown` Escape for the same overlay: it double-fires on desktop.
- iOS has no back button: Safari/iOS needs the history fallback plus a visible close or back control.
- Older `lib.dom` versions lack the types.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/CloseWatcher · https://github.com/WICG/close-watcher · https://bugzilla.mozilla.org/show_bug.cgi?id=1966467

## History-entry fallback for overlays: one entry per open overlay

Where `CloseWatcher` is missing (Safari/iOS, Firefox < 149), give each open overlay its own same-document history entry (`pushState` with no URL change). Browser Back, the iOS edge swipe and `history.back()` then pop the overlay through `popstate`, and closing from the UI calls `history.back()` so there is one close path.

```ts
const open: Array<() => void> = [];
const stateObj = (s: unknown): Record<string, unknown> => (typeof s === 'object' && s !== null ? { ...s } : {});
const depthOf = (s: unknown): number => {
  const d = stateObj(s)['overlays'];
  return typeof d === 'number' ? d : 0;
};

/** Call from the user gesture that opens the overlay. */
export function pushOverlayEntry(close: () => void): () => void {
  open.push(close);
  history.pushState({ ...stateObj(history.state), overlays: open.length }, '');
  // Closing from the UI: let Back do it, so popstate stays the only close path.
  return () => { if (open.includes(close)) history.back(); };
}

addEventListener('popstate', (e: PopStateEvent) => {
  const depth = depthOf(e.state);
  while (open.length > depth) open.pop()?.();
});

// On boot (reload/restore) an entry may still say overlays > 0 while nothing is open: neutralise it.
if (depthOf(history.state) > 0) history.replaceState({ ...stateObj(history.state), overlays: 0 }, '');
```

**Support:** History API everywhere. Needed on Safari macOS and iOS (tab and home-screen app, all versions as of Safari 27), Firefox < 149, and anywhere without `CloseWatcher`.

**Gotchas:**
- Chrome's history-manipulation intervention skips entries added without user activation when the user presses the browser/OS Back (`history.back()` is unaffected). Push only from a tap/click handler.
- Field-tested: a `pushState` right after a browser-initiated back, with no activation in between, made Chrome mark all same-document entries skippable, and the next Android Back exited the app. Never re-push a "sentinel" entry after a back.
- Keep one entry per overlay. When an overlay below the top closes, mark its entry stale instead of re-pushing.
- Forward after a back lands on an overlay entry whose overlay is gone: treat depth > `open.length` as a no-op or `replaceState` it down.
- Playwright doesn't reproduce the Android skip; test on a real device.
- `pushState` fires neither `popstate` nor `hashchange`.

**Sources:** https://chromium.googlesource.com/chromium/src/+/main/docs/history_manipulation_intervention.md · https://groups.google.com/a/chromium.org/g/blink-dev/c/T8d4_BRb2xQ/m/WSdOiOFcBAAJ

## Classify every UI state: push, replace or no history

New places the user should be able to go Back from (a conversation, item detail, settings) get `pushState`. In-place refinements (filter, sort, tab within a screen, search text, the selected row when both master and detail show, URL clean-up) get `replaceState`. Transient UI (menus, confirms, toasts, action sheets) gets no URL and uses close requests. Native back stacks hold screens, not taps; a Back that walks through filter toggles is a web tell.

```ts
type Change = 'screen' | 'refine';
export function navigate(url: string, kind: Change): void {
  if (kind === 'screen') history.pushState({ inApp: true }, '', url);
  else history.replaceState(history.state, '', url);
  render(new URL(url, location.href)); // pushState/replaceState never fire popstate: route yourself
}

// Master-detail depends on layout: a row is a new screen on a phone, a refinement when both panes show.
const kind: Change = matchMedia('(width >= 840px)').matches ? 'refine' : 'screen';

// Hash routers: `location.hash = x` PUSHES. Replace with history.replaceState(null, '', '#/x') or location.replace('#/x').

// Secrets in the URL (e.g. an invite key in the fragment): read into memory and strip at once, on first load,
// before analytics or error reporters read location, so it never lands in synced history.
const secret = new URLSearchParams(location.hash.slice(1)).get('key');
if (secret !== null) history.replaceState(history.state, '', location.pathname + location.search);
```

**Support:** History API everywhere. Media range syntax `(width >= 840px)`: Chrome 104, Firefox 102, Safari 16.4 (macOS and iOS).

**Gotchas:**
- Search-as-you-type: replace on every keystroke; push once only if the committed search should be a Back step.
- Keep `history.state` small (ids, not data); browsers cap its size.
- `replaceState` can't remove an entry that is already in history.
- Any route change should also close transient UI (menus, drawers).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState · https://developer.mozilla.org/en-US/docs/Web/API/History/pushState

## Navigation API as the router core, with a History API fallback

`window.navigation` funnels every same-origin navigation (links, forms, back/forward, `history.*` calls) into one `navigate` event you can intercept, with `entries()`, `currentEntry`, per-entry keys and state, `traverseTo(key)`, `canGoBack`, and built-in scroll and focus handling. One code path then covers link clicks, browser Back and the iOS/Android back gestures, and `traverseTo` can pop a tab to its root like a native tab bar.

```ts
// Types: recent lib.dom, or @types/dom-navigation on older TypeScript.
if ('navigation' in window) {
  navigation.addEventListener('navigate', (e) => {
    if (!e.canIntercept || e.downloadRequest !== null || e.formData) return;
    const url = new URL(e.destination.url);
    if (url.origin !== location.origin || !isAppRoute(url)) return;
    const animate = !e.hasUAVisualTransition; // the browser already animated a swipe-back
    e.intercept({
      scroll: 'manual',
      focusReset: 'manual', // you move focus to the new screen's heading yourself
      async handler() {
        await renderRoute(url, { type: e.navigationType, animate });
        e.scroll(); // restore remembered scroll or the #fragment, now that content exists
      },
    });
  });

  // Imperative:
  await navigation.navigate('#/inbox', { history: 'replace', state: { from: 'search' } }).finished;
  // Pop a tab back to its root entry without stacking a new one:
  const root = navigation.entries().find((en) => en.url?.endsWith('#/inbox'));
  if (root) navigation.traverseTo(root.key);
}
```

**Support:** Chromium 102 (`intercept` 105), desktop and Android; Firefox 147; Safari 26.2 macOS and iOS (tab and home-screen app). Baseline newly available since Jan 2026. `NavigateEvent.hasUAVisualTransition`: Chrome 118, Firefox 147, Safari 26.2. `intercept({ precommitHandler })`: Chrome 141, Firefox 147, not Safari.

**Gotchas:**
- Keep a History API fallback: many iPhones are still below iOS 26.2.
- Hash-only navigations are intercepted too (`e.hashChange === true`).
- Traversals generally can't be cancelled.
- The default `focusReset` moves focus to `<body>` after the handler; use `'manual'` if you manage focus.
- `entries()` lists only same-origin entries of this document's session.
- `canGoBack` is false on a cold launch or deep link (see [Up vs Back](#up-vs-back-an-in-app-back-button-that-never-exits-the-app)).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API · https://github.com/mdn/browser-compat-data

## Hash vs path routing on static hosts

Hash routes (`#/w/abc/c/general`) work on any static host and subpath with one `index.html`, never reach the server, and work offline from a precached shell. Path routes need the host (or a service worker) to serve `index.html` for every deep URL. A deep link or home-screen launch that 404s, or a reload that loses the screen, breaks the app illusion.

```ts
// Hash: nothing to configure. Keep the manifest relative to the deploy base:
// { "id": "./", "start_url": "./", "scope": "./" }

// Path routing on a host without rewrites (e.g. GitHub Pages): ship the shell as the 404 page too
//   cp dist/index.html dist/404.html
// and serve navigations from the service worker so offline/deep reloads work (Workbox):
import { createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }));
```

**Support:** Routing works everywhere. Service-worker navigation fallback: all current browsers (iOS 11.3+).

**Gotchas:**
- A `404.html` fallback is served with HTTP 404: fine for users, bad for crawlers and link previews.
- Hash routing conflicts with in-page `#anchors` (route them through your router) and can't be server-rendered or indexed.
- Notification, share-target and shortcut URLs must include the hash.
- Fragment secrets don't reach servers but do reach history, sync and screenshots: strip them.
- With a path router, make every in-scope URL resolvable or the installed app shows the host's 404 on launch.

**Sources:** https://developer.chrome.com/docs/workbox/modules/workbox-routing · https://developer.mozilla.org/en-US/docs/Web/API/Location/hash

## Deep links restore the full screen state; parsers never throw

Encode everything needed to rebuild a screen in its URL (space, conversation, open thread or panel, selected tab), and parse it leniently: malformed escapes, unknown segments and stray parts are dropped, never thrown. Native apps reopen exactly where a link points; a truncated old link that crashes or shows a blank screen is a web tell.

```ts
interface Route { space?: string; ch?: string; thread?: string }
const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

export function parseHash(h: string): Route {
  const p = h.replace(/^#\/?/, '').split('/').map(decode);
  const r: Route = {};
  for (let i = 0; i < p.length; i += 2) {
    const val = p[i + 1];
    if (!val) continue;
    if (p[i] === 'w' && /^[\w-]{1,64}$/.test(val)) r.space = val;
    else if (p[i] === 'c') r.ch = val;
    else if (p[i] === 't') r.thread = val; // unknown segments are ignored
  }
  return r;
}
// buildHash: a channel needs a space and a thread needs a channel, so stray parts are dropped on the way out.
```

```json
{ "shortcuts": [{ "name": "New message", "url": "./#/new", "icons": [{ "src": "new.png", "sizes": "96x96" }] }] }
```

**Support:** Routing everywhere. Manifest `shortcuts` (jump list, long-press icon): Chrome desktop 96, Chrome Android 84, Safari macOS 17.4 (Dock web apps); not Safari iOS, not Firefox.

**Gotchas:**
- Every segment is untrusted input: validate it.
- Round-trip test `parse(build(r))` equals `r` with a fixed-seed fuzzer.
- A link to data not yet synced needs a loading state, not "not found".
- Remember whether the first route of this page load came from outside (a deep link) or from in-app navigation: Back behaves differently (next section).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/shortcuts · https://developer.mozilla.org/en-US/docs/Web/API/URL

## Up vs Back: an in-app back button that never exits the app

Pushed screens get a visible back control. If the user arrived from inside the app, it does history Back; if they entered on this screen (notification, shared link, cold launch), it goes Up to the logical parent by replacing the entry. Installed iOS apps have no browser Back and desktop app windows hide it, and a naive `history.back()` on a deep-linked screen exits the app or jumps to the referrer.

```ts
/** Mark entries the app pushed itself; history.length is useless (it counts other origins and forward entries). */
export function goTo(url: string): void { history.pushState({ inApp: true }, '', url); route(); }

export function back(parentUrl: string): void {
  const s: unknown = history.state;
  const cameFromApp = typeof s === 'object' && s !== null && 'inApp' in s;
  if (cameFromApp) history.back(); // the previous screen, with its scroll and state
  else { history.replaceState(null, '', parentUrl); route(); } // deep-linked: Up to the parent
}
```

```css
/* Show the control where the platform gives none */
.screen-back { display: none; }
@media (display-mode: standalone), (max-width: 839px) { .screen-back { display: inline-flex; } }
```

**Support:** Everywhere. With the Navigation API, `navigation.canGoBack` (Chrome 102, Firefox 147, Safari 26.2) is false on a cold launch.

**Gotchas:**
- Routers that navigate with `location.hash = x` leave `history.state` null: set the marker with `replaceState` after the change, or switch to `pushState`.
- After Up, Back from the parent exits the app, which matches Android's synthetic back stack.
- iOS puts back top-left, hard to reach on big phones: also support the edge swipe (next section).
- In RTL the back control and swipe edge mirror.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Navigation/canGoBack · https://web.dev/learn/pwa/app-design

## iOS edge-swipe back, swipe-to-close and no double animations

iOS home-screen web apps have a system edge swipe for history back/forward (since iOS 12.2), and Safari tabs have the same gesture. Make full-screen panels history entries so the system swipe closes them, add your own swipe-to-close on narrow screens, and skip your own transition when the browser already animated the navigation. This avoids a swipe that leaves the app and a page that slides twice.

```ts
// Skip your push/pop animation when the browser already did one (property missing from older lib.dom)
addEventListener('popstate', (e: PopStateEvent) => {
  const uaAnimated = 'hasUAVisualTransition' in e && e.hasUAVisualTransition === true;
  renderRoute(location.href, { animate: !uaAnimated });
});

// Custom swipe-to-close (field-tested values, not platform constants):
// lock the axis after ~10px (mostly vertical = scroll); complete at ~64px, or ~32px for a flick >= 0.5px/ms;
// translate with the finger; haptic tick at the threshold. Ignore touches in the system edge zone:
const SYSTEM_EDGE_PX = 24;
export function startsInSystemEdge(e: PointerEvent): boolean {
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
  return rtl ? e.clientX > innerWidth - SYSTEM_EDGE_PX : e.clientX < SYSTEM_EDGE_PX;
}
```

```css
.panel { touch-action: pan-y; } /* vertical scroll stays native; you own horizontal drags */
```

**Support:** Edge-swipe back: Safari iOS tab and home-screen app (12.2+). `PopStateEvent.hasUAVisualTransition`: Chrome 118, Firefox 149, Safari 18 (macOS and iOS). `NavigateEvent.hasUAVisualTransition`: Chrome 118, Firefox 147, Safari 26.2.

**Gotchas:**
- In iOS standalone mode the system edge swipe can't be disabled; `overscroll-behavior-x` doesn't stop it.
- A full-screen panel that isn't a history entry makes the system swipe leave the whole screen.
- Astro, Nuxt and TanStack Router all fixed double-animation flicker on Safari swipe-back by checking `hasUAVisualTransition`.
- The system edge width (~20-30px) is undocumented.
- Gesture details (thresholds, haptics): see touch-gestures-input.md.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/PopStateEvent/hasUAVisualTransition · https://medium.com/@firt/whats-new-on-ios-12-2-for-progressive-web-apps-75c348f8e945 · https://github.com/withastro/astro/pull/16025

## Preserve scroll per screen and resume the last screen on relaunch

Remember each screen's scroll offset (keyed by route or entry key) and restore it on Back; start pushed screens at the top. On a cold launch without a deep link, resume the last route plus drafts and selections. Native back stacks keep screens as they were, and iOS evicts background web apps often. For bfcache, Page Lifecycle and state restoration after suspension, see offline-push-storage.md.

```ts
history.scrollRestoration = 'manual'; // the browser restores too early and never restores inner scrollers
const saved = new Map<string, number>();
export function leaveScreen(key: string, scroller: HTMLElement): void { saved.set(key, scroller.scrollTop); }
export function enterScreen(key: string, scroller: HTMLElement, backForward: boolean): void {
  requestAnimationFrame(() => { scroller.scrollTop = backForward ? (saved.get(key) ?? 0) : 0; });
}
// Survive reloads: mirror `saved` into sessionStorage on pagehide.

const LAST = 'last-route';
addEventListener('pagehide', () => { try { localStorage.setItem(LAST, location.hash); } catch { /* storage blocked */ } });
if (location.hash === '' || location.hash === '#/') {
  try {
    const r = localStorage.getItem(LAST);
    if (r !== null && isKnownRoute(r)) history.replaceState(null, '', r);
  } catch { /* storage blocked */ }
}
// Tab stacks: keep inactive tabs mounted but hidden (hidden / content-visibility: hidden) so scroll and state are free.
```

**Support:** `history.scrollRestoration`: Chrome 46, Firefox 46, Safari 11. `pagehide`: everywhere. `content-visibility: hidden`: Chrome 85, Firefox 125, Safari 18. Navigation API alternative: `intercept({ scroll: 'manual' })` + `e.scroll()`.

**Gotchas:**
- App-shell layouts (locked body plus an inner scroller) get no browser restoration at all.
- Restore only once content has its final height: reserve image space with `width`/`height` or `aspect-ratio`.
- Chat views anchor to the bottom: restore distance-from-bottom, not `scrollTop`.
- `pagehide`/`visibilitychange` hidden is the last reliable moment on iOS; `unload`/`beforeunload` are unreliable and block bfcache.
- Never resume into a confirm, payment or expired-auth screen; only resume when launched without an explicit deep link.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/History/scrollRestoration · https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility

## External links and app scope: leave the app deliberately

Keep navigations inside the manifest `scope`. Open off-scope and external links with `target="_blank" rel="noopener noreferrer"`, so the OS shows its in-app browser or the default browser instead of the installed app's own window turning into a random website.

```html
<a href="https://docs.example.com" target="_blank" rel="noopener noreferrer">Docs</a>
```

```ts
// Catch-all for user content (markdown, chat messages)
document.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!(a instanceof HTMLAnchorElement) || a.target) return;
  if (new URL(a.href, location.href).origin !== location.origin) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
});
// Several origins as one app (Chromium): manifest "scope_extensions" plus
// /.well-known/web-app-origin-association on each extra origin. Manifest details: install-and-identity.md.
```

**Support:** `target=_blank` everywhere. Out-of-scope navigation in installed apps: Chrome Android shows a custom-tab-like toolbar; Chromium desktop shows an origin bar with "open in browser"; iOS home-screen apps hand links to an in-app Safari view or Safari (behaviour has varied by iOS version); Firefox: n/a. `scope_extensions`: Chromium 138 (BCD lists desktop and Android; Chrome's launch targeted desktop — verify on Android), not Safari or Firefox.

**Gotchas:**
- iOS home-screen apps have storage (cookies, localStorage, IndexedDB) separate from Safari: a login in Safari doesn't exist in the app. Run OAuth/SSO so it returns to an in-scope URL inside the app, and test the installed app on every OS.
- Since iOS 26, sites added to the Home Screen open as web apps by default (users can turn "Open as Web App" off), so these rules apply even without a manifest.
- (unverified) Exact iOS 26/27 behaviour of `window.open` vs `target=_blank` in home-screen apps: test both.
- `mailto:`/`tel:` hand off to the OS and are fine.
- Never put credentials or tokens in links opened externally.

**Sources:** https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ · https://github.com/w3c-webmob/installable-webapps/blob/gh-pages/ios_standalone/README.md

## Single-window launches: launch_handler, launchQueue and link capturing

`launch_handler.client_mode` decides whether launches (icon, link, share, file, protocol) reuse the open app window. `focus-existing` plus `launchQueue` lets the running app route the target URL itself. Since Chrome 139 on Windows, macOS and Linux, clicking a link into an installed app's scope opens it in the app by default. Native chat and mail apps don't spawn a second copy (and a second connection) per link or notification. The manifest member is owned by install-and-identity.md; this is the runtime side.

```json
{ "launch_handler": { "client_mode": ["focus-existing", "auto"] } }
```

```ts
interface LaunchParamsLike { readonly targetURL?: string | null }
interface LaunchQueueLike { setConsumer(cb: (p: LaunchParamsLike) => void): void }
const lq: unknown = Reflect.get(window, 'launchQueue');
if (typeof lq === 'object' && lq !== null && 'setConsumer' in lq) {
  (lq as LaunchQueueLike).setConsumer((p) => {
    if (p.targetURL) routeTo(new URL(p.targetURL)); // focus-existing does NOT navigate for you
  });
}
```

```ts
// sw.ts (webworker lib): notifications focus the existing window on every platform, iOS 16.4+ included
declare const self: ServiceWorkerGlobalScope;
self.addEventListener('notificationclick', (e) => {
  const data: unknown = e.notification.data;
  const raw = typeof data === 'object' && data !== null && 'url' in data && typeof data.url === 'string' ? data.url : './';
  const url = new URL(raw, self.registration.scope).href;
  e.notification.close();
  e.waitUntil((async () => {
    const [c] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (c) { await c.focus(); c.postMessage({ type: 'open', url }); }
    else await self.clients.openWindow(url);
  })());
});
```

**Support:** `launch_handler`: Chromium 110 (experimental in BCD). `launchQueue`: Chromium desktop 102, not Chrome Android. Default link capturing into installed apps: Chrome 139 on Windows/macOS/Linux, ChromeOS later. Safari and Firefox: none of these. `clients.openWindow`: everywhere with service workers (iOS 16.4+ for notifications). `WindowClient.navigate`: Safari 16+, others long since.

**Gotchas:**
- The array form lists fallbacks in order.
- Users can switch link capturing off per app in Chrome's app settings.
- `launchQueue` fires for the initial launch too: test the cold path.
- Don't rely on these for correctness on mobile; make the service worker `notificationclick` path robust instead.
- Service-worker types need the `webworker` lib in a separate tsconfig.

**Sources:** https://developer.chrome.com/docs/web-platform/launch-handler/ · https://developer.chrome.com/docs/capabilities/pwa-navigation-management · https://groups.google.com/a/chromium.org/g/blink-dev/c/xl1hGAfxlA0

## Multiple windows and tabs: one leader, shared state, active window

Desktop users open the app in several tabs or windows. Elect one leader for the expensive live connection with Web Locks, fan out updates with `BroadcastChannel`, and decide presence, sounds and "mark as read" from visibility plus focus. Duplicate notifications or unread counts that disagree between windows are something native apps never do.

```ts
const bc = new BroadcastChannel('app');
void navigator.locks.request('leader', async () => {
  startLiveSync((update) => { apply(update); bc.postMessage(update); });
  await new Promise<never>(() => {}); // hold the lock until this window closes
});
bc.addEventListener('message', (e: MessageEvent<unknown>) => { if (isUpdate(e.data)) apply(e.data); });

type Presence = 'active' | 'visible' | 'away';
const presence = (): Presence =>
  document.visibilityState === 'hidden' ? 'away' : document.hasFocus() ? 'active' : 'visible';
const sync = (): void => publish(presence());
document.addEventListener('visibilitychange', sync);
addEventListener('focus', sync);
addEventListener('blur', sync);

// Installed desktop app: "Open in new window"
window.open('#/inbox', '_blank', 'noopener');
```

**Support:** `BroadcastChannel`: Chrome 54, Firefox 38, Safari 15.4. Web Locks: Chrome 69, Firefox 96, Safari 15.4. `visibilityState`/`hasFocus`: everywhere. `display_override: ["tabbed"]`: Chromium 126 per BCD (experimental), effectively ChromeOS. Window Management API: Chromium only, permission-gated.

**Gotchas:**
- Mark messages read only when the window is visible AND focused AND the message is in view; a window behind others can still report "visible".
- Headless test browsers always report visible: keep the presence function a one-liner you can exclude.
- iOS home-screen apps are single-window; `window.open` there opens an in-app browser.
- In installed Chromium desktop apps an in-scope `window.open` opens a new app window, each with its own history.
- Idle Detection is Chromium-only and permission-gated: avoid it for presence.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API · https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel · https://developer.chrome.com/docs/capabilities/tabbed-application-mode

## Window Controls Overlay: your own title bar on desktop installs

With `display_override: ["window-controls-overlay"]` (declared per install-and-identity.md), an installed desktop app draws into the title-bar area and the OS window buttons float over it. Place content with `env(titlebar-area-*)` and mark drag regions. Native desktop apps put search, tabs and account controls up there; a browser-style bar above your own header wastes ~30px.

```css
.titlebar {
  position: fixed;
  left: env(titlebar-area-x, 0); top: env(titlebar-area-y, 0);
  width: env(titlebar-area-width, 100%); height: env(titlebar-area-height, 40px);
  -webkit-app-region: drag; app-region: drag;
}
.titlebar :is(button, input, a, [role=button]) { -webkit-app-region: no-drag; app-region: no-drag; }
@media (display-mode: window-controls-overlay) { main { padding-top: env(titlebar-area-height, 0); } }
```

```ts
interface WcoLike extends EventTarget { readonly visible: boolean }
const wco: unknown = Reflect.get(navigator, 'windowControlsOverlay');
if (wco instanceof EventTarget && 'visible' in wco) {
  const o = wco as WcoLike;
  const sync = (): void => { document.documentElement.toggleAttribute('data-wco', o.visible); };
  o.addEventListener('geometrychange', sync);
  sync();
}
```

**Support:** Chromium 105+ on Windows, macOS, Linux and ChromeOS installs; not Android, Safari or Firefox (Firefox 143+ Windows taskbar web apps keep an address bar). `env(titlebar-area-*)`: Chrome 93. `-webkit-app-region`: Chromium; the unprefixed `app-region` is not in BCD (unverified), so keep the prefixed line.

**Gotchas:**
- Applies only when installed, and users can collapse the overlay back to a normal title bar: design both states.
- Drag regions swallow clicks: every interactive child needs `no-drag`.
- Keep the bar colour in sync with `theme-color` and dark mode.
- OS buttons sit on different sides on macOS and Windows: use the `env()` values, never fixed padding.
- Make sure a sticky header doesn't also sit under the overlay.

**Sources:** https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/window-controls-overlay · https://developer.mozilla.org/en-US/docs/Web/API/Window_Controls_Overlay_API

## Window and tab title carry context and unread count

`document.title` names the current screen and prefixes an unread count. Installed Chromium apps can set the title-bar text separately with `<meta name="application-title">`. The tab strip, history menu and Alt-Tab are where users read unread state.

```ts
export function setTitle(screen: string, unread: number, app = 'Acme'): void {
  const count = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ` : '';
  document.title = `${count}${screen} – ${app}`; // screen first: tabs truncate from the end
}
```

```html
<!-- Installed-app title bar text, independent of the tab title (Chromium only, non-standard) -->
<meta name="application-title" content="Acme">
```

**Support:** `document.title` everywhere. `application-title`: Chromium 134+; not Firefox or Safari.

**Gotchas:**
- Don't flash or alternate titles to grab attention: it's hostile and screen readers may re-announce. Use the favicon or app badge.
- Update the title on every route change (also good for history and bookmarks).
- How the installed-app title bar composes app name and document title varies by platform: verify.

**Sources:** https://blogs.windows.com/msedgedev/2025/02/05/control-your-installed-web-application-title/ · https://developer.mozilla.org/en-US/docs/Web/API/Document/title

## Favicon and app-icon badges reflect live state

Redraw the tab icon on a canvas from the declared icon: a number for mentions, a dot for other unread, a ring during a call, greyed when offline; restore the original when there's nothing to say. Mirror the count to the OS icon with the Badging API when installed (badging itself is owned by install-and-identity.md). Pinned tabs and docks are where users glance for "anything new?".

```ts
// Canvas recipe:
// - read <link rel~=icon>; load with img.crossOrigin = 'anonymous' (a non-CORS icon fails instead of tainting)
// - paint 64x64: grayscale + alpha .55 offline; ring in a call; red badge capped at '9+'; accent dot for unread
// - colours from CSS tokens (getComputedStyle(root).getPropertyValue('--danger')) so it follows the theme
// - link.href = canvas.toDataURL('image/png'); when calm, restore the original href
// - a MutationObserver on <head> adopts newly chosen icons; recognise your own data: URLs to avoid a loop
// - skip redraws when the state is unchanged
export async function setBadge(count: number): Promise<void> {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge();
  } catch { /* not installed or not permitted */ }
}
```

**Support:** Dynamic favicons: Chromium and Firefox tabs; Safari shows favicons, but how reliably it picks up runtime `data:` changes is unverified. `setAppBadge`: Chromium desktop 81 (Windows/macOS, ChromeOS later), not Chrome Android (Android badges come from notifications); Safari 17 macOS web apps; Safari iOS 16.4+ home-screen apps only; not Firefox.

**Gotchas:**
- At 16px only ~2 characters fit: cap at "9+".
- Re-render on `visibilitychange` and theme change.
- On iOS the badge shows only for home-screen apps and in practice needs notification permission.
- Clear the badge when the user reads things on any window or device.
- Keep the canvas logic in one module with a `stop()` so tests don't fight over the icon.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Badging_API · https://developer.mozilla.org/en-US/docs/Web/API/Navigator/setAppBadge

## Adaptive navigation: bottom tabs on phones, rail or sidebar when wider

Choose navigation chrome by window width, not device: a bottom tab bar when compact (<600px), a navigation rail at medium widths (600-839px), a persistent sidebar when expanded (≥840px). Detail panels go full screen when narrow. A squeezed desktop sidebar on a phone, or a hamburger as the only navigation, reads as a responsive website. Split-view layout details: viewport-keyboard-safe-areas.md.

```css
.app { display: grid; height: 100dvh; grid-template: 'main' 1fr 'tabs' auto / 1fr; }
.tabbar { grid-area: tabs; display: flex; padding-bottom: env(safe-area-inset-bottom, 0px); }
.rail, .sidebar { display: none; }
@media (600px <= width < 840px) {
  .app { grid-template: 'rail main' 1fr / 80px 1fr; }
  .tabbar { display: none; }
  .rail { display: flex; grid-area: rail; flex-direction: column; }
}
@media (width >= 840px) {
  .app { grid-template: 'side main' 1fr / 280px 1fr; }
  .tabbar { display: none; }
  .sidebar { display: flex; grid-area: side; }
}
```

```ts
// JS only for structural decisions (panels full screen, sidebar becomes a drawer)
const wide = matchMedia('(width >= 840px)');
wide.addEventListener('change', () => relayout(wide.matches));
```

**Support:** Range syntax: Chrome 104, Firefox 102, Safari 16.4. `dvh`: Chrome 108, Firefox 101, Safari 15.4. `env(safe-area-inset-*)`: Chrome 69, Firefox 65, Safari 11.1 / iOS 11.3 (needs `viewport-fit=cover`).

**Gotchas:**
- iPad Split View, foldables and narrow desktop windows cross breakpoints at runtime: relayout must keep route, scroll and drafts.
- Collapsing master-detail turns the detail into a pushed screen (Back closes it); expanding shows both panes.
- Never hide 3-5 primary destinations behind a hamburger on phones.
- Breakpoints follow Material 3 window size classes; Apple's compact/regular size classes have similar intent.

**Sources:** https://m3.material.io/foundations/layout/applying-layout/window-size-classes · https://developer.apple.com/design/human-interface-guidelines/tab-bars

## Tab bar conventions and the thumb zone

Use 3-5 top-level destinations with icon plus short label. Re-tapping the active tab scrolls to top; tapping again pops to the tab's root. Each tab keeps its own stack and scroll. Put primary actions in the bottom third and keep destructive ones out of accidental reach. These are muscle-memory behaviours on iOS and Android.

```ts
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
function onTabPress(tab: Tab): void {
  if (tab !== current) { switchTo(tab); return; } // restores that tab's own stack and scroll
  const scroller = scrollerOf(tab);
  if (scroller.scrollTop > 0) scroller.scrollTo({ top: 0, behavior: reduce.matches ? 'auto' : 'smooth' });
  else popToRoot(tab); // navigation.traverseTo(rootKey) or replace to the tab root
}
```

```html
<nav class="tabbar" aria-label="Main">
  <a href="#/inbox" aria-current="page"><svg aria-hidden="true">…</svg><span>Inbox</span><span class="badge" aria-label="3 unread">3</span></a>
</nav>
<!-- targets ≥ 44×44pt (Apple) / 48×48dp (Material); active state not colour-only (filled icon or weight) -->
```

**Support:** A pattern, no API. Smooth `scrollTo`: everywhere (Safari 15.4+).

**Gotchas:**
- On Android with `interactive-widget=resizes-content`, hide the tab bar while the keyboard is up or it rides on top of it.
- A FAB or composer sits above the tab bar, not under the home indicator.
- On iPadOS the tab bar lives at the top or becomes a sidebar.
- (unverified) iOS "tap the status bar to scroll to top" only reaches the document scroller, not inner overflow containers.

**Sources:** https://developer.apple.com/design/human-interface-guidelines/tab-bars · https://m3.material.io/components/navigation-bar/guidelines

## Large titles and sticky translucent headers

A sticky header with a translucent blurred material and a large title that collapses into the bar on scroll: scroll-driven animations where supported, an `IntersectionObserver` toggle elsewhere. These are signature iOS and Material details. Safari 26+ tab toolbar tinting from edge elements is owned by viewport-keyboard-safe-areas.md.

```css
.header {
  position: sticky; top: 0; z-index: 10;
  padding-top: env(safe-area-inset-top, 0px);
  background: color-mix(in srgb, var(--surface) 75%, transparent);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .header { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
@supports (animation-timeline: scroll()) {
  .large-title { animation: title-out linear both; animation-timeline: scroll(nearest block); animation-range: 0 56px; }
  .bar-title { animation: title-in linear both; animation-timeline: scroll(nearest block); animation-range: 40px 72px; }
}
@keyframes title-out { to { opacity: 0; transform: translateY(-6px) scale(.92); } }
@keyframes title-in { from { opacity: 0; } }
```

```ts
// Fallback: a 1px sentinel above the title
new IntersectionObserver(([e]) => { header.toggleAttribute('data-scrolled', e ? !e.isIntersecting : false); }).observe(sentinel);
```

**Support:** `backdrop-filter`: Chrome 76, Firefox 103, Safari 18 unprefixed (`-webkit-` since Safari 9). Scroll-driven animations: Chrome 115, Safari 26 (macOS and iOS); Firefox only in Nightly/preview. `prefers-reduced-transparency`: Chromium 118 only (Firefox behind a flag, no Safari).

**Gotchas:**
- Put `animation-timeline` after the `animation` shorthand, which resets it.
- Safari 26+ tabs ignore `theme-color` and tint toolbars from a fixed/sticky element touching the edge, using its own background: give the header an opaque-enough background (details in viewport-keyboard-safe-areas.md).
- Blur is GPU-heavy on low-end Android; an opaque fallback is fine.
- `z-index` above content but below dialogs and popovers (the top layer handles those).

**Sources:** https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ · https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timeline/scroll

## System font stack and platform type conventions

Use the OS UI font (SF Pro on Apple, Segoe UI on Windows, Roboto on Android) via `system-ui`, the OS monospace font, and tabular numerals for counts and times. A web font for UI text is an instant website signal; the system font also matches menus, pickers and OS chrome.

```css
:root {
  --font-ui: system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, 'Cascadia Code', Menlo, Consolas, monospace;
  font-family: var(--font-ui);
}
time, .count, .badge { font-variant-numeric: tabular-nums; }
h1, h2 { text-wrap: balance; }
p { text-wrap: pretty; }
/* canvas text too: ctx.font = 'bold 18px system-ui, sans-serif' */
```

**Support:** `system-ui`: Chrome 56, Firefox 92, Safari 11 (`-apple-system` since Safari 9). `ui-monospace`/`ui-rounded`/`ui-serif`: Safari only (others fall through the stack). `text-wrap: balance`: Chrome 114, Firefox 121, Safari 17.5. `pretty`: Chrome 117, Safari 26, not Firefox (degrades harmlessly).

**Gotchas:**
- A brand font for headings or marketing is fine; keep body and controls on `system-ui`.
- (unverified) `system-ui` on Windows in some CJK locales resolves to a font with poor Latin rendering; list `'Segoe UI'` first if that matters.
- Don't set `-webkit-font-smoothing` globally just for light-on-dark; test both themes.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/font-family · https://developer.apple.com/design/human-interface-guidelines/typography

## Respect the user's text size: rem, iOS Dynamic Type, Chromium text-scale

Size all text in `rem`/`em` from the user's default. On iOS, opt into Dynamic Type with `font: -apple-system-body` so Settings › Text Size applies; in Chromium, opt into the OS text scale with `<meta name="text-scale" content="scale">`. Native apps grow with the OS text size; most websites don't. The 16px-field rule against iOS focus zoom is owned by viewport-keyboard-safe-areas.md.

```html
<meta name="text-scale" content="scale"> <!-- Chromium 146+: initial font size follows the OS text scale -->
```

```css
html { font-size: 100%; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
/* iOS only: -webkit-touch-callout exists only on iOS, so macOS Safari (small fixed system size) is excluded */
@supports (font: -apple-system-body) and (-webkit-touch-callout: none) {
  html { font: -apple-system-body; } /* ~17px by default, scales with Dynamic Type */
  body { font-family: var(--font-ui); } /* keep your family; the size stays dynamic */
}
body { font-size: 1rem; } h1 { font-size: 1.75rem; } .caption { font-size: .8125rem; }
@media (pointer: coarse) { input, textarea, select { font-size: max(16px, 1rem); } } /* no focus zoom, still scales */
/* Finer control in Chromium: calc(1rem * env(preferred-text-scale, 1)) */
```

**Support:** `-apple-system-body` Dynamic Type: Safari iOS tab and home-screen app (and WKWebView); not macOS. `meta text-scale`: Chromium 146 (experimental). `env(preferred-text-scale)`: Chromium 138 (experimental); per the explainer effective on mobile first. Firefox and Safari: neither.

**Gotchas:**
- Any `px` font size breaks the chain, as does `html { font-size: 62.5% }` unless everything else is `rem`.
- Layouts must reflow at 200%+: no fixed-height rows, allow wrapping, test the largest accessibility sizes.
- Forcing `16px !important` on fields stops them growing with Dynamic Type; `max(16px, 1rem)` fixes that.
- Never stop zoom with `maximum-scale`/`user-scalable=no`: it blocks pinch zoom and fails axe.

**Sources:** https://drafts.csswg.org/css-env-1/explainers/meta-text-scale.html · https://furbo.org/2024/07/04/dynamic-type-on-the-web/ · https://www.tpgi.com/text-resizing-web-pages-ios-using-dynamic-type/

## color-scheme, light-dark() and accent-color

`color-scheme` makes the UA draw scrollbars, form controls, pickers, autofill and the default canvas in light or dark; `light-dark()` writes theme tokens in one declaration; `accent-color` tints checkboxes, radios, ranges and progress bars with your brand. White scrollbars or pickers in a dark app, and default-blue checkboxes in a green app, are instant tells.

```html
<meta name="color-scheme" content="light dark"> <!-- applies before CSS loads: no white flash -->
```

```css
:root {
  color-scheme: light dark;
  accent-color: var(--brand);
  --surface: light-dark(#ffffff, #161614);
  --text: light-dark(#1b1b18, #ededea);
}
:root[data-theme='light'] { color-scheme: light; } /* a manual override also flips native controls */
:root[data-theme='dark'] { color-scheme: dark; }
```

**Support:** `color-scheme`: Chrome 81, Firefox 96, Safari 13. `light-dark()`: Chrome 123, Firefox 120, Safari 17.5. `accent-color`: Chrome 93, Firefox 92, Safari 15.4; automatic contrast for legibility only from Safari 26.2 and still missing on Chrome Android. Themed scrollbars: viewport-keyboard-safe-areas.md.

**Gotchas:**
- `light-dark()` only works for colours, and only when `color-scheme` allows both.
- `accent-color` doesn't style `<select>` or text inputs.
- On Chrome Android and Safari < 26.2 the checkmark may lose contrast: pick an accent legible against both white and black.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme · https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark · https://developer.mozilla.org/en-US/docs/Web/CSS/accent-color

## Dark mode: follow the system, allow an override, sync theme-color, no flash

Default to `prefers-color-scheme` (or a deliberate brand default), let users override to light or dark per device, apply the override with an inline script before first paint, and update `<meta name="theme-color">` on every theme change so the status or title bar matches. A light status bar over a dark app, or a white launch flash, gives away the browser.

```html
<!-- <head>, before stylesheets -->
<meta name="theme-color" content="#161614">
<script>
  try { const t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch {}
</script>
```

```ts
type Theme = 'system' | 'light' | 'dark';
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch { /* private mode */ }
  // One theme-color, always the real page surface: media-attribute pairs can't express a manual override.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
}
prefersDark.addEventListener('change', () => applyTheme(savedTheme()));
```

**Support:** `theme-color`: Chrome Android 92+ (tab and installed); Chromium desktop: installed apps only (title bar); Safari 15+, but from Safari 26 (macOS and iOS) only for installed/home-screen web apps, not tabs; Firefox: no. `prefers-color-scheme`: Chrome 76, Firefox 67, Safari 12.1 / iOS 13.

**Gotchas:**
- Manifest `theme_color`/`background_color` are static: they colour the splash and initial title bar before JS runs, so use your default theme's values (owned by install-and-identity.md).
- `body` must have an explicit background colour, or the computed value is transparent.
- A manual switch to light leaves an installed app's bar dark unless you sync `theme-color` as above.
- iOS `apple-mobile-web-app-status-bar-style` (install-and-identity.md): (unverified) whether runtime changes apply without relaunch; assume not.
- Redraw canvas assets (favicon badges) on theme change.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/theme-color · https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme

## Modals with dialog: showModal, requestClose, closedby, invoker commands

`showModal()` gives the top layer, `::backdrop`, inertness of the rest of the page, focus containment, Esc and Android Back, and focus return. `requestClose()` routes app-initiated closes through `cancel` (for unsaved-changes checks); `closedby="any"` adds light dismiss; `commandfor`/`command` open and close it without JS. Hand-rolled div modals leak focus, scroll the page behind and ignore Back. Animating dialogs: motion-performance.md.

```html
<button commandfor="confirm" command="show-modal">Delete…</button>
<dialog id="confirm" closedby="any" aria-labelledby="confirm-title">
  <form method="dialog">
    <h2 id="confirm-title">Delete this channel?</h2>
    <button value="cancel" autofocus>Cancel</button>
    <button value="delete" class="danger">Delete</button>
  </form>
</dialog>
```

```ts
const dlg = document.querySelector<HTMLDialogElement>('#confirm');
if (dlg) {
  dlg.addEventListener('close', () => { if (dlg.returnValue === 'delete') remove(); });
  dlg.addEventListener('cancel', (e) => { if (hasUnsavedChanges()) { e.preventDefault(); askDiscard(); } });
  // Light-dismiss fallback where closedby is missing (Safari as of 27)
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dlg.addEventListener('click', (e) => {
      const r = dlg.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (e.target !== dlg || !outside) return;
      if (typeof dlg.requestClose === 'function') dlg.requestClose(); else dlg.close();
    });
  }
}
// Browsers without commandfor (Safari < 26.2): also wire the button with dlg.showModal().
```

```css
html:has(dialog:modal) { overflow: hidden; } /* stop the page behind from scrolling */
```

**Support:** `<dialog>`: Chrome 37, Firefox 98, Safari 15.4. `requestClose()`: Chrome 134, Firefox 139, Safari 18.4. `closedby`: Chrome 134, Firefox 141, Safari Technology Preview only (not Safari 27 / iOS 27). `commandfor`/`command`: Chrome 135, Firefox 144, Safari 26.2. Android Back closes a modal dialog: Chrome 120+.

**Gotchas:**
- `preventDefault()` in `cancel` is honoured only with user activation, so the second Esc/Back closes anyway: autosave drafts rather than rely on it.
- The rect check is needed because clicks on the dialog's own padding also have `target === dlg`.
- Toasts rendered outside the top layer sit under, and are inert beneath, an open modal (see [Toasts](#toasts-and-snackbars-top-layer-safe-areas-live-region-bounded-queue)).
- Non-modal `show()` doesn't make the rest inert.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog · https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/requestClose · https://developer.mozilla.org/en-US/docs/Web/API/Invoker_Commands_API

## Menus and popovers: Popover API plus CSS anchor positioning

`[popover]` puts menus, pickers and callouts in the top layer with light dismiss, Esc and Android Back. CSS anchor positioning tethers them to their button and flips them near viewport edges with no JS library. Clipped or mispositioned dropdowns are a classic tell.

```html
<button id="more" popovertarget="more-menu">More</button>
<div id="more-menu" popover>
  <button>Rename</button><button>Mute</button><button class="danger">Leave</button>
</div>
```

```css
#more { anchor-name: --more; }
#more-menu {
  position-anchor: --more;
  position-area: block-end span-inline-start;
  margin: 4px 0;
  position-try-fallbacks: flip-block, flip-inline;
}
@supports not (anchor-name: --a) {
  /* fallback: position in JS on 'toggle' (e.g. Floating UI), or centre as a sheet on phones */
}
/* Right-click/long-press menus at a point: move an invisible fixed anchor element to the pointer, then showPopover(). */
```

**Support:** Popover: Chrome 114, Firefox 125, Safari 17 (macOS and iOS). Anchor positioning: Chrome 125 (`position-try-fallbacks` 128, `position-area` 129; earlier names `inset-area`/`position-try-options`), Firefox 147, Safari 26. `showPopover({ source })`: Chrome 137, Firefox 144, Safari 26.

**Gotchas:**
- `role="menu"` commits you to roving focus and arrow keys; for a simple action list, plain buttons in a popover are more honest.
- Nested popovers stack only when the child is inside, or invoked from, the parent.
- On phones prefer an action sheet (next section) over a tiny anchored menu.
- Top-layer popovers escape transforms and overflow, but your `z-index` scale doesn't apply to them.
- Chrome 125-128 used older property names: test the fallback branch.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Popover_API · https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_anchor_positioning

## Action sheets and bottom sheets on touch, anchored menus on desktop

On coarse pointers or compact windows, present choices as a bottom sheet: a `<dialog>` pinned to the bottom edge with safe-area padding, a drag handle, destructive actions in red and a separate Cancel. On desktop the same actions appear as an anchored menu. Centred desktop modals or tiny dropdowns on a phone feel ported.

```css
dialog.sheet {
  margin: auto 0 0; width: 100%; max-width: 100%; max-height: 85dvh;
  border: 0; border-radius: 16px 16px 0 0;
  padding: 8px 16px max(16px, env(safe-area-inset-bottom, 0px));
}
dialog.sheet[open] { animation: sheet-in .28s cubic-bezier(.2, .8, .2, 1); }
@keyframes sheet-in { from { transform: translateY(100%); } }
@media (prefers-reduced-motion: reduce) { dialog.sheet[open] { animation: none; } }
@media (width >= 600px) and (pointer: fine) { dialog.sheet { margin: auto; max-width: 420px; border-radius: 16px; } }
```

```ts
const useSheet = matchMedia('(pointer: coarse), (width < 600px)').matches;
if (useSheet) sheet.showModal(); else menu.showPopover();
```

**Support:** `<dialog>`: Baseline 2022. `dvh`: Chrome 108, Firefox 101, Safari 15.4. Light dismiss: `closedby` or the fallback in [Modals](#modals-with-dialog-showmodal-requestclose-closedby-invoker-commands).

**Gotchas:**
- Drag-to-dismiss: `touch-action: none` only on the handle/header so the content still scrolls; dismiss at ~0.5px/ms or past 1/3 of the height.
- When the iOS keyboard opens inside a sheet the page pans: size the sheet to the visual viewport (viewport-keyboard-safe-areas.md).
- Cancel must be reachable by Back (dialog does this) and a backdrop tap.
- Keep sheets short; long content is a pushed screen.

**Sources:** https://developer.apple.com/design/human-interface-guidelines/action-sheets · https://m3.material.io/components/bottom-sheets/guidelines

## Native pickers: date/time inputs, showPicker() and customizable select

`<input type="date|time|datetime-local">` and `<select>` give the OS pickers: the iOS wheel or calendar, Android's material picker, the desktop calendar. Open them from a tap anywhere on the field with `showPicker()`. Where a styled dropdown is needed, opt the real `<select>` into `appearance: base-select` instead of rebuilding it from divs. JS date pickers and div dropdowns on phones are glaring tells.

```html
<input type="date" name="due" min="2026-01-01">
<input type="time" name="at" step="900">

<!-- Customizable select: real form control, keyboard and screen-reader support kept -->
<select name="status">
  <button><selectedcontent></selectedcontent></button>
  <option value="online"><span class="dot ok" aria-hidden="true"></span>Online</option>
  <option value="away"><span class="dot warn" aria-hidden="true"></span>Away</option>
</select>
```

```ts
field.addEventListener('click', () => {
  if (typeof field.showPicker !== 'function') return;
  try { field.showPicker(); } catch { /* no activation, cross-origin iframe, or unsupported */ }
});
```

```css
@supports (appearance: base-select) {
  @media (pointer: fine) { select, ::picker(select) { appearance: base-select; } } /* keep the OS picker on phones unless tested */
}
```

**Support:** `input.showPicker()`: Chrome 99, Firefox 101, Safari 16. `select.showPicker()`: Chrome 121, Firefox 122, Safari Technology Preview behind a flag. `appearance: base-select` and `::picker(select)`: Chromium 135, Safari 27 macOS and iOS; Firefox behind a flag.

**Gotchas:**
- Values are always ISO (`yyyy-mm-dd`, `HH:mm`); display follows the browser/OS locale.
- `showPicker()` throws without user activation and in cross-origin iframes.
- WebKit's golden rule: icons and swatches in options are additions, never substitutes. Always keep text (visually hidden if needed), or unsupported browsers and screen readers get empty options.
- (unverified) Whether iOS 27 renders the styled `::picker` or keeps the system menu for `base-select`: test on device before opting phones in.
- Don't use `datalist` as a combobox on iOS (weak UI).

**Sources:** https://webkit.org/blog/18117/the-golden-rule-of-customizable-select/ · https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/showPicker · https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select

## Switches and segmented controls from real inputs

Immediate-effect settings use a switch: `<input type="checkbox" switch role="switch">`, native in Safari, a styled checkbox elsewhere. Mutually exclusive views (2-5) use a segmented control built from radios. Real inputs give native semantics and keyboard behaviour (arrow keys in radio groups); settings full of checkboxes look like web forms. Haptics: touch-gestures-input.md.

```html
<label class="row">Notifications <input type="checkbox" switch role="switch" name="notify"></label>

<fieldset class="segmented"><legend class="sr-only">View</legend>
  <label><input type="radio" name="view" value="list" checked> List</label>
  <label><input type="radio" name="view" value="board"> Board</label>
</fieldset>
```

```ts
// Style the fallback only where the native switch is missing
if (!('switch' in HTMLInputElement.prototype)) document.documentElement.classList.add('no-native-switch');
```

```css
.no-native-switch input[role=switch] { appearance: none; inline-size: 2.75rem; block-size: 1.625rem; border-radius: 999px; background: var(--track-off); position: relative; transition: background .2s; }
.no-native-switch input[role=switch]::before { content: ''; position: absolute; inset-block: 2px; inset-inline-start: 2px; aspect-ratio: 1; border-radius: 50%; background: #fff; transition: translate .2s; }
.no-native-switch input[role=switch]:checked { background: var(--accent); }
.no-native-switch input[role=switch]:checked::before { translate: 1.125rem 0; }
.no-native-switch input[role=switch]:checked:dir(rtl)::before { translate: -1.125rem 0; }
.segmented { display: inline-flex; padding: 2px; border: 0; border-radius: 9px; background: var(--fill); }
.segmented label { position: relative; padding: 6px 12px; border-radius: 7px; }
.segmented input { position: absolute; opacity: 0; inset: 0; margin: 0; }
.segmented label:has(:checked) { background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / .2); }
.segmented label:has(:focus-visible) { outline: 2px solid var(--accent); }
```

**Support:** `switch` attribute: Safari 17.4+ macOS and iOS (iOS 18 added a haptic on toggle); Chromium and Firefox render a checkbox (`role="switch"` still announces a switch). `:has()`: Chrome 105, Firefox 121, Safari 15.4.

**Gotchas:**
- Switches apply immediately, with no Save button; inside a form that needs submit, use a checkbox.
- Hacks that toggle hidden switches to fire iOS haptics rely on undocumented behaviour Apple can change.
- Mirror the knob in RTL (above).
- Segmented controls swap views in place: update the URL with `replaceState`, not push.

**Sources:** https://webkit.org/blog/15865/webkit-features-in-safari-18-0/ · https://developer.apple.com/design/human-interface-guidelines/segmented-controls

## Native disclosure: details name, ::details-content, hidden=until-found

`<details>`/`<summary>` is an accessible disclosure with no JS; `name` makes exclusive accordions; `::details-content` lets you animate it; `hidden="until-found"` keeps collapsed content findable by find-in-page and fragment links. Settings groups behave like native collapsible sections with no hand-rolled ARIA.

```html
<details name="settings" open><summary>Notifications</summary>…</details>
<details name="settings"><summary>Privacy</summary>…</details>
<section hidden="until-found" id="advanced">…</section>
```

```css
:root { interpolate-size: allow-keywords; } /* Chromium: lets block-size animate to auto */
details::details-content { block-size: 0; overflow: clip; transition: block-size .25s, content-visibility .25s allow-discrete; }
details[open]::details-content { block-size: auto; }
summary { list-style: none; } summary::-webkit-details-marker { display: none; }
@media (prefers-reduced-motion: reduce) { details::details-content { transition: none; } }
```

```ts
document.getElementById('advanced')?.addEventListener('beforematch', () => expandAdvancedUi());
```

**Support:** `details[name]`: Chrome 120, Firefox 130, Safari 17.2. `::details-content`: Chrome 131, Firefox 143, Safari 18.4. `interpolate-size`: Chromium 129 only (others open without the height animation). `hidden="until-found"`: Chrome 102, Firefox 148, Safari 26.2 (partial: doesn't scroll to the match). `beforematch`: Chrome 102, Firefox 139, Safari 26.2.

**Gotchas:**
- Safari doesn't support chaining pseudo-elements after `::details-content`.
- Hide Safari's marker with `::-webkit-details-marker`.
- Don't put interactive controls inside `<summary>`.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details · https://developer.mozilla.org/en-US/docs/Web/CSS/::details-content · https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden

## inert for off-canvas drawers and backgrounds

`inert` removes a subtree from focus, pointer interaction and the accessibility tree. Put it on a closed off-canvas drawer, and on the main content while a custom (non-dialog) overlay is open. Tabbing into an invisible sidebar, or VoiceOver reading content behind a sheet, are real tells for keyboard and assistive-tech users.

```ts
export function setDrawer(drawer: HTMLElement, main: HTMLElement, toggle: HTMLElement, open: boolean): void {
  if (!open && drawer.contains(document.activeElement)) toggle.focus(); // move focus out before inerting
  drawer.inert = !open; // closed drawer translated off-screen: not focusable or announced
  main.inert = open; // while open, the page behind is untouchable
  drawer.toggleAttribute('data-open', open);
  if (open) drawer.querySelector<HTMLElement>('a, button')?.focus();
}
// React 19: <nav inert={!open}>; React 18 needed inert="" via a ref.
```

**Support:** `inert`: Chrome 102, Firefox 112, Safari 15.5 (macOS and iOS).

**Gotchas:**
- For true modals prefer `dialog.showModal()`, which inerts everything else for you.
- Don't inert an ancestor of the focused element without moving focus first.
- Focus the first item on open; return focus to the toggle on close.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/inert · https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert

## Toasts and snackbars: top layer, safe areas, live region, bounded queue

Render toasts in a `popover="manual"` container so they sit in the top layer above modal dialogs, above the tab bar or composer and inside safe areas. Announce through an always-present polite live region, cap how many show, and dismiss pushed-out toasts properly. A toast hidden behind a modal or never announced is a tell.

```html
<div id="toasts" popover="manual"></div>
<div id="announcer" class="sr-only" role="status" aria-live="polite"></div>
```

```css
#toasts { inset: auto 0 0 0; margin: 0 auto; border: 0; background: none; display: grid; gap: 8px; pointer-events: none;
  padding: 0 16px calc(12px + env(safe-area-inset-bottom, 0px) + var(--bottom-bar, 0px)); }
#toasts > * { pointer-events: auto; }
```

```ts
const MAX_TOASTS = 3;
export function showToast(el: HTMLElement, text: string, dismiss: (el: Element) => void): void {
  const host = document.getElementById('toasts');
  const live = document.getElementById('announcer');
  if (!host || !live) return;
  host.append(el);
  while (host.children.length > MAX_TOASTS) { const old = host.firstElementChild; if (old) dismiss(old); else break; } // runs callbacks
  if (host.matches(':popover-open')) host.hidePopover();
  host.showPopover(); // re-enter the top layer above any dialog opened since
  live.textContent = text;
}
```

**Support:** `popover="manual"` and `:popover-open`: Chrome 114, Firefox 125, Safari 17.

**Gotchas:**
- Top-layer order is insertion order: re-show after opening a dialog, or the toast stays beneath it.
- A live region that was `display: none` when its text changed often isn't announced; keep the announcer separate and always rendered.
- `dismiss` must remove the element, or the loop never ends.
- Pause auto-dismiss on hover/focus; toasts with an action (Undo) need ~5s+ and keyboard reach.
- Support swipe-to-dismiss on touch; never put essential information only in a toast.
- Keep clear of the iOS keyboard (visual viewport) and the composer.

**Sources:** https://m3.material.io/components/snackbar/guidelines · https://developer.mozilla.org/en-US/docs/Web/API/Popover_API

## Pull-to-refresh and live data

The browser's own pull-to-refresh, bounce and history swipes are switched off with `overscroll-behavior` (owned by viewport-keyboard-safe-areas.md). Here: decide whether you need pull-to-refresh at all. Live-data apps (chat, push mail) refresh themselves; offer pull-to-refresh only where data is fetched on demand. Pulling a chat list and reloading the whole app is a browser tell.

```css
html, body { overscroll-behavior: none; }               /* no browser PTR or bounce on the shell */
.scroller, dialog, .sheet { overscroll-behavior: contain; } /* no scroll chaining */
.carousel, .code-block { overscroll-behavior-x: contain; } /* sideways scroll end doesn't swipe history */
```

```ts
// Live data: refresh on return instead of asking the user to pull
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resync(); });
addEventListener('online', resync);
```

**Support:** `overscroll-behavior`: Chrome 63, Firefox 59, Safari 16, partial everywhere for containers without scrollable overflow; fixed in Chrome 144 and Firefox 150, still partial in Safari.

**Gotchas:**
- Chrome Android keeps pull-to-refresh in installed apps: disable it explicitly.
- iOS home-screen apps have no pull-to-refresh: a live app needs reconnect-on-visible plus a visible Retry in error states. Never make pull-to-refresh the only way to recover.
- A custom PTR must start only at `scrollTop` 0 with a vertical gesture.
- (unverified) Whether `overscroll-behavior-x` stops Safari macOS trackpad history swipes. It doesn't stop the iOS standalone edge swipe.

**Sources:** https://developer.chrome.com/blog/overscroll-behavior · https://web.dev/learn/pwa/app-design

## Designed empty, loading, error and offline states on every screen

Each screen defines four states. Empty explains and offers the primary action; loading is a layout-matching skeleton shown only after a short delay; error says what failed, keeps stale data visible and offers Retry; offline shows a banner, queues writes and marks items pending or failed. Judge connectivity by real reachability. Skeleton and optimistic-UI mechanics: motion-performance.md.

```ts
/** Skeleton only if the load takes longer than `ms`, so fast loads don't flash. */
export function withDelayedSkeleton<T>(p: Promise<T>, show: () => void, hide: () => void, ms = 300): Promise<T> {
  const t = setTimeout(show, ms);
  return p.finally(() => { clearTimeout(t); hide(); });
}

// navigator.onLine === false is reliable; true only means "has some network".
const offline = (): boolean => !navigator.onLine || !backendReachable();
addEventListener('online', recheck);
addEventListener('offline', recheck);
```

```html
<section aria-busy="true">…skeleton…</section>
```

**Support:** `navigator.onLine` and `online`/`offline` events: everywhere (true on captive portals or LAN-only links). `aria-busy`: widely supported by screen readers.

**Gotchas:**
- Skeletons must match the final layout or you trade a spinner for layout shift.
- Keep cached data under an error banner rather than replacing it.
- Optimistic UI needs a per-item pending, then failed-with-retry, state.
- Distinguish "loading" from "not found yet" for deep links to data still syncing.
- Test with DevTools offline AND with a working network but a dead backend.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine · https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy

## Focus management and accessibility parity on navigation

On every screen change, move focus to the new screen's heading, update `document.title` and `aria-current`, and on Back return focus to the element that opened the screen. Show focus rings only for keyboard use (`:focus-visible`), and don't autofocus text inputs on touch devices: it pops the keyboard.

```ts
export function onScreenShown(title: string, openerId?: string): void {
  document.title = title;
  const opener = openerId ? document.getElementById(openerId) : null; // lists re-render: find it again by id
  if (opener) { opener.focus({ preventScroll: true }); return; } // Back: return to where we came from
  const h = document.querySelector<HTMLElement>('main h1');
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
}
// Autofocus a composer only with a precise pointer (no keyboard pop on phones)
if (matchMedia('(pointer: fine)').matches) composer.focus();
```

```css
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
```

**Support:** `:focus-visible`: Chrome 86, Firefox 85, Safari 15.4. `focus({ preventScroll })`: all current browsers. `focus({ focusVisible })`: Chrome 145, Firefox 104, Safari 18.4.

**Gotchas:**
- Store the opener's id, not the element, across async renders.
- Don't steal focus on background updates (new messages); announce them through a polite live region.
- A `tabindex="-1"` heading needs no visible ring (`:focus-visible` usually doesn't match programmatic focus after a click).
- A skip link and landmarks (`nav`, `main`, labelled `aside`) are the screen-reader equivalent of a tab bar.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible · https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/

## forced-colors and prefers-contrast

In forced-colors mode (Windows contrast themes) the UA replaces your colours with system colours and drops box-shadows and background images; `prefers-contrast` reflects "Increase contrast" on macOS/iOS and similar settings. Native controls adapt automatically; web focus rings, selected tabs or toggles drawn only with shadows or background colours vanish.

```css
/* Focus ring that survives forced colors: the shadow disappears there, the transparent outline becomes visible */
:focus-visible { outline: 2px solid transparent; outline-offset: 2px; box-shadow: 0 0 0 3px var(--focus); }

@media (forced-colors: active) {
  .btn, .chip, .segmented label { border: 1px solid ButtonText; }
  [aria-current='page'], [aria-selected='true'], .segmented label:has(:checked) { outline: 2px solid Highlight; }
  .icon { fill: currentColor; }
}
@media (prefers-contrast: more) {
  :root { --border: CanvasText; --text-muted: var(--text); }
  .header { -webkit-backdrop-filter: none; backdrop-filter: none; background: var(--surface); }
}
```

**Support:** `forced-colors`: Chrome 89, Firefox 89, Safari 16. `forced-color-adjust`: Chrome 89, Firefox 113, not Safari. `prefers-contrast`: Chrome 96, Firefox 101, Safari 14.1 / iOS 14.5.

**Gotchas:**
- Box-shadow-only focus rings vanish in forced colors unless you add the transparent outline.
- `forced-color-adjust: none` only where colour is the content (swatches, avatars).
- Use system colour keywords (`Canvas`, `CanvasText`, `ButtonText`, `Highlight`, `LinkText`).
- Test with Chromium DevTools' forced-colors emulation.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors · https://blogs.windows.com/msedgedev/2020/09/17/styling-for-windows-high-contrast-with-new-standards-for-forced-colors/

## RTL: logical properties, dir=auto, mirrored gestures and icons

Lay out with logical properties, set `dir` on `<html>` from the locale, use `dir="auto"` on user-generated text and `<bdi>` around names, and mirror directional icons, drawer sides, and the swipe-back direction and edge. In RTL locales native apps mirror the whole navigation model.

```html
<html lang="ar" dir="rtl">
<p dir="auto">…user message…</p>
<span><bdi>…user name…</bdi> joined</span>
```

```css
.row { padding-inline: 16px; border-inline-start: 3px solid var(--accent); }
.drawer { inset-inline-start: 0; }
.icon-back:dir(rtl), .icon-chevron-forward:dir(rtl) { transform: scaleX(-1); }
```

```ts
const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
const closeSwipe = rtl ? 'left' : 'right'; // swipe-right-to-close becomes swipe-left
const drawerTranslate = (x: number): string => `translateX(${rtl ? -x : x}px)`; // transforms don't flip automatically
```

**Support:** Logical properties: all current browsers. `:dir()`: Chrome 120, Firefox 49, Safari 16.4. `dir="auto"` and `<bdi>`: everywhere.

**Gotchas:**
- Don't mirror media playback controls, clocks, checkmarks or logos; numbers and code stay LTR.
- Gesture code (drag x, edge zones) and keyframes that slide on x must flip.
- (unverified) Whether the iOS standalone system back swipe moves to the right edge in RTL: test on a device set to an RTL language.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/:dir · https://m3.material.io/foundations/layout/understanding-layout/bidirectionality-rtl · https://developer.apple.com/design/human-interface-guidelines/right-to-left

## Keyboard shortcuts and a command palette on desktop

Use platform-correct modifiers (Cmd on Apple, Ctrl elsewhere), single-key shortcuts only outside text fields, a ⌘K/Ctrl+K command palette, a `?` shortcut sheet, `aria-keyshortcuts` on controls, and key hints only where a keyboard is likely. Desktop-class apps are keyboard-driven; Ctrl shown to Mac users signals a website.

```ts
const isApple = /Mac|iPhone|iPad/.test(navigator.platform); // deprecated, but the only cross-browser signal
addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.isComposing || e.defaultPrevented) return; // IME composition, or handled by a field
  const mod = isApple ? e.metaKey : e.ctrlKey;
  const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  else if (!typing && !mod && e.key === '/') { e.preventDefault(); focusSearch(); }
  else if (!typing && e.key === '?') openShortcutSheet();
});
```

```html
<button aria-keyshortcuts="Meta+K Control+K">Search <kbd class="hint">⌘K</kbd></button>
<!-- Palette: <dialog> + <input role="combobox" aria-expanded="true" aria-controls="results" aria-activedescendant="…"> + <ul id="results" role="listbox"> -->
```

```css
@media not ((hover: hover) and (pointer: fine)) { kbd.hint { display: none; } }
```

**Support:** `KeyboardEvent.key`/`code`/`isComposing`: everywhere. `navigator.userAgentData`: Chromium only. Keyboard Lock: Chromium only, effective only in fullscreen. `aria-keyshortcuts`: exposed by major screen readers to varying degrees.

**Gotchas:**
- Browser-reserved combos (Cmd/Ctrl+W, T, N, L, Tab, Cmd+Q) can't be reliably overridden in a tab.
- `e.key` for characters, `e.code` for physical positions (WASD).
- Shortcuts must not fire during IME composition.
- iPad with a hardware keyboard can't list web shortcuts in the system ⌘-hold overlay.
- Show key hints only on wide, pointer-fine layouts.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing · https://www.w3.org/WAI/ARIA/apg/patterns/combobox/

## Context menus: right-click, keyboard and long-press, not on content

Give app objects (messages, files, rows) a custom menu on right-click, the ContextMenu key or Shift+F10, and long-press on touch. Keep the browser's menu on text, links, images and inputs inside content. A "Save image as / Inspect" menu on an app object is a tell; killing copy/paste on content is worse. Long-press timing and haptics: touch-gestures-input.md.

```ts
row.addEventListener('contextmenu', (e: MouseEvent) => {
  if (e.target instanceof Element && e.target.closest('a, img, input, textarea, [contenteditable], .selectable')) return; // native menu there
  e.preventDefault();
  // Keyboard-invoked menus report clientX/Y 0: anchor to the element instead
  const r = row.getBoundingClientRect();
  openMenuAt(e.clientX || r.left + 16, e.clientY || r.bottom, item);
});
// iOS Safari never fires contextmenu: add a long-press with pointer events
// (field-tested: ~450ms hold, cancelled once the finger moves ~10px).
```

```css
.row { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; } /* no iOS callout or selection on long-press */
```

**Support:** `contextmenu`: all desktop browsers and Chrome/Firefox Android (fires on touch long-press); not Safari iOS. `-webkit-touch-callout`: Safari iOS only.

**Gotchas:**
- On Android both `contextmenu` and your long-press timer fire: dedupe, or use `contextmenu` as the Android long-press.
- Give haptic feedback when the long-press triggers (where supported).
- (unverified) An Apple Developer Forums thread reports `-webkit-touch-callout: none` not working in iOS 26.1 for some elements: test link and image long-press.
- Every context-menu action must also be reachable another way (an overflow button).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event · https://developer.apple.com/forums/thread/808606

## Text selection off on app chrome, on in content

Make buttons, tabs, toolbars, headers and nav non-selectable, without the iOS callout and without image dragging; explicitly keep selection on message bodies, documents and every input. A blue selection or "Copy | Look Up" bubble from long-pressing a tab is one of the most recognisable phone tells.

```css
nav, header, .toolbar, .tabbar, button, [role=button], [role=tab], label {
  -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none;
}
.content, .message-body, .doc, input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; }
img.icon, .logo, nav img { -webkit-user-drag: none; } /* plus draggable="false" on the <img> for Firefox */
@media (pointer: fine) { .toolbar button, .tabbar a { cursor: default; } } /* optional desktop-native arrow */
```

**Support:** `user-select`: Chrome 54, Firefox 69; Safari macOS and iOS need `-webkit-user-select` (unprefixed only in Technology Preview). `-webkit-touch-callout`: Safari iOS only. `-webkit-user-drag`: Chromium and Safari.

**Gotchas:**
- Never put `user-select: none` on `body` or app-wide: it blocks copying and can break assistive tech.
- (unverified for current iOS, cheap insurance) An inherited `-webkit-user-select: none` has historically made fields inside it uneditable on iOS: always re-enable on fields.
- `cursor: default` vs `pointer` is a deliberate choice: be consistent.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/user-select · https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-touch-callout

## Hover effects and tooltips only on hover-capable pointers

Gate `:hover` styles and hover tooltips behind `@media (hover: hover) and (pointer: fine)`. Tooltips also show on keyboard focus; on touch, use visible labels or long-press. Prefer `interestfor` + `popover="hint"` where available with a small fallback. Sticky hover after a tap on iOS is a tell. The full hover/active media-query rules are owned by touch-gestures-input.md.

```css
@media (hover: hover) and (pointer: fine) { .btn:hover { background: var(--hover); } }
```

```html
<button id="mute" interestfor="tip-mute" aria-describedby="tip-mute"><svg aria-hidden="true">…</svg><span class="sr-only">Mute</span></button>
<div id="tip-mute" popover="hint" role="tooltip">Mute (⌘⇧M)</div>
```

```ts
// Fallback where interest invokers are missing (the detect property name changed during incubation: verify)
const btn = document.getElementById('mute');
const tip = document.getElementById('tip-mute');
if (btn && tip && !('interestForElement' in HTMLButtonElement.prototype)) {
  const show = (): void => { if (!tip.matches(':popover-open')) tip.showPopover(); };
  const hide = (): void => { if (tip.matches(':popover-open')) tip.hidePopover(); };
  btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(); });
  btn.addEventListener('pointerleave', hide);
  btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) show(); });
  btn.addEventListener('blur', hide);
}
```

**Support:** `hover`/`pointer` media: everywhere (some Samsung devices wrongly match `hover: hover`). `popover="hint"`: Chrome 151, Firefox 153; Safari Technology Preview only. `interestfor`: Chromium 142 only (experimental, non-standard in BCD). Browsers without `hint` treat it as `manual`, so the fallback must hide it.

**Gotchas:**
- A tooltip is never the only label: icon-only buttons need an accessible name.
- Don't use `title=` for important info: invisible on touch and to keyboard users.
- ~500ms delay in, instant between adjacent controls; dismiss on Esc.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover · https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover

## Adapt to display-mode: installed vs browser tab

Detect whether the app runs installed (standalone, window-controls-overlay, tabbed) or in a tab, and adapt: hide install prompts, show in-app back and close controls, pad for safe areas, reserve the title bar. An installed app that nags "Install our app", or has no way back on iOS, breaks the illusion. Install prompts and standalone detection details: install-and-identity.md.

```css
@media (display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: tabbed) {
  .install-cta { display: none; }
  .screen-back { display: inline-flex; }
}
```

```ts
const installedQuery = matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)');
export const isInstalled = (): boolean =>
  installedQuery.matches || ('standalone' in navigator && navigator.standalone === true); // legacy iOS flag
installedQuery.addEventListener('change', () => setInstalled(isInstalled()));
```

**Support:** `display-mode` media: Chrome 42, Firefox 47, Safari 13 / iOS 12.2. `navigator.standalone`: Safari iOS only, non-standard. iOS/iPadOS 26+: Home Screen sites open as web apps by default. Firefox 143+ on Windows: taskbar web apps that keep an address bar.

**Gotchas:**
- `display: minimal-ui` isn't supported by Safari or desktop Firefox (falls back to `browser`).
- The display mode can change at runtime (a tab moved into an app window): listen for changes.
- Don't UA-sniff for "is a phone".
- Test the installed app separately on each OS: storage, links and the status bar differ from the tab.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/@media/display-mode · https://support.mozilla.org/en-US/kb/web-apps-firefox-windows

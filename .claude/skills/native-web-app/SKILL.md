---
name: native-web-app
description: "Make any web app or PWA feel native on phones, tablets and desktops, in any framework. Load it whenever you build, review or audit a web app, PWA or mobile web UI, or work on mobile friendliness, the viewport meta, safe areas and the notch, 100vh, the on-screen keyboard covering inputs, iOS focus zoom, overscroll and pull-to-refresh, touch gestures (swipe, long-press, Pointer Events, touch-action), tap highlight, sticky hover, haptics, installability and the web app manifest, icons, splash screens, theme-color, install prompts and Add to Home Screen, standalone mode, service workers, offline and caching, app updates, Web Push and notifications, app badges, storage persistence, background suspension and state restore, the Android back button and history for overlays (dialog, CloseWatcher), app-like navigation and View Transitions, reduced motion, dark mode, or native device APIs (share, clipboard, wake lock, media session, passkeys, file pickers)."
---

# Native-feeling web apps

The entry point for making a web app or PWA feel like an installed native app on iOS/iPadOS, Android and desktop,
in any framework. This file gives the tells, the principles, the workflow, the master checklist and where to look;
the details (snippets, support, gotchas, sources) live in `references/`, and drop-in code lives in `templates/`.

- **Building something new:** follow [Workflow (a)](#a-new-app), copying `templates/` instead of writing from scratch.
- **Reviewing or auditing:** follow [Workflow (b)](#b-auditing-an-existing-app), then walk the [checklist](#master-checklist).
- **One question ("how do I stop X?"):** find the row in the [API table](#which-api-for-which-native-feeling) or the
  [index](#index), then read that reference file's section before writing code.

Support data is as of 2026-10-02 (MDN browser-compat-data 8.1.4: Chrome 154, Safari/iOS 27, Firefox 157). Versions are
the first supporting release. "Chromium" means Chrome and Edge (Samsung Internet lags behind). Anything shipped in the
last year can still change: feature-detect it, and re-check before you make it load-bearing.

## What "feels native" means

A native app never reminds you it is a web page. These are the web tells to eliminate, and what removes each one.

| Web tell | What removes it |
|---|---|
| URL bar and browser chrome around the app | Manifest with `display: standalone`, an install path, navigations kept inside `scope` |
| White or wrong-colour flash on launch or theme switch; light scrollbars and controls in dark mode | `background_color` = `theme_color` = page surface, `color-scheme` and `light-dark()`, theme applied by an inline script before first paint |
| Grey rectangle flashing on every tap | `-webkit-tap-highlight-color: transparent` plus real, instant `:active` states |
| Whole page rubber-banding, accidental pull-to-refresh, lists dragging the page | Locked app shell, `overscroll-behavior: none` on the root, `contain` on inner scrollers |
| Page zooms into a focused field; double-tap zooms | 16px fields on coarse pointers, `touch-action: manipulation` (never `maximum-scale`) |
| Keyboard covers the input or composer | `interactive-widget=resizes-content` (Android), `visualViewport` sizing (iOS) |
| Hover styles stuck after a tap; two taps needed on iOS | Hover rules only inside `@media (hover: hover) and (pointer: fine)` |
| Content under the notch or home indicator; bottom bar hidden by the browser toolbar | `viewport-fit=cover` plus `env(safe-area-inset-*)` padding; `dvh`/`svh` instead of `100vh` |
| Layout jumps (late fonts and images, scrollbars appearing, content inserted above) | Reserved media sizes, font metric overrides, `scrollbar-gutter`, scroll anchoring |
| Slow or dead-feeling taps | Visible response in the next frame, optimistic UI, work after paint |
| Spinners and blank screens | App shell from HTML and cache, skeletons that appear only after a delay |
| Back button or gesture leaves the app instead of closing the open sheet | `<dialog>`/popover, `CloseWatcher`, one history entry per overlay |
| State lost after relaunch (the OS killed the backgrounded app) | Save on `visibilitychange` to hidden; restore route, scroll and drafts |
| The browser's offline error page | Precaching service worker plus designed offline states |
| Page reloads mid-typing after a deploy | Update on prompt (`SKIP_WAITING`), never silently under the user |
| Generic, letterboxed or black-cornered icon | Icons from one SVG, a separate maskable icon, an opaque 180×180 `apple-touch-icon` |
| Permission prompts on load | Ask in context, from a tap, after explaining why |
| Selectable buttons, iOS callout on long-press, ghost image drags, I-beam cursors, focus rings after taps | `user-select: none` and `-webkit-touch-callout: none` on chrome only, `draggable="false"` on UI images, `cursor: default`, `:focus-visible` |
| Keyboard pops up on load; wrong keyboard or Return key | Autofocus only with a fine pointer; `inputmode`, `enterkeyhint`, `autocomplete` |
| Text inflating in landscape, or ignoring the user's text size | `text-size-adjust: 100%`, rem sizes, Dynamic Type opt-in on iOS |
| Abrupt screen swaps, or motion that ignores Reduce Motion | View Transitions with push/pop direction, `prefers-reduced-motion` handling |
| A notification tap opens a second window or reloads the app | `notificationclick` focuses the existing window and routes in place |

## Core principles

1. **Progressive enhancement:** feature-detect every API and ship a fallback; UA checks only for platform hints (iOS install steps, iPadOS via `maxTouchPoints`).
2. **Platform components first:** `<dialog>`, `popover`, `<select>`, date inputs, scroll snap, the share sheet and `system-ui` before any JS re-implementation.
3. **Permissions in context:** explain where the feature lives, prompt from that tap, render every state (unsupported, prompt, granted, denied); never on load.
4. **Respect user activation:** gated calls run synchronously in `click`/`pointerup`/`keydown` with no `await` first; a touch `pointerdown` is not an activation.
5. **Pure decisions, thin wiring:** keyboard math, gesture thresholds, install path and worker decisions are pure and unit-tested; DOM and worker glue only wires events.
6. **Test what ships:** E2E the production build with its service worker in desktop and phone projects, then real devices for what emulation can't show.
7. **Respect user settings:** reduced motion (remove movement, keep feedback), colour scheme, contrast, forced colours, text size, in-app haptics and sound toggles.
8. **Accessibility parity:** never block zoom; every gesture has a visible or keyboard alternative; focus follows navigation; 44px touch targets.
9. **Assume the OS kills you:** mobile OSes suspend and silently kill backgrounded apps, so save on hidden, put screens in URLs, restore on relaunch, resync on resume.
10. **External input is `unknown`:** validate push payloads, messages, launch URLs, storage reads and URL params with a schema; parsers never throw.
11. **Capability and window size, not device:** `pointer`/`hover` media queries, width breakpoints, container queries.
12. **First frame from HTML and cache, not JS:** the shell paints before any script runs, and launch works offline.
13. **Never trap the user:** no history sentinels, no blocked Back; leave the app's scope only on purpose.
14. **Each platform's conventions:** Cmd vs Ctrl, sheets on touch vs anchored menus on desktop, Back on Android, edge swipe on iOS.
15. **Ship for the oldest OS you serve:** iOS web features arrive only with iOS updates.

## Workflow

### (a) New app

Do these in order; each step names the template to copy and the reference that explains it.

1. **Shape.** App-like UI (chat, tools, dashboards): a locked shell; the document never scrolls, each pane scrolls
   itself. Content site: the document scrolls and screens use `min-height: 100svh`. `templates/native.css` covers both.
2. **Head.** Copy `templates/head.html` and set every ADAPT value; its colours must equal your page background.
3. **Manifest and icons.** Copy `templates/manifest.webmanifest`, read `templates/manifest.md`: `id`, `scope`,
   `start_url`, `display`, colours, every icon from one SVG. `references/install-and-identity.md`.
4. **CSS baseline.** Copy `templates/native.css`: tokens, shell, safe areas, press and hover, selection, 16px fields,
   system type, focus rings, dialogs and sheets, installed-app modes, reduced motion.
5. **Keyboard.** Call `track()` from `templates/viewport.ts` once at startup. `references/viewport-keyboard-safe-areas.md`.
6. **Navigation and Back.** History model (push / replace / none), an in-app back button with an Up fallback,
   `<dialog>`/`popover` for overlays, `templates/overlay-history.ts` for custom ones. `references/navigation-ui-patterns.md`.
7. **Touch and input.** `templates/gestures.ts` (swipe, long-press, iOS `:active`, context menu), `templates/haptics.ts`
   behind a setting, keyboard hints on every field. `references/touch-gestures-input.md`.
8. **Service worker.** `templates/sw.ts`, `templates/sw-logic.ts` (pure, unit-tested) and `templates/sw-client.ts`
   (register, update prompt, chunk-error reload). `references/offline-push-storage.md`.
9. **Lifecycle.** `watchLifecycle()` from `templates/lifecycle.ts`: save on hidden, resync on resume, restore on relaunch.
10. **Install.** `templates/install.ts`: `watchInstall()` before the UI mounts, `promptInstall()` inside the Install
    button's click handler, iOS/macOS steps, badge, `launchQueue`.
11. **Then, as needed:** push (permission UX, subscribe from a click), motion (`references/motion-performance.md`) and
    device features (`references/device-apis.md`), each feature-detected with a fallback.
12. **Tests.** Unit-test the pure modules, E2E the production build in desktop and phone projects, run the device
    checklist (`references/platform-quirks-testing.md`), then walk the [master checklist](#master-checklist).

**With Vite/React:** build the worker with vite-plugin-pwa (`strategies: 'injectManifest'`, `registerType: 'prompt'`)
and run E2E against `vite preview`, since the dev server has no worker; handle `vite:preloadError` for stale chunks.
In React, keep decisions out of components and return the templates' cleanup functions from effects; `useOptimistic`
covers optimistic UI and `<Activity mode="hidden">` (19.2+) keeps previous screens alive.

### (b) Auditing an existing app

1. **Run the real thing:** build for production, serve it, and open it on a phone (or emulator) both in a browser tab
   and installed. Open DevTools > Application (manifest, computed App Id, installability, service worker, storage).
   Lighthouse no longer has a PWA category; don't use it as the verdict.
2. **Inventory with grep** (add `-g '!node_modules' -g '!dist'` as needed). Each hit is a question, not a verdict:

```sh
rg -n 'maximum-scale|user-scalable|name="viewport"'           # zoom blocked? viewport meta complete?
rg -n '100vh|-webkit-fill-available|innerHeight|window\.orientation|-webkit-overflow-scrolling'  # stale height hacks
rg -n ':hover'                       # each inside @media (hover: hover) and (pointer: fine)?
rg -n 'tap-highlight|touch-action|overscroll-behavior|user-select|touch-callout|safe-area-inset'  # present at all?
rg -n 'font-size' -g '*.{css,scss,less}'                       # form fields under 16px on touch?
rg -n 'touchstart|touchmove|mousedown|passive'                 # Pointer Events? passive listeners?
rg -n 'position: *fixed'                                       # bottom bars that the iOS keyboard will cover
rg -n '<input|<textarea' | rg -v 'inputmode|enterkeyhint|autocomplete'   # fields without keyboard hints
rg -n 'autofocus|autoFocus|\.focus\('                          # keyboard popping on touch?
rg -n 'pushState|replaceState|popstate|hashchange|CloseWatcher|showModal|popover'  # back model for overlays
rg -n 'target="_blank"|window\.open'                           # leaving scope deliberately?
rg -n 'manifest|apple-touch-icon|apple-mobile-web-app|theme-color|color-scheme|beforeinstallprompt|standalone'
rg -n 'serviceWorker|skipWaiting|clientsClaim|precache|workbox' # update flow? silent skipWaiting?
rg -n 'new Notification|requestPermission|pushManager|showNotification|getNotifications|setAppBadge'
rg -n 'beforeunload|unload|visibilitychange|pagehide|pageshow' # saving on unload?
rg -n 'localStorage|indexedDB|storage\.persist|caches\.open'   # persistence, eviction, validated reads
rg -n 'getUserMedia|geolocation|vibrate|navigator\.share|clipboard|wakeLock|requestFullscreen|mediaSession'
rg -n 'transition: *all|will-change|prefers-reduced-motion|startViewTransition'
rg -n 'userAgent|navigator\.platform'                          # features chosen by UA sniffing?
```

3. **Walk the [master checklist](#master-checklist)** area by area. Mark each item pass / fail / n/a with file:line
   evidence; read the owner reference for anything that fails.
4. **Report and fix** musts first, then by user impact (Back, keyboard, launch flash and lost state hurt most).
5. **Device pass:** the real-device checklist in `references/platform-quirks-testing.md`.

## Master checklist

Every must, plus the shoulds that pay off most. The link at the end of each line is the owner reference.

### Shell, viewport and keyboard

- [ ] **must** — One viewport meta: `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content` → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **must** — Never `maximum-scale` or `user-scalable=no`: pinch zoom stays → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **must** — Form fields at least 16px on coarse pointers (stops iOS focus zoom); desktop keeps its denser size → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **must** — No `100vh` screens: `dvh`/`svh`, or the locked shell's `100%` → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **must** — App-like UIs use a locked shell: the document never scrolls, bars are in-flow grid rows, each pane scrolls itself → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **must** — Pad chrome with `env(safe-area-inset-*)` tokens and `max()`; backgrounds bleed to the edges → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **must** — Handle the keyboard per platform: Android resizes (meta opt-in), iOS pans, so size the shell to `visualViewport` only while a keyboard is up → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **must** — `overscroll-behavior: none` on the root and `contain` on inner scrollers: no bounce, pull-to-refresh or chaining → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **should** — Keep the focused field visible by scrolling only its pane; `scroll-padding` clears sticky bars → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **should** — Auto-growing composer with `field-sizing: content` (JS fallback) → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **should** — Chat and timeline lists open at, and stay pinned to, the newest item → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **should** — Layout by window width and container queries (list-detail side by side from about 768px), not by device → [viewport](references/viewport-keyboard-safe-areas.md)
- [ ] **should** — iOS: pick the Home Screen status-bar style deliberately; Safari 26+ tab toolbars tint from edge-hugging fixed/sticky elements → [viewport](references/viewport-keyboard-safe-areas.md)

### Touch, gestures and input

- [ ] **must** — Pointer Events as the one input model; custom gestures only for `pointerType === 'touch'` → [touch](references/touch-gestures-input.md)
- [ ] **must** — Declare `touch-action`: `manipulation` on the root, `pan-y pinch-zoom` on swipe rows, `none` only on handles → [touch](references/touch-gestures-input.md)
- [ ] **must** — Listeners passive by default; `passive: false` only where you really cancel scrolling → [touch](references/touch-gestures-input.md)
- [ ] **must** — Lock a gesture to one axis after about 10px of slop: a mostly vertical drag is a scroll → [touch](references/touch-gestures-input.md)
- [ ] **must** — Leave screen edges to the OS back gestures; every swipe also has a visible button → [touch](references/touch-gestures-input.md)
- [ ] **must** — Long-press (about 450-500ms, cancelled by movement) opens your menu on touch instead of the iOS callout or Android menu → [touch](references/touch-gestures-input.md)
- [ ] **must** — No grey tap flash; every tappable element gets an instant `:active` state (iOS needs a touchstart listener) → [touch](references/touch-gestures-input.md)
- [ ] **must** — Hover styles only inside `@media (hover: hover) and (pointer: fine)` → [touch](references/touch-gestures-input.md)
- [ ] **must** — Hit targets at least 44×44 CSS px on coarse pointers, with invisible hit-area expansion for small icons → [touch](references/touch-gestures-input.md)
- [ ] **must** — Gated work (audio, vibrate, keyboard focus) in `click`/`pointerup`, never touch `pointerdown` → [touch](references/touch-gestures-input.md)
- [ ] **must** — No autofocus on touch; focus synchronously inside the tap; refocus after send so the keyboard stays → [touch](references/touch-gestures-input.md)
- [ ] **must** — Every field declares `type`, `inputmode`, `enterkeyhint` and `autocomplete` → [touch](references/touch-gestures-input.md)
- [ ] **must** — UI chrome not selectable (with `-webkit-user-select`); content and fields stay selectable → [touch](references/touch-gestures-input.md)
- [ ] **should** — Swipes complete on distance or a fast flick (velocity over the last ~80ms), with rubber-band resistance → [touch](references/touch-gestures-input.md)
- [ ] **should** — Haptics via `navigator.vibrate` behind a settings toggle and reduced motion; never the only signal → [touch](references/touch-gestures-input.md)
- [ ] **should** — Unlock audio on the first tap (resume one `AudioContext`, prime the media elements you'll reuse) → [touch](references/touch-gestures-input.md)
- [ ] **should** — Desktop parity: right-click menus, hover action bars, Cmd/Ctrl shortcuts, layer-aware Escape, `:focus-visible` → [touch](references/touch-gestures-input.md)

### Navigation, Back and UI patterns

- [ ] **must** — Back (Android button or gesture, Esc) closes the topmost overlay first: `<dialog>`, `popover`, `CloseWatcher` → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — Without CloseWatcher (Safari), one history entry per open overlay, pushed inside the opening tap; never push after a Back → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — Classify state changes: new screen = push, refinement = replace, transient = no history entry → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — Deep links rebuild the full screen; URL parsers drop bad parts and never throw → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — In-app back button that goes Up to the parent when there is no in-app history (cold launch, notification, shared link) → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — Full-screen panels are history entries so the iOS edge swipe closes them; skip your animation when `hasUAVisualTransition` → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — Off-scope links open with `target="_blank" rel="noopener"`; the installed window never wanders off-scope → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — Adaptive navigation: bottom tab bar on compact widths, rail or sidebar on wider windows → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — `system-ui` font stack and rem sizes → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — `color-scheme`, `light-dark()` and `accent-color` so native controls match the theme → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — Dark mode follows the system, with a stored override applied before first paint and `theme-color` kept in sync → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — Modals are `<dialog>` with `showModal()` and `requestClose()`; menus are `popover` → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — `inert` on closed drawers and behind custom overlays → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — Designed empty, loading, error and offline states on every screen → [nav](references/navigation-ui-patterns.md)
- [ ] **must** — On screen change move focus to the heading, update `document.title` and `aria-current`; restore focus on Back → [nav](references/navigation-ui-patterns.md)
- [ ] **should** — Navigation API as the router core, with a History API fallback → [nav](references/navigation-ui-patterns.md)
- [ ] **should** — Action sheets on touch, anchored menus on desktop; native pickers (`<select>`, date inputs, `showPicker()`) → [nav](references/navigation-ui-patterns.md)
- [ ] **should** — Toasts in the top layer, inside safe areas, announced through a polite live region → [nav](references/navigation-ui-patterns.md)
- [ ] **should** — Survive `forced-colors` and `prefers-contrast`; RTL via logical properties and `dir="auto"` → [nav](references/navigation-ui-patterns.md)

### Motion and perceived performance

- [ ] **must** — View Transitions around visible state changes (feature-detected), typed push/pop for navigation direction → [motion](references/motion-performance.md)
- [ ] **must** — Springs via `linear()` easing; motion tokens with longer decelerating enters and shorter exits → [motion](references/motion-performance.md)
- [ ] **must** — Enter and exit animations for dialogs, popovers and sheets (`@starting-style`, `allow-discrete`); sheets drag down to dismiss → [motion](references/motion-performance.md)
- [ ] **must** — Dragged panels follow the finger 1:1 and finish from the release velocity → [motion](references/motion-performance.md)
- [ ] **must** — Animate only `transform`/`opacity` (or `translate`/`scale`); never `transition: all` → [motion](references/motion-performance.md)
- [ ] **must** — No layout thrash: batch reads before writes; observers instead of polling → [motion](references/motion-performance.md)
- [ ] **must** — Visible response in the next frame (INP ≤ 200ms); split long tasks with `scheduler.yield()` and a fallback → [motion](references/motion-performance.md)
- [ ] **must** — Optimistic UI, with undo instead of confirmation dialogs → [motion](references/motion-performance.md)
- [ ] **must** — Skeletons for content; loaders appear only after about 300-500ms; stale content stays visible → [motion](references/motion-performance.md)
- [ ] **must** — First frame from HTML and cache: inline shell and critical CSS → [motion](references/motion-performance.md)
- [ ] **must** — No font-swap layout shift (metric overrides, or system fonts); iOS Dynamic Type opt-in → [motion](references/motion-performance.md)
- [ ] **must** — `prefers-reduced-motion`: remove slides, zooms and parallax, keep fades and state feedback → [motion](references/motion-performance.md)
- [ ] **should** — Keep previous screens alive (hidden, inert) so Back is instant and keeps scroll → [motion](references/motion-performance.md)
- [ ] **should** — Preload the likely next screen (Speculation Rules for multi-page apps, intent preloading for SPAs) → [motion](references/motion-performance.md)
- [ ] **should** — `content-visibility: auto` for long feeds; heavy CPU work in Web Workers → [motion](references/motion-performance.md)

### Install and identity

- [ ] **must** — One complete manifest linked from every page (name, short_name, description, start_url, scope, display, colours, icons) → [install](references/install-and-identity.md)
- [ ] **must** — An explicit, path-qualified `id` from day one: changing it later creates a second app → [install](references/install-and-identity.md)
- [ ] **must** — `start_url` inside `scope`, and both inside the service worker's scope → [install](references/install-and-identity.md)
- [ ] **must** — `display: standalone` always; richer modes only in `display_override` → [install](references/install-and-identity.md)
- [ ] **must** — Icons from one SVG: 192 and 512 `any`, a separate 512 `maskable`, favicons, one opaque 180×180 `apple-touch-icon` → [install](references/install-and-identity.md)
- [ ] **must** — `background_color`, `theme_color` and meta `theme-color` (per scheme) equal the page background → [install](references/install-and-identity.md)
- [ ] **must** — Apple tags: `apple-mobile-web-app-title`, `-status-bar-style`, `-capable`, plus `mobile-web-app-capable` → [install](references/install-and-identity.md)
- [ ] **must** — Chromium: capture `beforeinstallprompt`, prompt from your own button, react to `appinstalled` → [install](references/install-and-identity.md)
- [ ] **must** — Elsewhere show platform-correct steps (iOS Add to Home Screen, macOS Add to Dock); detect iPadOS by touch points → [install](references/install-and-identity.md)
- [ ] **must** — Suggest installing once, at a moment of value, never on first load and never inside the installed app → [install](references/install-and-identity.md)
- [ ] **must** — Detect the installed app with display-mode queries plus `navigator.standalone`, and watch for changes → [install](references/install-and-identity.md)
- [ ] **should** — App icon badge with `setAppBadge()` → [install](references/install-and-identity.md)
- [ ] **should** — Rich install dialog (description, screenshots with `form_factor`), app shortcuts, share target where it fits → [install](references/install-and-identity.md)
- [ ] **should** — Single-window launches with `launch_handler` and `launchQueue` → [install](references/install-and-identity.md)
- [ ] **should** — Plan manifest changes: iOS freezes name and icon at install; Chromium asks users to confirm changes → [install](references/install-and-identity.md)

### Offline, updates, push, storage and lifecycle

- [ ] **must** — Precache the hashed app shell so every launch comes from disk → [offline](references/offline-push-storage.md)
- [ ] **must** — A runtime caching strategy per resource type, with expiry; personal and streaming data stay network-only → [offline](references/offline-push-storage.md)
- [ ] **must** — Updates on prompt: waiting worker, "Reload" toast, `SKIP_WAITING`, reload once → [offline](references/offline-push-storage.md)
- [ ] **must** — `sw.js` served `no-cache` at a URL that never changes; a kill-switch worker ready → [offline](references/offline-push-storage.md)
- [ ] **must** — Delete outdated precaches and unknown runtime caches on activate → [offline](references/offline-push-storage.md)
- [ ] **must** — Recover from chunk-load errors after a deploy: save state, reload once → [offline](references/offline-push-storage.md)
- [ ] **must** — Push: subscribe from a click with `userVisibleOnly: true`; every push shows a notification → [offline](references/offline-push-storage.md)
- [ ] **must** — Notifications through `registration.showNotification()` (feature-detected), never `new Notification()` on mobile → [offline](references/offline-push-storage.md)
- [ ] **must** — `notificationclick` focuses the open window and routes in place; opens a window only if none exists → [offline](references/offline-push-storage.md)
- [ ] **must** — Notification permission UI covers unsupported (iOS tab: install first), default, denied and granted → [offline](references/offline-push-storage.md)
- [ ] **must** — `navigator.storage.persist()` once data is worth keeping; a server copy or export survives Safari's 7-day eviction → [offline](references/offline-push-storage.md)
- [ ] **must** — iOS Home Screen apps don't share Safari's storage: onboard and sign in inside the installed app → [offline](references/offline-push-storage.md)
- [ ] **must** — IndexedDB: validate every read, strict durability for writes you can't lose, reopen dropped connections → [offline](references/offline-push-storage.md)
- [ ] **must** — Connection state from `navigator.onLine` plus your transport (offline / reconnecting / online), retries with backoff and jitter → [offline](references/offline-push-storage.md)
- [ ] **must** — Save on `visibilitychange` to hidden (and debounced while typing), never on `unload` → [offline](references/offline-push-storage.md)
- [ ] **must** — Restore route, scroll anchor and drafts on a cold relaunch → [offline](references/offline-push-storage.md)
- [ ] **must** — On resume assume dead sockets and frozen timers: reconnect, resync from the last cursor, check for updates → [offline](references/offline-push-storage.md)
- [ ] **should** — Check for updates during long sessions (on becoming visible, throttled) → [offline](references/offline-push-storage.md)
- [ ] **should** — Outbox in IndexedDB; Background Sync where it exists, flush on online/visible/launch everywhere → [offline](references/offline-push-storage.md)
- [ ] **should** — Keep push subscriptions alive; close read notifications and keep the badge in sync → [offline](references/offline-push-storage.md)
- [ ] **should** — One leader tab via Web Locks, state fan-out via BroadcastChannel → [offline](references/offline-push-storage.md)
- [ ] **should** — No state in worker globals; every async job inside `waitUntil()` → [offline](references/offline-push-storage.md)
- [ ] **should** — Stay bfcache-eligible: no `unload`, close sockets on `pagehide`, reopen on `pageshow` → [offline](references/offline-push-storage.md)

### Device APIs and permissions

- [ ] **must** — Ask for permissions in context from a tap after explaining; on denial show how to re-enable → [device](references/device-apis.md)
- [ ] **must** — Read `navigator.permissions.query()` to choose the UI without prompting, and watch `change` → [device](references/device-apis.md)
- [ ] **must** — Know which APIs need transient activation and call them synchronously from the gesture → [device](references/device-apis.md)
- [ ] **must** — Web Share via `navigator.share`/`canShare`, with a copy-link fallback (`AbortError` means cancelled) → [device](references/device-apis.md)
- [ ] **must** — Async Clipboard for copy; the `paste` event for pasted images and files → [device](references/device-apis.md)
- [ ] **must** — `<input type="file" accept capture>` for camera and photos on phones → [device](references/device-apis.md)
- [ ] **must** — Passkeys with conditional mediation (autofill) → [device](references/device-apis.md)
- [ ] **must** — `autocomplete="one-time-code"` on code fields, WebOTP on Android → [device](references/device-apis.md)
- [ ] **must** — Media Session metadata and action handlers for any audio, video or call → [device](references/device-apis.md)
- [ ] **should** — Screen Wake Lock, re-requested whenever the page becomes visible → [device](references/device-apis.md)
- [ ] **should** — Fullscreen and orientation lock only where supported (not iPhone, except `<video>`) → [device](references/device-apis.md)
- [ ] **should** — Camera through `getUserMedia` with `playsinline` and `facingMode`; Picture-in-Picture for call video → [device](references/device-apis.md)

### Testing and verification

- [ ] **must** — Platform decisions live in pure functions with injected inputs, unit-tested (property tests with a fixed seed for gesture math) → [platform](references/platform-quirks-testing.md)
- [ ] **must** — E2E against the production build: manifest, icons, service worker, offline start, notifications, axe → [platform](references/platform-quirks-testing.md)
- [ ] **must** — Desktop and phone (`isMobile`, `hasTouch`) projects; know what emulation can't show (keyboard, safe areas, standalone, iOS) → [platform](references/platform-quirks-testing.md)
- [ ] **must** — Debug installability in DevTools > Application and on phones via remote inspection → [platform](references/platform-quirks-testing.md)
- [ ] **must** — Real-device pass each release: iOS tab and Home Screen app (oldest and newest iOS you support), installed Android Chrome → [platform](references/platform-quirks-testing.md)

## Which API for which native feeling

Chromium = Chrome/Edge (desktop and Android unless noted). "Safari iOS" = a Safari tab unless noted; every iOS
browser behaves the same. Versions are first support; "yes" = long-standing.

| Native feeling | API / technique | Chromium | Safari iOS | Firefox | Reference |
|---|---|---|---|---|---|
| Own window and icon | Manifest `display: standalone` | Install from menu or prompt; real WebAPK on Android | Add to Home Screen (16.4+ from any iOS browser) | Android: menu install; desktop: Windows taskbar web apps only | [install](references/install-and-identity.md) |
| Your own Install button | `beforeinstallprompt` | yes | no: show steps | no | [install](references/install-and-identity.md) |
| Unread count on the icon | Badging API | Windows/macOS desktop; not Android | 16.4+ Home Screen app, after notification permission | no | [install](references/install-and-identity.md) |
| Custom desktop title bar | Window Controls Overlay | 105+ installed desktop | no | no | [install](references/install-and-identity.md) |
| One app window, links routed into it | `launch_handler` + `launchQueue` | 110+ | no | no | [install](references/install-and-identity.md) |
| Listed in the OS share sheet | Manifest `share_target` | Android installed; ChromeOS | no | no | [install](references/install-and-identity.md) |
| Instant, offline launch | Service worker + precache | yes | yes (11.3+) | yes | [offline](references/offline-push-storage.md) |
| Notifications while closed | Web Push + `showNotification()` | yes | 16.4+ Home Screen app only | yes | [offline](references/offline-push-storage.md) |
| Data that isn't evicted | `navigator.storage.persist()` | yes (silent heuristic) | 15.2+ (heuristic; 7-day eviction applies) | yes (prompts) | [offline](references/offline-push-storage.md) |
| Survive suspension | `visibilitychange`, `pagehide`/`pageshow` (+ `freeze`/`resume`) | yes (+ freeze/resume) | yes | yes | [offline](references/offline-push-storage.md) |
| Keyboard never covers the composer | `interactive-widget=resizes-content`; `visualViewport` | Android 108+ | not supported: use `visualViewport` | Android 133+ | [viewport](references/viewport-keyboard-safe-areas.md) |
| Edge to edge around notch and home bar | `viewport-fit=cover` + `env(safe-area-inset-*)` | Android 135+ edge-to-edge | yes | Android: yes | [viewport](references/viewport-keyboard-safe-areas.md) |
| Screens that fit the visible area | `svh` / `dvh` / `lvh` | 108+ | 15.4+ | 101+ | [viewport](references/viewport-keyboard-safe-areas.md) |
| No page bounce or pull-to-refresh | `overscroll-behavior` (+ locked shell) | yes | 16+ (a non-overflowing root can still bounce) | yes | [viewport](references/viewport-keyboard-safe-areas.md) |
| Growing message composer | `field-sizing: content` | 123+ | 26.2+ | 152+ | [viewport](references/viewport-keyboard-safe-areas.md) |
| View stays put as content loads above | Scroll anchoring | yes | 27+ | yes | [viewport](references/viewport-keyboard-safe-areas.md) |
| Swipe, drag, long-press | Pointer Events + `touch-action` | yes | 13+ | yes | [touch](references/touch-gestures-input.md) |
| No focus or double-tap zoom, pinch kept | 16px fields on touch; `touch-action: manipulation` | yes | yes (focus zoom is iOS behaviour) | yes | [touch](references/touch-gestures-input.md) |
| Haptic tick | `navigator.vibrate` | Android only, after a tap | no (only the switch-toggle trick, 18+) | no-op on Android; removed on desktop | [touch](references/touch-gestures-input.md) |
| Right keyboard and Return key | `inputmode`, `enterkeyhint`, `autocomplete` | yes | yes | yes | [touch](references/touch-gestures-input.md) |
| Native screen transitions | Same-document View Transitions | 111+ | 18+ | 144+ | [motion](references/motion-performance.md) |
| Page-to-page transitions (MPA) | `@view-transition` | 126+ | 18.2+ | no | [motion](references/motion-performance.md) |
| Spring motion | `linear()` easing | yes | 17.2+ | yes | [motion](references/motion-performance.md) |
| Dialog and popover enter/exit | `@starting-style` + `allow-discrete` | 117+ | 17.5+ | 129+ (no `display` transition) | [motion](references/motion-performance.md) |
| Collapsing large titles | Scroll-driven animations | 115+ | 26+ | flag only | [motion](references/motion-performance.md) |
| Stays responsive while busy | `scheduler.yield()` | 129+ | no (fallback needed) | 142+ | [motion](references/motion-performance.md) |
| Back closes the sheet | `<dialog>`/`popover`, `CloseWatcher`, history fallback | dialog/popover 120+, CloseWatcher 126+ | history fallback (no CloseWatcher in 27) | CloseWatcher 149+ | [nav](references/navigation-ui-patterns.md) |
| One router for links and back/forward | Navigation API | 102+ | 26.2+ | 147+ | [nav](references/navigation-ui-patterns.md) |
| Native controls in dark mode | `color-scheme`, `light-dark()` | yes | 17.5+ for `light-dark()` | yes | [nav](references/navigation-ui-patterns.md) |
| Share sheet | `navigator.share` | Android; Windows/ChromeOS/macOS desktop (not Linux) | yes | Android (no files); desktop behind a flag | [device](references/device-apis.md) |
| Copy and paste | Async Clipboard | yes | 13.1+ (reading shows a Paste callout) | yes (rich items 127+) | [device](references/device-apis.md) |
| Screen stays on | Screen Wake Lock | 84+ | 16.4+ (Home Screen apps 18.4+) | 126+ | [device](references/device-apis.md) |
| Lock-screen media controls | Media Session | yes | 15+ | desktop only | [device](references/device-apis.md) |
| Passkey autofill | WebAuthn conditional mediation | 108+ | 16+ | 119+ | [device](references/device-apis.md) |
| SMS code autofill | `autocomplete="one-time-code"`, WebOTP | WebOTP on Android | `one-time-code` suggestions | `autocomplete` only | [device](references/device-apis.md) |
| Full screen | `requestFullscreen()` | yes | iPad 16.4+; iPhone `<video>` only | yes | [device](references/device-apis.md) |

## Platform cheat sheet

The facts that bite most often. Fixes and the rest of the quirks: `references/platform-quirks-testing.md`.

### iOS and iPadOS

1. **Every iOS browser is WebKit:** Chrome, Firefox and Edge on iOS get Safari's features, and only with iOS updates
   (Safari 27 is current). Test the oldest iOS you support.
2. **No install prompt:** users install via Share > Add to Home Screen (from any iOS browser since 16.4); since iOS 26
   any site added opens as a web app unless the user opts out. iPadOS reports a Mac UA: check `maxTouchPoints > 1`.
3. **The Home Screen app is a separate container:** cookies, storage and push subscription aren't shared with Safari,
   and removing the icon deletes the data. Onboard and sign in inside the installed app.
4. **Push, notifications and badges only in Home Screen apps (16.4+),** with permission asked from a tap. In a tab
   `Notification` is undefined and the worker registration lacks `showNotification`/`getNotifications`.
5. **7-day eviction:** with tracking prevention on (the default), Safari deletes all script-written storage of a site
   not interacted with in 7 days of Safari use; server-set cookies are exempt. Keep a server copy or an export.
6. **The keyboard pans instead of resizing:** no `interactive-widget` (Safari 27), so `position: fixed` bottom bars end
   up under it; size the shell from `visualViewport`. Fields under 16px zoom the page on focus.
7. **Touch:** `:active` needs a touch listener; touch long-press fires no `contextmenu` (use a timer); chrome needs
   `-webkit-touch-callout: none` and `-webkit-user-select`. No Vibration API: the only haptic is a native `switch`
   toggle (iOS 18+, real taps only since 26.5), a fragile hack.
8. **Back:** Safari 27 has no `CloseWatcher`, so overlays need history entries. Safari animates its own edge-swipe back
   (check `hasUAVisualTransition`). Installed apps have no browser back button: render your own.
9. **Safari 26+ ignores `theme-color` in tabs** (installed apps still use it); toolbars tint from fixed or sticky
   elements at the viewport edge. The installed status bar follows `apple-mobile-web-app-status-bar-style`.
10. **Backgrounded apps are suspended within seconds:** timers stop, sockets die (sometimes still reporting OPEN), and
    only push reaches the app.
11. **Icon and identity:** an opaque 180×180 `apple-touch-icon` beats manifest icons; name and icon freeze at install;
    launch images need per-device `apple-touch-startup-image`. Detect the installed app with `navigator.standalone`.
12. **Missing in Safari:** `beforeinstallprompt`, Background Sync, `scheduler.yield()`, `requestIdleCallback`,
    Speculation Rules, VirtualKeyboard, share targets, orientation lock, element fullscreen on iPhone.

### Android and desktop

1. **A real Android install is a WebAPK,** minted only by Chrome on Google-services devices and Samsung Internet
   (others make badged shortcuts). Needs name, 192 and 512px icons, `start_url`, a non-browser display, HTTPS; no
   service worker required.
2. **Keyboard:** Chrome and Firefox on Android default to `resizes-visual`; opt into `resizes-content`, and then every
   viewport unit shrinks with the keyboard too.
3. **System Back runs `history.back()`** and on the first entry closes the app. Modal `<dialog>`/popovers close on Back
   (Chrome 120+), `CloseWatcher` from 126. Chrome's Back may skip entries pushed without user activation.
4. **Edge-to-edge since Chrome 135** (`viewport-fit=cover`): the bottom inset changes as the toolbar retracts; use
   `safe-area-max-inset-bottom` for fixed bars. Gesture navigation owns both screen edges.
5. **`new Notification()` throws on Chrome Android:** use `registration.showNotification()`. No Badging API on Android.
6. **Chrome Android pulls to refresh the document** unless the root has `overscroll-behavior-y: none` or a locked shell.
7. **Vibration only in Chromium on Android,** after a gesture; Firefox Android returns `true` and does nothing.
8. **Samsung Internet** lags Chrome's engine, and some Samsung devices wrongly match `(hover: hover)`.
9. **Desktop Chromium** installs any site from the menu; installed apps get Window Controls Overlay, `launch_handler`,
   file/protocol handlers, shortcuts and a badge (Windows, macOS). Chrome 139+ opens in-scope links in the installed
   app by default. `theme-color` only colours installed windows.
10. **Firefox desktop doesn't install manifest PWAs;** Windows taskbar web apps match `display-mode: minimal-ui`, not
    `standalone`. No `beforeinstallprompt` and no share target in any Firefox.
11. **Chromium-only lifecycle:** `freeze`/`resume`, `document.wasDiscarded`; `unload` handlers are being phased out,
    and timers in tabs hidden over 5 minutes run about once a minute.

## Index

### references/ (read the one for the area you are touching, before writing code)

- [install-and-identity.md](references/install-and-identity.md) (install): manifest members, `id`/scope, display modes, icons and colours, install paths and prompts, iOS meta tags and launch images, installed detection, badging, shortcuts, share/file/protocol handlers, `launch_handler`, store packaging.
- [offline-push-storage.md](references/offline-push-storage.md) (offline): service worker caching and updates, chunk errors, Web Push and notifications, background sync and fetch, storage persistence and eviction, IndexedDB, multi-tab, page lifecycle, resume, state restore, bfcache.
- [viewport-keyboard-safe-areas.md](references/viewport-keyboard-safe-areas.md) (viewport): viewport meta, zoom, viewport units, the locked shell, safe areas, the keyboard per platform, scrolling and overscroll, chat lists, scroll snap, large screens and foldables, iOS status bar and Safari toolbar tinting.
- [touch-gestures-input.md](references/touch-gestures-input.md) (touch): Pointer Events, `touch-action`, swipes, long-press, drag, pinch, tap feedback, hover, hit targets, haptics, audio unlock, user activation, field keyboards and autofill, selection, focus rings, desktop shortcuts.
- [motion-performance.md](references/motion-performance.md) (motion): View Transitions, springs, motion tokens, dialog and sheet animation, direct manipulation, compositor-only animation, INP and long tasks, optimistic UI, skeletons, instant start, typography and layout stability, reduced motion.
- [device-apis.md](references/device-apis.md) (device): user activation and permission UX, then the capability catalogue: share, clipboard, files, passkeys, OTP, media and audio session, wake lock, PiP, fullscreen, orientation, camera, geolocation, sensors, speech, payments, hardware APIs.
- [navigation-ui-patterns.md](references/navigation-ui-patterns.md) (nav): Back and overlays, the history model, Navigation API, deep links, Up vs Back, external links, adaptive navigation, system font, colour scheme and dark mode, dialogs, popovers, sheets, pickers, `inert`, toasts, screen states, focus and accessibility, RTL, titles and favicon badges.
- [platform-quirks-testing.md](references/platform-quirks-testing.md) (platform): per-platform summaries (iOS/iPadOS, Android, Samsung Internet, desktop Chromium, macOS Safari, Firefox) and all testing: DevTools, Playwright projects and emulation limits, production-build E2E, pure-function tests, the real-device checklist.

### templates/ (copy, then adapt every ADAPT marker)

- [head.html](templates/head.html): the `<head>`: viewport, colour scheme, theme-color pair, no-flash theme script, manifest, icons, Apple tags. Start every app here.
- [manifest.webmanifest](templates/manifest.webmanifest): a complete manifest to copy; [manifest.md](templates/manifest.md) explains each field, what to delete, and how to serve and test it.
- [native.css](templates/native.css): tokens, the locked shell (or scrolling screens), safe areas, press and hover, selection, 16px fields, system type, focus, translucent bars, dialogs/popovers/sheets with enter and exit, installed-app modes, reduced motion.
- [viewport.ts](templates/viewport.ts): fits the shell above the on-screen keyboard (iOS `visualViewport`, optional VirtualKeyboard) and keeps the focused field visible.
- [gestures.ts](templates/gestures.ts): swipe with axis lock and flick, long-press, rubber band, momentum snapping, `:active` on iOS, context menus; pure math plus Pointer Events wiring.
- [haptics.ts](templates/haptics.ts): Android vibration with setting, reduced-motion and activation gating; the iOS switch trick.
- [overlay-history.ts](templates/overlay-history.ts): Back closes the topmost overlay, via `CloseWatcher` or a history-entry fallback.
- [install.ts](templates/install.ts): Install button, iOS and macOS steps, installed detection, one-time hint, app badge, `launchQueue`.
- [lifecycle.ts](templates/lifecycle.ts): save on hidden, resume plan, reconnect backoff, connection state, wake lock.
- [sw.ts](templates/sw.ts): Workbox injectManifest worker: precache, navigation strategy, runtime caches, prompt updates, push, `notificationclick`.
- [sw-logic.ts](templates/sw-logic.ts): every worker and page-glue decision as pure functions; unit-test this.
- [sw-client.ts](templates/sw-client.ts): registration, update prompt and checks, notifications via the registration, push subscription, chunk-error reload.

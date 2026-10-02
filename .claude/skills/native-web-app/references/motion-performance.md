<!-- verified 2026-10-02: 17 corrections -->
# Motion, transitions and perceived performance

How an app's motion and speed come to feel native: view transitions, springs, sheets and top-layer animations, interruptible and scroll-driven motion, rendering cost, responsiveness (INP), and the perceived-speed patterns (optimistic UI, skeletons, instant start).
Support as of Oct 2026 (MDN browser-compat-data: Chrome 154, Safari 27, Firefox 157). TS snippets assume `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; `declare` lines stand in for your own app code.

## Checklist

- [ ] **must** — Wrap visible state changes in a feature-detected view transition → [View Transitions](#same-document-view-transitions-around-every-visible-state-change)
- [ ] **must** — Tag route transitions `push`/`pop` and skip them when the browser already animated the back swipe → [Push/pop](#native-pushpop-navigation-with-transition-types)
- [ ] **must** — Use springs (`linear()` easing) for presentation motion → [Springs](#spring-physics-in-plain-css-with-linear-easing)
- [ ] **must** — Define motion tokens: durations, enter/exit easings, a small keyframe set → [Motion tokens](#motion-tokens-native-durations-asymmetric-enter-and-exit-and-a-small-set-of-keyframes)
- [ ] **must** — Animate dialog and popover entry and exit (`@starting-style`, `allow-discrete`, WAAPI exit) → [Top-layer animations](#entry-and-exit-animations-for-dialog-popover-and-top-layer-ui-starting-style--allow-discrete)
- [ ] **must** — Present phone content in bottom sheets that spring up and drag down to dismiss → [Bottom sheets](#bottom-sheets-that-slide-up-on-a-spring-and-drag-down-to-dismiss)
- [ ] **must** — Make dragged panels follow the finger 1:1 and finish from where they are → [Direct manipulation](#direct-manipulation-panels-follow-the-finger-11-and-finish-on-release)
- [ ] **must** — Animate only transform/translate/scale/rotate and opacity; never `transition: all` → [Compositor-only](#animate-only-compositor-friendly-properties-never-transition-all)
- [ ] **must** — Batch layout reads before writes; observe instead of polling → [Layout thrash](#no-layout-thrash-batch-reads-before-writes-observe-instead-of-polling)
- [ ] **must** — Paint feedback in the next frame, then do the work; measure INP in the field → [INP](#inp-show-a-visible-response-in-the-next-frame-do-the-work-afterwards-and-measure-it-in-the-field)
- [ ] **must** — Break long tasks with `scheduler.yield()` (guarded, with a fallback) → [Long tasks](#break-up-long-tasks-with-scheduleryield-and-use-schedulerposttask-for-priorities)
- [ ] **must** — Apply user actions optimistically; undo instead of confirm → [Optimistic UI](#optimistic-ui-apply-the-result-immediately-reconcile-later-and-use-undo-instead-of-confirmation)
- [ ] **must** — Use layout-matching skeletons and delay every loader ~400ms → [Skeletons](#skeletons-instead-of-spinners-for-content-and-loaders-that-only-appear-after-a-delay)
- [ ] **must** — Give every tappable element an instant pressed state → [Tap feedback](#instant-tap-feedback)
- [ ] **must** — Paint the first frame from HTML and cache, not from JS → [App shell](#app-shell-instant-start-the-first-frame-comes-from-html-and-the-cache-not-from-js)
- [ ] **must** — Load web fonts without invisible text or layout shift → [Fonts](#web-fonts-that-dont-shift-and-the-system-font)
- [ ] **must** — Honour reduced motion everywhere (CSS, view transitions, WAAPI, JS), keeping feedback → [Reduced motion](#prefers-reduced-motion-done-right-remove-movement-keep-the-feedback)
- [ ] **should** — Morph shared elements just in time (`view-transition-name`, `match-element`) → [Hero morphs](#shared-element-hero-morphs-with-view-transition-name-match-element-and-view-transition-class)
- [ ] **should** — Use transitions for reversible state and WAAPI that starts from the current value → [Interruptible](#interruptible-motion-transitions-for-reversible-state-waapi-that-starts-from-the-current-value)
- [ ] **should** — Drive collapsing titles and progress bars with scroll-driven animations → [Scroll-driven](#scroll-driven-animations-collapsing-large-titles-progress-bars-and-reveals-without-js)
- [ ] **should** — Animate to and from `height: auto` (with the grid fallback) → [Height auto](#animate-to-and-from-height-auto-interpolate-size-calc-size-details-content-grid-fallback)
- [ ] **should** — Set `will-change` only for the duration of a gesture → [will-change](#will-change-only-around-the-gesture-or-animation-never-as-a-blanket-style)
- [ ] **should** — `content-visibility: auto` + `contain-intrinsic-size` on long feeds → [content-visibility](#content-visibility-auto-with-contain-intrinsic-size-for-long-feeds)
- [ ] **should** — Move heavy CPU work into Web Workers → [Workers](#move-heavy-cpu-work-off-the-main-thread-into-web-workers)
- [ ] **should** — Keep previous screens alive (inert, rendering skipped) instead of unmounting → [Screen stack](#keep-previous-screens-alive-instead-of-unmounting-them)
- [ ] **should** — Prerender (MPA) or preload on intent (SPA) → [Instant navigation](#instant-navigation-speculation-rules-prerender-for-multi-page-apps-intent-based-preloading-for-spas)
- [ ] **should** — Use tabular numbers, a stable scrollbar gutter and reserved media space → [Layout stability](#layout-stability-craft-tabular-numbers-scrollbar-gutter-reserved-media-space)
- [ ] **should** — Prioritise the LCP image, lazy-load the rest, decode before swapping → [Images](#image-loading-and-decoding-that-never-pops-in-half-painted)
- [ ] **should** — Blur translucent bars, with reduced-transparency and contrast fallbacks → [Blurred bars](#translucent-blurred-bars-backdrop-filter-with-reduced-transparency-and-contrast-fallbacks)
- [ ] **should** — Make JS animation time-based; expect Safari to cap at ~60fps → [120Hz](#120hz-aware-motion-time-based-animation-loops-and-knowing-when-safari-caps-you-at-60fps)
- [ ] **nice** — Cross-document view transitions for multi-page apps → [Cross-document](#cross-document-view-transitions-for-multi-page-apps-view-transition)
- [ ] **nice** — Element-scoped view transitions for panels (Chromium) → [Element-scoped](#element-scoped-view-transitions-for-panels-that-animate-while-the-rest-stays-live)
- [ ] **nice** — Show bar hairlines only when stuck or scrolled → [Scroll-state](#bars-that-react-to-scroll-state-hairline-or-shadow-only-when-stuck-or-scrolled)
- [ ] **nice** — Stagger a screen's first fill with `sibling-index()`, capped → [Stagger](#staggered-list-entrances-with-sibling-index)
- [ ] **nice** — Virtualize only truly huge lists → [Virtualize](#virtualize-truly-huge-lists-keep-the-dom-to-about-3-screens-of-rows)
- [ ] **nice** — Animate rings and gradients with `@property` → [@property](#animate-gradients-rings-and-counters-with-typed-custom-properties-property)
- [ ] **nice** — Switch themes with one cross-fade, not a transition storm → [Theme switch](#theme-and-appearance-switches-without-a-transition-storm)

Covered elsewhere: scroll anchoring and chat stick-to-bottom → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#scroll-anchoring-overflow-anchor-now-in-every-engine); bfcache eligibility → [offline-push-storage.md](offline-push-storage.md#backforward-cache-eligibility); scroll restoration per screen and on relaunch → [navigation-ui-patterns.md](navigation-ui-patterns.md) and [offline-push-storage.md](offline-push-storage.md#restore-route-scroll-position-and-drafts-on-relaunch).

## Same-document View Transitions around every visible state change

`document.startViewTransition()` snapshots the DOM, runs your update, then animates old → new through `::view-transition-*` pseudo-elements (root cross-fade of 250ms by default; named elements morph position and size). Content that blinks to its new state is the clearest web tell; this gives native continuity with one wrapper and no library.

```ts
// motion.ts
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const vtTypes = 'ViewTransition' in window && 'types' in ViewTransition.prototype;

/** Runs a DOM update as a view transition when it can. Resolves once the DOM is updated, not when the animation ends. */
export function withTransition(update: () => void | Promise<void>, types: string[] = []): Promise<void> {
  if (!('startViewTransition' in document) || reduceMotion.matches || document.visibilityState === 'hidden') {
    return Promise.resolve().then(update);
  }
  const vt = vtTypes ? document.startViewTransition({ update, types }) : document.startViewTransition(update);
  vt.ready.catch(() => {}); // a skipped transition rejects `ready`, but the update still runs
  return vt.updateCallbackDone;
}
```

```css
::view-transition-group(*) { animation-duration: 250ms; animation-timing-function: cubic-bezier(.2, 0, 0, 1); }
/* A `*, *::before, *::after` reset does NOT match these pseudo-elements: they need their own rule */
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
}
```

**Support:** Chromium desktop and Chrome Android 111+; Safari 18.0+ on macOS and iOS (tab and home-screen app alike); Firefox 144+. Baseline. The `{ update, types }` options object, `ViewTransition.types` and `:active-view-transition-type()`: Chrome 125, Safari 18.2, Firefox 147. `document.activeViewTransition`: Chrome 142, Safari 26.2, Firefox 147. `ViewTransition.waitUntil()`: Chrome 144 only (experimental).

**Gotchas:**
- While a document-level transition runs, the `::view-transition` overlay takes every hit: the page is unusable. Keep transitions ≤ ~400ms.
- Starting another transition skips the running one: its update still runs but `ready` rejects (catch it).
- A hidden document, or two elements with the same `view-transition-name`, skips the transition (`InvalidStateError`).
- Snapshots are images: text inside a morphing element stretches (see [hero morphs](#shared-element-hero-morphs-with-view-transition-name-match-element-and-view-transition-class)).
- Recent TS `lib.dom` always declares `startViewTransition`: detect with `'startViewTransition' in document`, not truthiness. Older engines (Chrome 111-124, Safari 18.0/18.1, Firefox 144-146) accept only a callback, hence the `'types' in ViewTransition.prototype` branch.
- With Vite/React: flush the state inside the callback (`startViewTransition(() => flushSync(() => setState(next)))`) or the update lands after the snapshot and nothing animates. React's `<ViewTransition>` component does this for you (unverified: stable status depends on your React version).

**Sources:** https://developer.mozilla.org/docs/Web/API/Document/startViewTransition · https://developer.chrome.com/docs/web-platform/view-transitions/same-document · https://drafts.csswg.org/css-view-transitions-2/

## Native push/pop navigation with transition types

Tag each route transition `push` or `pop` from the navigation direction and style each with `:active-view-transition-type()`: forward slides the new screen in from the trailing edge while the old one parallaxes out; back reverses it. This copies UINavigationController and Android stack navigation; a cross-fade on every route looks like a website. The router itself (Navigation API, History fallback) lives in [navigation-ui-patterns.md](navigation-ui-patterns.md).

```css
/* Only the routed content slides; the tab bar has its own snapshot, so it stays still */
main.screen { view-transition-name: screen; }
nav.tabbar { view-transition-name: tabbar; }
:root { --ease-push: cubic-bezier(.32, .72, 0, 1); }
@keyframes in-from-right { from { translate: 100% 0; } }
@keyframes out-to-left { to { translate: -30% 0; opacity: .7; } }
@keyframes in-from-left { from { translate: -30% 0; opacity: .7; } }
@keyframes out-to-right { to { translate: 100% 0; } }
html:active-view-transition-type(push) {
  &::view-transition-old(screen) { animation: 400ms var(--ease-push) both out-to-left; }
  &::view-transition-new(screen) { animation: 400ms var(--ease-push) both in-from-right; }
}
html:active-view-transition-type(pop) {
  &::view-transition-old(screen) { animation: 350ms var(--ease-push) both out-to-right; z-index: 1; }
  &::view-transition-new(screen) { animation: 350ms var(--ease-push) both in-from-left; }
}
```

```ts
// Navigation API types: TS 6 lib.dom, or @types/dom-navigation on older TypeScript
declare function render(url: URL): Promise<void>;
// withTransition: see the previous section
if ('navigation' in window) {
  navigation.addEventListener('navigate', (e) => {
    if (!e.canIntercept || e.hashChange || e.downloadRequest !== null) return;
    const from = navigation.currentEntry?.index ?? -1;
    const back = e.navigationType === 'traverse' && e.destination.index < from;
    const type = e.navigationType === 'push' || e.navigationType === 'traverse' ? (back ? 'pop' : 'push') : null;
    const url = new URL(e.destination.url);
    e.intercept({
      async handler() {
        // The iOS edge swipe or Android predictive back already animated this navigation: don't animate it twice
        if (e.hasUAVisualTransition || type === null) { await render(url); return; }
        await withTransition(() => render(url), [type]);
      },
    });
  });
}
```

**Support:** Types: Chrome 125, Safari 18.2, Firefox 147. Navigation API: Chrome 102, Safari 26.2, Firefox 147 (Baseline Jan 2026). `NavigateEvent.hasUAVisualTransition`: Chrome 118, Safari 26.2, Firefox 147. `PopStateEvent.hasUAVisualTransition`: Chrome 118, Safari 18.0, Firefox 149. CSS nesting: Baseline 2023.

**Gotchas:**
- Without the `hasUAVisualTransition` skip, iOS Safari's edge-swipe back plays its snapshot animation and then yours: a double animation. Several routers (Astro, TanStack Router, Nuxt) have shipped fixes for this.
- Without the Navigation API, read `hasUAVisualTransition` in `popstate` and keep an index in `history.state` to tell back from forward.
- Switching tabs is not a push: iOS switches tabs instantly, so use no animation or a short cross-fade. Modals slide up from the bottom. Flip directions under `:dir(rtl)`.
- Fixed headers and tab bars without their own name get swept along in the root snapshot.
- `cubic-bezier(.32,.72,0,1)` is a widely copied "iOS-like" curve (Ionic, Vaul), not an Apple constant; a `linear()` spring is closer.
- Input is dead until the transition ends: keep pushes ≤ ~400ms.

**Sources:** https://developer.chrome.com/docs/web-platform/view-transitions/same-document · https://developer.mozilla.org/docs/Web/API/NavigateEvent/hasUAVisualTransition · https://developer.mozilla.org/docs/Web/API/Navigation

## Shared-element (hero) morphs with view-transition-name, match-element and view-transition-class

When an element has the same `view-transition-name` before and after the update, the browser morphs its position, size and content: a thumbnail grows into a detail header, a list row slides to its new slot. `match-element` names elements automatically by identity; `view-transition-class` styles a group with one rule. This is the Photos / App Store / Material container transform, and it animates list reorders, inserts and deletes for free.

```ts
declare function renderDetail(id: string): void; // renders <img class="detail-hero" style="view-transition-name: hero">
// Name the tapped thumbnail just in time, and hand the name to the detail hero inside the update
export async function openDetail(card: HTMLElement, id: string): Promise<void> {
  card.style.viewTransitionName = 'hero';
  await withTransition(() => {
    card.style.viewTransitionName = '';
    renderDetail(id);
  }, ['push']);
}
```

```css
::view-transition-group(hero) { animation-duration: 450ms; animation-timing-function: var(--spring-smooth); }
/* When the aspect ratio changes, keep the snapshot filling the box instead of stretching */
::view-transition-old(hero), ::view-transition-new(hero) { height: 100%; object-fit: cover; overflow: clip; }

/* Lists: unique names from element identity, plus one class to style all rows */
.message { view-transition-name: match-element; view-transition-class: message; }
::view-transition-group(.message) { animation-duration: 200ms; }
```

**Support:** `view-transition-name`: Chrome 111, Safari 18.0, Firefox 144. `match-element`: Chrome 137, Safari 18.4, Firefox 144. `view-transition-class`: Chrome 125, Safari 18.2, Firefox 144. Safari has also accepted `view-transition-name: auto` (unverified: not listed in browser-compat-data); prefer `match-element`.

**Gotchas:**
- Every name must be unique per snapshot; one duplicate skips the whole transition.
- Each named element costs a snapshot, even off-screen: name only the elements involved, only just in time.
- `match-element` is same-document only and pairs DOM nodes by identity: a remount (unstable React key, conditional wrapper) gives a fade instead of a move.
- Old and new images are flat bitmaps: no live text reflow, no interaction; a `box-shadow` is captured in the image.
- Nested groups (`view-transition-group` property, Chrome 140) keep children clipped by their parent but are Chromium-only.

**Sources:** https://developer.mozilla.org/docs/Web/CSS/view-transition-name · https://developer.mozilla.org/docs/Web/CSS/view-transition-class · https://developer.chrome.com/docs/web-platform/view-transitions/same-document

## Cross-document View Transitions for multi-page apps (@view-transition)

Opt both pages in with `@view-transition { navigation: auto; }` and same-origin navigations animate with no JS. Use `pagereveal`/`pageswap` to set types, and `<link rel=expect blocking=render>` so the incoming page has the element you morph to. A server-rendered or multi-page PWA gets app-like navigation without becoming an SPA; with prerendering it can feel as instant as a native push.

```css
/* On both pages */
@view-transition { navigation: auto; }
```

```html
<!-- Incoming page <head>: don't render the first frame until #main is parsed -->
<link rel="expect" href="#main" blocking="render">
<script>
  // Must be a classic, render-blocking script in <head>: a deferred module misses the event
  addEventListener('pagereveal', (e) => {
    const act = 'navigation' in window ? navigation.activation : null;
    if (!e.viewTransition || !act || !act.from) return;
    const back = act.navigationType === 'traverse' && act.entry.index < act.from.index;
    e.viewTransition.types.add(back ? 'pop' : 'push');
  });
</script>
```

**Support:** `@view-transition`: Chrome 126 (desktop and Android), Safari 18.2 (macOS and iOS). Firefox: not in release (cross-document is behind a Nightly flag; an Interop 2026 focus area). `pagereveal`: Chrome 123, Safari 18.2. `pageswap`: Chrome 124, Safari 18.2. `rel=expect`: Chrome 124, Safari 18.2. `blocking=render`: Chrome 105, Safari 18.2. None in Firefox.

**Gotchas:**
- Only same-origin navigations animate, and not reloads. Both documents must opt in.
- If the new page takes too long (Chrome gives up after ~4s) the transition is skipped.
- Does nothing for an SPA's in-app routes; use the same-document API there.
- `navigation.activation` needs the Navigation API (Safari 26.2+): guard `navigation`, or Safari 18.2-26.1 throws a `ReferenceError`.
- `blocking=render` delays first paint: keep the expected element early in the HTML.

**Sources:** https://developer.chrome.com/docs/web-platform/view-transitions/cross-document · https://developer.mozilla.org/docs/Web/CSS/@view-transition · https://webkit.org/blog/17818/announcing-interop-2026/

## Element-scoped view transitions for panels that animate while the rest stays live

`element.startViewTransition()` scopes a transition to one subtree: the pseudo-elements live inside that element, ancestor clipping and transforms apply, several can run at once, and the rest of the page stays interactive. Native apps animate a sidebar or thread pane while you keep typing elsewhere; a document-level transition freezes everything.

```ts
// Not yet in TS lib.dom: declare it as optional
declare global { interface Element { startViewTransition?(update: () => void | Promise<void>): ViewTransition } }

export function transitionWithin(el: Element, update: () => void): Promise<void> {
  if (typeof el.startViewTransition === 'function') return el.startViewTransition(update).updateCallbackDone;
  return withTransition(update); // falls back to a document-level transition (or an instant update)
}
```

**Support:** Chromium 147+ only (desktop and Android; experimental in MDN data). Not in Safari or Firefox.

**Gotchas:**
- Progressive enhancement only: the fallback blocks input, so keep it short or skip animating in the fallback.
- The spec is still moving (`view-transition-scope` and related APIs are experimental too).

**Sources:** https://developer.chrome.com/blog/element-scoped-view-transitions · https://developer.mozilla.org/docs/Web/API/Element/startViewTransition

## Spring physics in plain CSS with linear() easing

`linear()` accepts many stops. Sample a damped spring into them and you get spring motion (optionally with overshoot) from ordinary transitions, keyframes, view transitions and WAAPI, with no JS loop. iOS and modern Android drive almost everything with springs; a cubic-bezier can't overshoot and settle, which is why web motion feels mechanical.

```ts
// spring.ts: run at build time or once at startup
export function spring(stiffness = 300, damping = 30, mass = 1, points = 40): { easing: string; duration: number } {
  const w0 = Math.sqrt(stiffness / mass);
  const z = damping / (2 * Math.sqrt(stiffness * mass));
  const wd = w0 * Math.sqrt(Math.max(0, 1 - z * z));
  const x = (t: number): number =>
    z < 1
      ? 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t))
      : 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  let settle = 0;
  for (let t = 0; t < 10; t += 0.001) if (Math.abs(1 - x(t)) > 0.001) settle = t;
  const stops = Array.from({ length: points + 1 }, (_, i) => (i === points ? 1 : +x((i / points) * settle).toFixed(3)));
  return { easing: `linear(${stops.join(', ')})`, duration: Math.round(settle * 1000) };
}
```

```css
/* Generated with spring(); pair each curve with its duration */
:root {
  /* stiffness 300, damping 30: no visible bounce, use 500ms */
  --spring-smooth: linear(0, 0.074, 0.231, 0.406, 0.567, 0.699, 0.801, 0.875, 0.926, 0.96, 0.981, 0.993, 1, 1.003, 1.004, 1.004, 1.004, 1.003, 1.002, 1.001, 1);
  /* stiffness 260, damping 18: playful overshoot, use 780ms */
  --spring-bouncy: linear(0, 0.111, 0.353, 0.619, 0.844, 1.002, 1.089, 1.12, 1.113, 1.086, 1.054, 1.025, 1.004, 0.991, 0.986, 0.986, 0.989, 0.993, 0.996, 0.999, 1.001, 1.002, 1.002, 1.001, 1);
}
.sheet[open] { transition: translate 500ms var(--spring-smooth); }
```

**Support:** `linear()`: Chrome 113, Safari 17.2 (macOS and iOS), Firefox 112. Baseline since Dec 2023. Works wherever an easing is accepted, including WAAPI `easing` and view-transition pseudo-elements.

**Gotchas:**
- A spring's duration comes from physics: always pair the easing with the duration it was generated for. Squeezing a 500ms curve into 250ms makes it stiffer.
- Bouncy curves only for playful moments (badge pop, like). Never overshoot large surfaces (sheets, pushed pages): overshoot on `translate` can expose the screen edge.
- A CSS spring can't pick up the finger's release velocity; for velocity-matched handoff compute the curve at runtime or drive it from JS.
- Unsupported engines drop the whole declaration: declare a cubic-bezier fallback first if you support pre-2023 engines.
- Jake Archibald's linear-easing-generator does the same conversion visually.

**Sources:** https://developer.chrome.com/docs/css-ui/css-linear-easing-function · https://developer.mozilla.org/docs/Web/CSS/easing-function/linear · https://linear-easing-generator.netlify.app/

## Motion tokens: native durations, asymmetric enter and exit, and a small set of keyframes

Define every duration and easing as a token, plus a small shared set of presentation keyframes. Entrances decelerate and run longer; exits accelerate and run shorter. Native platforms feel coherent because everything comes from a few curves; ad-hoc `300ms ease` reads as web. One source also makes reduced motion a one-line change.

```css
:root {
  --dur-press: 100ms;   /* press feedback */
  --dur-small: 200ms;   /* toggles, fades, tooltips */
  --dur-medium: 300ms;  /* dialogs and sheets coming in */
  --dur-large: 450ms;   /* full-screen push */
  --dur-exit: 200ms;    /* exits are quicker than entrances */
  --ease-standard: cubic-bezier(.2, 0, 0, 1);
  --ease-enter: cubic-bezier(.05, .7, .1, 1);   /* decelerate: arriving */
  --ease-exit: cubic-bezier(.3, 0, .8, .15);    /* accelerate: leaving */
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-small: 1ms; --dur-medium: 1ms; --dur-large: 1ms; --dur-exit: 1ms; }
}
@keyframes sheet-in { from { transform: translateY(100%); } }
@keyframes dialog-in { from { transform: translateY(12px) scale(.97); opacity: 0; } }
@keyframes toast-in { from { transform: translateY(16px) scale(.96); opacity: 0; } }
@keyframes pop { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
.toast { animation: toast-in var(--dur-medium) var(--ease-enter) both; }
```

**Support:** Custom properties and keyframes: everywhere. The curves are Material 3's standard, emphasized-decelerate and emphasized-accelerate easings.

**Gotchas:**
- Scale duration with distance and screen: desktop and tablet UI runs faster (150-250ms) than phone full-screen moves.
- Don't animate what the user didn't cause: content on screen at launch simply appears.
- Under reduced motion prefer 1ms over 0ms: a transition whose duration + delay is 0 never starts, so code waiting for `transitionend` hangs.
- Keyframes without a `to` block animate back to the element's own style, which keeps them reusable.

**Sources:** https://m3.material.io/styles/motion/easing-and-duration/tokens-specs · https://developer.apple.com/design/human-interface-guidelines/motion · https://drafts.csswg.org/css-transitions/#starting

## Entry and exit animations for dialog, popover and top-layer UI (@starting-style + allow-discrete)

`@starting-style` gives an element's first frame a "before" style so it can transition in from `display: none`. `transition-behavior: allow-discrete` on `display` and `overlay` keeps it rendered, and in the top layer, until its exit finishes. Native modals and menus never pop in or vanish. Dialog and popover semantics (closedby, requestClose, invokers) live in [navigation-ui-patterns.md](navigation-ui-patterns.md).

```css
dialog, [popover] {
  opacity: 0; scale: .96;
  /* Closed state = exit timing (a transition uses the destination state's transition property) */
  transition: opacity var(--dur-exit) var(--ease-exit), scale var(--dur-exit) var(--ease-exit),
              display var(--dur-exit) allow-discrete, overlay var(--dur-exit) allow-discrete;
}
dialog[open], [popover]:popover-open {
  opacity: 1; scale: 1;
  transition-duration: var(--dur-medium); transition-timing-function: var(--ease-enter);
}
@starting-style { dialog[open], [popover]:popover-open { opacity: 0; scale: .96; } }

dialog::backdrop { background: rgb(0 0 0 / 0); transition: background-color var(--dur-exit), display var(--dur-exit) allow-discrete, overlay var(--dur-exit) allow-discrete; }
dialog[open]::backdrop { background: rgb(0 0 0 / .35); }
@starting-style { dialog[open]::backdrop { background: rgb(0 0 0 / 0); } }
```

```ts
// Portable exit (Firefox doesn't transition `display`): animate with WAAPI, then close
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
export async function closeAnimated(d: HTMLDialogElement): Promise<void> {
  const a = d.animate({ opacity: [1, 0], scale: [1, 0.96] }, { duration: reduce.matches ? 0 : 160, easing: 'cubic-bezier(.3,0,.8,.15)', fill: 'forwards' });
  await a.finished.catch(() => {});
  d.close();
  a.cancel();
}
// Once per dialog: Esc and Android back take the animated path
export function animateCloseRequests(d: HTMLDialogElement): void {
  d.addEventListener('cancel', (e) => { e.preventDefault(); void closeAnimated(d); });
}
```

**Support:** `@starting-style`: Chrome 117, Safari 17.5, Firefox 129. `transition-behavior: allow-discrete`: Chrome 117, Safari 17.4, Firefox 129. Transitioning `display`: Chrome 117, Safari 18.0, Firefox no. `overlay`: Chromium only. `closedby`: Chrome 134, Firefox 141, Safari Technology Preview only. `requestClose()`: Chrome 134, Safari 18.4, Firefox 139. The same on iOS Safari tab and home-screen app.

**Gotchas:**
- Firefox: `CSS.supports()` says `allow-discrete` works, yet `display` still flips instantly. Entry animates, exit doesn't, and detection gives a false positive; hence the WAAPI exit.
- Without `overlay … allow-discrete` (Chromium) the element leaves the top layer at once and the exit plays underneath other content.
- `cancel` can't be prevented without a user activation since the dialog opened (CloseWatcher anti-abuse rule); the dialog then closes instantly, which is acceptable.
- Route your own close buttons through `d.requestClose()` (where supported) so they take the same animated path.
- Don't run a CSS exit transition and a WAAPI exit on the same property: it animates twice.

**Sources:** https://developer.chrome.com/blog/entry-exit-animations · https://developer.mozilla.org/docs/Web/CSS/@starting-style · https://developer.mozilla.org/docs/Web/API/HTMLDialogElement/requestClose

## Bottom sheets that slide up on a spring and drag down to dismiss

A modal `<dialog>` pinned to the bottom edge: it springs up from `translate: 0 100%`, follows the finger while the grabber is dragged, and on release snaps back or animates out from wherever it is. Sheets are how phone apps present things (UISheetPresentationController, Material bottom sheets); a centred desktop modal on a phone is a web tell, and a sheet that can't be dragged feels fake. Field-tested: an entrance keyframe alone, without drag-to-dismiss and an animated exit, still feels like a web overlay. When to use a sheet vs a menu: [navigation-ui-patterns.md](navigation-ui-patterns.md); gesture details: [touch-gestures-input.md](touch-gestures-input.md).

```html
<dialog class="sheet" aria-labelledby="sheet-title"><div class="grabber" aria-hidden="true"></div>…</dialog>
```

```css
.sheet {
  margin: auto auto 0; width: min(100%, 640px); max-width: 100%; max-height: 92dvh;
  border: 0; border-radius: 16px 16px 0 0; padding: 8px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  overscroll-behavior: contain;
  translate: 0 100%;                                /* closed; the exit runs in JS */
}
.sheet[open] { translate: 0 0; transition: translate 500ms var(--spring-smooth); }
@starting-style { .sheet[open] { translate: 0 100%; } }
.sheet.dragging { transition: none; }
.grabber { touch-action: none; inline-size: 36px; block-size: 5px; margin: 0 auto 8px; border-radius: 3px; background: var(--border-strong); }
```

```ts
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
export async function closeSheet(d: HTMLDialogElement): Promise<void> {
  const from = getComputedStyle(d).translate;      // starts from the current drag offset: no jump
  d.classList.remove('dragging'); d.style.translate = '';
  const a = d.animate({ translate: [from, '0 100%'] }, { duration: reduce.matches ? 0 : 220, easing: 'cubic-bezier(.3,0,.8,.15)', fill: 'forwards' });
  await a.finished.catch(() => {});
  d.close(); a.cancel();
}
/** Call ONCE per sheet element (not on every open), or listeners pile up. */
export function makeSheet(d: HTMLDialogElement): void {
  const handle = d.querySelector<HTMLElement>('.grabber');
  d.addEventListener('cancel', (e) => { e.preventDefault(); void closeSheet(d); });
  if (!handle) return;
  let y0 = 0, dy = 0, lastY = 0, lastT = 0, v = 0;
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId); y0 = lastY = e.clientY; lastT = e.timeStamp; dy = v = 0; d.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const raw = e.clientY - y0;
    dy = raw > 0 ? raw : raw / 4;                  // rubber-band when dragged upward
    v = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT); lastY = e.clientY; lastT = e.timeStamp; // recent px/ms
    d.style.translate = `0 ${dy}px`;
  });
  const end = (): void => {
    if (!d.classList.contains('dragging')) return;
    if (dy > d.offsetHeight * 0.3 || v > 0.5) { void closeSheet(d); return; }
    d.classList.remove('dragging'); d.style.translate = '';   // the [open] spring snaps it back
  };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
}
// open: d.showModal()
```

**Support:** All Baseline: `showModal()` (Safari 15.4+), `@starting-style` (Chrome 117 / Safari 17.5 / Firefox 129), `linear()` (Safari 17.2+), WAAPI `translate` keyframes, pointer capture (Safari 13+), `dvh` (Safari 15.4+). The exit runs in JS, so Firefox animates it too. Same in iOS tab and home-screen app.

**Gotchas:**
- Use velocity from the last move or two, not the gesture average, so a quick flick dismisses.
- Give the grabber, not the whole sheet, `touch-action: none`.
- Dragging the sheet body when its inner scroller is at `scrollTop` 0 (iOS behaviour) needs extra logic: start only when the scroller is at the top and the movement is downward.
- Detents (half/full) are easiest with CSS scroll-snap on a full-height scroller.
- Keep the backdrop tappable to close (`closedby="any"` where supported, or a click handler on the dialog element).
- `max-height` in `dvh`, not `vh`, so the iOS toolbar doesn't cover the sheet.

**Sources:** https://developer.chrome.com/blog/entry-exit-animations · https://developer.mozilla.org/docs/Web/API/Element/setPointerCapture · https://developer.apple.com/design/human-interface-guidelines/sheets

## Direct manipulation: panels follow the finger 1:1 and finish on release

Dragged content moves with `translate` exactly as far as the finger, the gesture locks to an axis after ~10px so vertical scrolling survives, and on release it completes or snaps back by distance or flick speed, animating from its current offset. A swipe that only reacts after the finger lifts feels dead; tracking the finger is what makes swipe-back, swipe-to-reply and swipe-to-dismiss feel physical. The full implementation (axis lock, thresholds, velocity, edge swipes) is in [touch-gestures-input.md](touch-gestures-input.md); the motion rules are below.

```ts
// Release: animate from wherever the finger left it, then clear the inline style
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
export function settle(el: HTMLElement, dx: number, done: boolean, onDone: () => void): void {
  const a = el.animate({ translate: [`${dx}px 0`, done ? '100% 0' : '0 0'] },
    { duration: reduce.matches ? 0 : 220, easing: 'cubic-bezier(.2,0,0,1)', fill: done ? 'forwards' : 'none' });
  el.style.translate = '';
  if (done) void a.finished.then(onDone, () => {});
}
```

**Support:** Pointer Events, `setPointerCapture` and `touch-action`: Baseline (iOS Safari 13+). Individual `translate`: Chrome 104, Safari 14.1, Firefox 72. `getCoalescedEvents()`: Chrome 58, Safari 18.2, Firefox 59; `getPredictedEvents()`: Chrome 77, Safari 18.2, Firefox 89 (for ink, rarely for drags).

**Gotchas:**
- Turn off any CSS transition on the dragged property while dragging, or the element trails the finger.
- Pointer events arrive about once per frame, so writing the transform straight from the handler is fine; batch into rAF only if the handler also reads layout.
- Always snap back on `pointercancel` (the browser took over: vertical pan, system gesture).
- Keep thresholds in pure functions so they're unit-testable without a screen.

**Sources:** https://developer.mozilla.org/docs/Web/API/Element/setPointerCapture · https://developer.mozilla.org/docs/Web/CSS/touch-action · https://w3c.github.io/pointerevents/

## Interruptible motion: transitions for reversible state, WAAPI that starts from the current value

For state that can flip mid-animation (drawer open/closed, toggles) use CSS transitions: they retarget from the current on-screen value. Keyframe animations restart from frame 0, a visible jump; use them for one-shots. In JS, WAAPI can cancel, reverse and await, and start from `getComputedStyle`. Native animations can always be interrupted and turned around.

```css
/* Reversible: a transition retargets from wherever it is right now */
.drawer { translate: -100% 0; transition: translate 300ms var(--ease-standard); }
.drawer.open { translate: 0 0; }
```

```ts
// Animate from the current visual value to a new target; the final state lives in style, not in `fill`
export function animateTo(el: HTMLElement, translate: string, options: KeyframeAnimationOptions): Animation {
  const from = getComputedStyle(el).translate;     // includes any running animation's current value
  el.getAnimations().forEach((a) => a.cancel());
  el.style.translate = translate;
  return el.animate({ translate: [from, translate] }, options);
}

// Or commit an animation's end state and drop it, so fill animations don't pile up
export async function fadeIn(el: HTMLElement): Promise<void> {
  const a = el.animate({ opacity: [0, 1] }, { duration: 200, fill: 'forwards' });
  await a.finished;
  a.commitStyles(); a.cancel();
}
```

**Support:** `Element.animate`: Chrome 36, Safari 13.1 (iOS 13.4), Firefox 48. `finished`: Chrome 84, Safari 13.1 (iOS 13.4), Firefox 63. `commitStyles()`, `persist()`, `getAnimations()`: Chrome 84, Safari 13.1 (iOS 13.4), Firefox 75. `Animation.overallProgress`: Chrome 133, Safari 26.2, Firefox 142.

**Gotchas:**
- Many `fill: 'forwards'` animations stack and override later style changes (auto-removed only once replaced). Use `commitStyles()` + `cancel()`, or set the final style yourself.
- `commitStyles()` throws on an element that isn't rendered (`display: none`).
- WAAPI ignores CSS reduced-motion overrides: check `matchMedia` yourself.
- Reversed transitions are shortened in proportion to progress (the "reversing shortening factor"), which matches native.
- Keep animated properties compositor-only.

**Sources:** https://developer.mozilla.org/docs/Web/API/Element/animate · https://developer.mozilla.org/docs/Web/API/Animation/commitStyles · https://drafts.csswg.org/web-animations-1/

## Scroll-driven animations: collapsing large titles, progress bars and reveals without JS

`animation-timeline: scroll()` / `view()` or a named `scroll-timeline` drives a CSS animation from scroll position: an iOS-style large title that shrinks into the bar, a reading progress bar, cards that fade in. Native bars respond continuously to scroll; JS scroll listeners stutter under load and hurt INP. Header layout itself: [navigation-ui-patterns.md](navigation-ui-patterns.md).

```css
@supports (animation-timeline: scroll()) {
  .page { scroll-timeline: --page block; }   /* the scroller */
  .app { timeline-scope: --page; }            /* lets the header, outside the scroller, see the timeline */
  .large-title {
    animation: title-collapse linear both;
    animation-timeline: --page;                /* must come AFTER the `animation` shorthand, which resets it */
    animation-range: 0 56px;
  }
  .bar-title { animation: fade-in linear both; animation-timeline: --page; animation-range: 40px 64px; }
  .bar-hairline { animation: fade-in linear both; animation-timeline: --page; animation-range: 0 8px; }
  .read-progress { transform-origin: 0 50%; animation: grow linear both; animation-timeline: scroll(root block); }
  @media (prefers-reduced-motion: no-preference) {
    .card { animation: fade-in linear both; animation-timeline: view(); animation-range: entry 0% entry 60%; }
  }
}
@keyframes title-collapse { to { opacity: 0; scale: .9; translate: 0 -8px; } }
@keyframes fade-in { from { opacity: 0; } }
@keyframes grow { from { scale: 0 1; } }
```

**Support:** Chrome 115+ (desktop and Android). Safari 26.0+ (macOS and iOS, tab and home-screen app). Firefox: not in release (Nightly pref); an Interop 2026 focus area. `timeline-scope`: Chrome 116, Safari 26. `ScrollTimeline`/`ViewTimeline` JS classes: same.

**Gotchas:**
- Put `animation-timeline` after the `animation` shorthand: the most common "nothing happens".
- Without support the base style shows: make the no-timeline state correct (title visible, bar title hidden). An IntersectionObserver sentinel toggling a class is the JS fallback.
- Collapse with transform and opacity only, so content doesn't jump; if real height must change use `position: sticky` plus negative margin.
- Decorative scroll effects are motion: gate them behind `prefers-reduced-motion: no-preference`. Pure feedback (hairline, progress) can stay.

**Sources:** https://webkit.org/blog/17101/a-guide-to-scroll-driven-animations-with-just-css/ · https://developer.chrome.com/docs/css-ui/scroll-driven-animations · https://developer.mozilla.org/docs/Web/CSS/animation-timeline

## Bars that react to scroll state: hairline or shadow only when stuck or scrolled

`container-type: scroll-state` plus `@container scroll-state(stuck: top | scrollable | scrolled)` styles a sticky bar's contents depending on whether it's stuck or content has scrolled under it. iOS and Android bars are flat at rest and gain a separator only once content scrolls underneath; a permanent border is a small web tell. Sticky section headers: [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#sticky-section-headers-with-scroll-padding-and-a-stuck-state).

```css
.topbar { position: sticky; top: 0; container-type: scroll-state; }
.topbar > .inner { transition: box-shadow 150ms, background-color 150ms; }
@container scroll-state(stuck: top) {
  .topbar > .inner { box-shadow: 0 0.5px 0 rgb(0 0 0 / .18); background: var(--surface-bar); }
}
/* Safari 26+: the scroll-driven hairline fade from the previous section gives the same effect */
```

**Support:** Chromium 133+ (`stuck`, `snapped`, `scrollable`); `scrolled`: Chromium 144. Not in Safari or Firefox. Elsewhere use the scroll-driven version (Safari 26+) or an IntersectionObserver sentinel.

**Gotchas:**
- Container queries style descendants, never the container itself: hence `.inner`.
- Progressive enhancement: design the default as the "not stuck" look.

**Sources:** https://developer.chrome.com/blog/css-scroll-state-queries · https://drafts.csswg.org/css-conditional-5/#scroll-state-container

## Animate to and from height: auto (interpolate-size, calc-size, ::details-content, grid fallback)

`interpolate-size: allow-keywords` on `:root` lets sizes transition to and from `auto`/`min-content`/`fit-content`; `calc-size()` does it per property; `::details-content` targets the expanding part of `<details>`; the `grid-template-rows: 0fr → 1fr` trick works everywhere. Accordions and "show more" that snap open are a web tell. `<details name>` semantics: [navigation-ui-patterns.md](navigation-ui-patterns.md).

```css
:root { interpolate-size: allow-keywords; }            /* Chromium; inherited, so set it once */
details::details-content {
  block-size: 0; overflow: clip;
  transition: block-size var(--dur-small) var(--ease-standard), content-visibility var(--dur-small) allow-discrete;
}
details[open]::details-content { block-size: auto; }

/* Works everywhere: grid track interpolation */
.collapse { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-small) var(--ease-standard); }
.collapse.open { grid-template-rows: 1fr; }
.collapse > * { overflow: hidden; min-block-size: 0; }
```

**Support:** `interpolate-size`, `calc-size()`: Chromium 129+ only (not Safari 27, not Firefox 157). `::details-content`: Chrome 131, Safari 18.4, Firefox 143. Transitioning `content-visibility`: Chrome 117, Safari 18, not Firefox. `grid-template-rows` animation: Chrome 107, Safari 16, Firefox 66.

**Gotchas:**
- Without `interpolate-size` the details example just snaps open: a safe fallback.
- Height animation runs layout every frame: fine for a small panel, not for tall lists or many items (animate transform/clip-path or use a view transition).
- Content in a collapsed `.collapse` is still focusable and exposed: add `inert` or `hidden` when closed.

**Sources:** https://developer.chrome.com/docs/css-ui/animate-to-height-auto · https://developer.mozilla.org/docs/Web/CSS/interpolate-size · https://developer.mozilla.org/docs/Web/CSS/::details-content

## Staggered list entrances with sibling-index()

`sibling-index()` returns an element's position among its siblings, so a cascading delay needs no JS-set `--i`. A short, capped stagger on a screen's first fill gives the "content settling in" feel of native lists.

```css
@media (prefers-reduced-motion: no-preference) {
  .list.entering > li {
    animation: rise var(--dur-medium) var(--ease-enter) both;
    animation-delay: calc(min(sibling-index(), 8) * 30ms);   /* cap it: the last row shouldn't wait */
  }
}
@keyframes rise { from { translate: 0 8px; opacity: 0; } }
/* Older engines: li.style.setProperty('--i', String(i)) and calc(var(--i, 0) * 30ms) */
```

**Support:** `sibling-index()`/`sibling-count()`: Chrome 138, Safari 26.2 (macOS and iOS), Firefox 154: Baseline 2026. Engines without it drop the declaration and items appear without delay.

**Gotchas:**
- Stagger only the first fill (the `.entering` class, removed afterwards), never on re-render, filter or new messages.
- Keep the total stagger ≤ ~250ms.

**Sources:** https://developer.mozilla.org/docs/Web/CSS/sibling-index · https://drafts.csswg.org/css-values-5/#funcdef-sibling-index

## Animate only compositor-friendly properties; never `transition: all`

Animate `transform` (or `translate`, `scale`, `rotate`) and `opacity`, which the compositor runs without layout or paint. Fake the rest: fade a pre-painted shadow on a pseudo-element, use scale or FLIP instead of width/height. Animating `top`, `left`, `width`, `height`, `margin` or `box-shadow` forces layout or paint every frame and drops frames on phones, especially at 120Hz.

```css
.pressable { transition: scale 120ms var(--ease-standard), opacity 120ms; }   /* list properties explicitly */
.pressable:active { scale: .97; }

/* Shadow lift without animating box-shadow */
.card { position: relative; }
.card::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: var(--shadow-lg); opacity: 0; transition: opacity var(--dur-small);
}
.card:hover::after { opacity: 1; }
/* Individual transforms compose: a gesture sets `translate` while :active sets `scale` */
```

**Support:** `translate`/`scale`/`rotate`: Chrome 104, Safari 14.1, Firefox 72. Transform and opacity animations are composited in all engines.

**Gotchas:**
- `transition: all` also animates later layout and theme changes: costly and odd.
- `filter`/`backdrop-filter` animations can be composited but are expensive. Whether `clip-path` or `background-color` animations are composited varies by engine: check DevTools Performance or Lighthouse's "Avoid non-composited animations" rather than assuming.
- Animating a registered custom property repaints every frame.

**Sources:** https://web.dev/articles/animations-guide · https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count · https://developer.mozilla.org/docs/Web/CSS/translate

## will-change only around the gesture or animation, never as a blanket style

`will-change: transform` (or `translate`, `opacity`) promotes an element to its own layer ahead of time. Set it when a gesture starts and remove it when it ends: this avoids a first-frame hitch on drag start, while blanket promotion exhausts GPU memory and can make mobile Safari reload the tab.

```ts
export function promoteDuringDrag(handle: HTMLElement, target: HTMLElement): void {
  handle.addEventListener('pointerdown', () => { target.style.willChange = 'translate'; });
  const clear = (): void => { target.style.willChange = ''; };
  handle.addEventListener('pointerup', clear);
  handle.addEventListener('pointercancel', clear);
}
```

**Support:** `will-change`: Chrome 36, Safari 9.1, Firefox 36.

**Gotchas:**
- Browsers already promote elements while a transform/opacity animation runs: most CSS animations don't need it.
- Each layer costs about width × height × 4 bytes. Never on list rows or in a global stylesheet.
- A promoted layer scaled up can look blurry (rasterised at original size).
- `will-change: transform` creates a stacking context and a containing block for `position: fixed` descendants.
- `translateZ(0)` / `backface-visibility: hidden` hacks are obsolete.

**Sources:** https://developer.mozilla.org/docs/Web/CSS/will-change · https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count

## content-visibility: auto with contain-intrinsic-size for long feeds

`content-visibility: auto` skips layout and paint for off-screen children until they near the viewport; `contain-intrinsic-size: auto <estimate>` reserves a placeholder and then remembers the real size. `content-visibility: hidden` keeps a hidden subtree's rendering state warm. Long chats and feeds render, scroll and resize much faster, and unlike virtualization everything stays in the DOM (find-in-page, anchors, screen readers).

```css
.message { content-visibility: auto; contain-intrinsic-size: auto 72px; }
/* Without scroll anchoring (Safari < 27), rows resizing above the viewport shove the reader */
@supports not (overflow-anchor: auto) { .message { content-visibility: visible; } }
```

```ts
declare function pause(): void;
declare function resume(): void;
// Pause expensive work (video, timers) in rows being skipped
export function watchSkipping(row: HTMLElement): void {
  row.addEventListener('contentvisibilityautostatechange', (e) => {
    if ('skipped' in e && e.skipped === true) pause(); else resume();   // older lib.dom types this as a plain Event
  });
}
```

**Support:** `content-visibility`: Chrome 85, Firefox 125, Safari 18.0 (Baseline Sept 2024). `contain-intrinsic-size`: Chrome 83, Safari 17, Firefox 107 (the `auto none` value form: Chrome 117, Safari 17, Firefox 117). `contentvisibilityautostatechange`: Chrome 108, Safari 18, Firefox 130. Scroll anchoring: Chrome 56, Firefox 66, Safari 27.

**Gotchas:**
- `auto` applies layout, style and paint containment: anything overflowing the row is clipped (reaction pickers, menus, outset focus rings). Put popups in the top layer.
- A poor estimate makes the scrollbar thumb jump; the `auto` keyword fixes rows already seen.
- The `@supports` test is a feature check, so Safari 27 gets the optimisation back automatically; WebKit anchoring detection has been reported unreliable, so verify on a device.
- Little gain under ~100 simple rows.

**Sources:** https://web.dev/articles/content-visibility · https://developer.mozilla.org/docs/Web/CSS/content-visibility

## Virtualize truly huge lists (keep the DOM to about 3 screens of rows)

Windowing renders only rows near the viewport, positioned inside a full-height spacer, measuring dynamic heights as rows mount. With thousands of complex rows even `content-visibility` leaves too much DOM; native table views reuse cells and this is the web equivalent.

```tsx
// TanStack Virtual (framework-agnostic core; React adapter shown)
import { useVirtualizer } from '@tanstack/react-virtual';
const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 72, overscan: 8 });
return (
  <div ref={scrollRef} style={{ overflowY: 'auto', height: '100%', contain: 'strict' }}>
    <div style={{ height: v.getTotalSize(), position: 'relative' }}>
      {v.getVirtualItems().map((it) => {
        const row = rows[it.index];
        return row && (
          <div key={it.key} data-index={it.index} ref={v.measureElement} aria-setsize={rows.length} aria-posinset={it.index + 1}
               style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start}px)` }}>
            <Row row={row} />
          </div>
        );
      })}
    </div>
  </div>
);
```

**Support:** Library code on standard APIs (ResizeObserver: Chrome 64, Safari 13.1, Firefox 69): every current engine.

**Gotchas:**
- Use `content-visibility` first; virtualize only when profiling shows DOM size or memory is the problem (roughly beyond 1-2k rich rows).
- Windowing breaks find-in-page, anchor links, cross-row selection and screen-reader browsing (mitigate with `aria-setsize`/`aria-posinset`).
- Reverse chat lists: start at the bottom, keep the view stable when older rows are prepended, measure dynamic heights.
- Fast iOS momentum flings can outrun rendering (blank space): raise `overscan`. Keep the row cheap and memoised.

**Sources:** https://tanstack.com/virtual/latest · https://web.dev/articles/dom-size-and-interactivity

## No layout thrash: batch reads before writes, observe instead of polling

Reading geometry (`offsetHeight`, `getBoundingClientRect`, `scrollTop`) right after a style change forces a synchronous layout, and in a loop repeats it per item. Group all reads, then all writes; let ResizeObserver and IntersectionObserver report geometry; register scroll and touch listeners as passive (details: [touch-gestures-input.md](touch-gestures-input.md)). Forced layouts are the classic cause of janky scrolling and slow taps.

```ts
declare const items: HTMLElement[];
declare const header: HTMLElement, list: HTMLElement, topSentinel: HTMLElement;
declare function setHeaderHeight(h: number): void;
declare function loadOlder(): Promise<void>;

// Bad: one forced layout per item
// for (const el of items) el.style.height = `${el.scrollHeight}px`;
// Good: all reads, then all writes (one layout)
const heights = items.map((el) => el.scrollHeight);
items.forEach((el, i) => { el.style.height = `${heights[i] ?? 0}px`; });

// Observe instead of measuring in scroll handlers
new ResizeObserver(([entry]) => { if (entry) setHeaderHeight(entry.contentRect.height); }).observe(header);
new IntersectionObserver(([e]) => { if (e?.isIntersecting) void loadOlder(); }, { root: list, rootMargin: '800px 0px 0px 0px' }).observe(topSentinel);
```

**Support:** ResizeObserver: Chrome 64, Safari 13.1, Firefox 69. IntersectionObserver: Chrome 51, Safari 12.1, Firefox 55. Passive listeners: Baseline.

**Gotchas:**
- Layout-forcing reads include `offset*`/`client*`/`scroll*`, `getBoundingClientRect`, layout-dependent `getComputedStyle`, `innerText`, `focus()`, `scrollIntoView()`.
- Chrome DevTools flags "Forced reflow"; Long Animation Frame entries report `forcedStyleAndLayoutDuration`.
- A non-passive `touchmove` that may `preventDefault` blocks scrolling until it returns.

**Sources:** https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing · https://developer.chrome.com/docs/web-platform/long-animation-frames · https://developer.mozilla.org/docs/Web/API/ResizeObserver

## INP: show a visible response in the next frame, do the work afterwards, and measure it in the field

Interaction to Next Paint is the delay from a tap, click or key press to the next frame painted after it (input delay + processing + presentation delay). Good is ≤ 200ms at p75, poor > 500ms; native responds within a frame. Paint cheap feedback first (pressed state, optimistic row, pending state), then do the heavy work.

```ts
import { onINP } from 'web-vitals/attribution';
declare const saveButton: HTMLButtonElement;
declare function save(): Promise<void>;
// yieldToMain: see the next section

saveButton.addEventListener('click', async () => {
  saveButton.dataset.state = 'saving';   // cheap DOM write: what the next paint shows
  await yieldToMain();                   // let the browser paint it now
  await save();                          // heavy work no longer delays the feedback
});

onINP(({ value, rating, attribution }) => {
  navigator.sendBeacon('/rum', JSON.stringify({
    value, rating, target: attribution.interactionTarget, type: attribution.interactionType,
    inputDelay: attribution.inputDelay, processing: attribution.processingDuration, presentation: attribution.presentationDelay,
  }));
});
```

**Support:** Event Timing with `interactionId` (what INP needs): Chrome 96, Firefox 144, Safari 26.2 (macOS and iOS). LCP API: Chrome 77, Firefox 122, Safari 26.2. Long Animation Frames: Chromium 123+ only.

**Gotchas:**
- For a native feel aim well under "good": ~100ms for anything perceptible, the next frame for presses.
- With React: `startTransition` for non-urgent re-renders, `useDeferredValue` for typeahead, no whole-tree re-render per keystroke.
- A large DOM inflates presentation delay even with fast handlers.
- Test with 4-6× CPU throttling and on a real low-end Android phone.
- Work after the yield doesn't count toward INP, but the user still waits for its result: keep it fast or optimistic.

**Sources:** https://web.dev/articles/inp · https://web.dev/articles/optimize-inp · https://github.com/GoogleChrome/web-vitals

## Break up long tasks with scheduler.yield(), and use scheduler.postTask() for priorities

`scheduler.yield()` pauses an async function so input and paint can run, then resumes it at the front of the queue. `scheduler.postTask()` queues work at `'user-blocking'`, `'user-visible'` or `'background'` priority, abortable with a signal. Any task over 50ms delays the next tap; chunking parsing, decryption or indexing keeps the UI responsive.

```ts
// Typed locally: some lib.dom versions declare `scheduler` as always present, but Safari has none
type PostTaskOptions = { priority?: 'user-blocking' | 'user-visible' | 'background'; signal?: AbortSignal };
type Sched = { yield?: () => Promise<void>; postTask?: <T>(cb: () => T, opts?: PostTaskOptions) => Promise<T> };
const sched: Sched | undefined = (globalThis as { scheduler?: Sched }).scheduler;

export const yieldToMain = (): Promise<void> =>
  sched?.yield ? sched.yield() : new Promise((r) => { setTimeout(r, 0); });

export async function processInChunks<T>(items: readonly T[], work: (item: T) => void, budgetMs = 8): Promise<void> {
  let deadline = performance.now() + budgetMs;
  for (const item of items) {
    work(item);
    if (performance.now() > deadline) { await yieldToMain(); deadline = performance.now() + budgetMs; }
  }
}

// Low-priority background work that can be cancelled
export function background(task: () => void, signal: AbortSignal): void {
  if (sched?.postTask) { sched.postTask(task, { priority: 'background', signal }).catch(() => {}); return; } // rejects on abort
  const id = setTimeout(task, 0);
  signal.addEventListener('abort', () => clearTimeout(id), { once: true });
}
```

**Support:** `scheduler.yield()`: Chrome 129, Firefox 142, Safari no (macOS or iOS). `scheduler.postTask()` and `TaskController`: Chrome 94, Firefox 142, Safari no. `requestIdleCallback`: Chrome 47, Firefox 55, Safari not enabled by default. `isInputPending()`: Chromium-only, superseded by `scheduler.yield()`; don't use it.

**Gotchas:**
- Never reference a bare `scheduler` global: Safari throws `ReferenceError`. Always guard.
- The `setTimeout` fallback sends the continuation to the back of the queue; nested timeouts clamp to ≥ 4ms after 5 levels. GoogleChromeLabs/scheduler-polyfill handles fallbacks.
- Yielding makes work interruptible, not faster. Very heavy CPU work belongs in a [Worker](#move-heavy-cpu-work-off-the-main-thread-into-web-workers).
- The 8ms budget assumes ~60Hz; during animations at 120Hz yield more often.

**Sources:** https://developer.chrome.com/blog/use-scheduler-yield · https://web.dev/articles/optimize-long-tasks · https://developer.mozilla.org/docs/Web/API/Scheduler/yield

## Move heavy CPU work off the main thread into Web Workers

Module workers run parsing, search indexing, markdown rendering, image processing, diffing and CRDT merges on another thread. Large binary data is transferred, not copied; OffscreenCanvas moves canvas rendering too. On native the UI thread stays free for input; in a browser, CPU-heavy main-thread work blocks gestures however much you yield.

```ts
// main.ts
declare const bytes: Uint8Array<ArrayBuffer>;
declare function parseResult(data: unknown): { hits: string[] } | null;
declare function show(r: { hits: string[] }): void;
const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ kind: 'index', bytes }, [bytes.buffer]);   // transfer the ArrayBuffer: zero-copy
worker.addEventListener('message', (e: MessageEvent<unknown>) => { const r = parseResult(e.data); if (r) show(r); });
```

```ts
// search.worker.ts
/// <reference lib="webworker" />
declare function parseRequest(data: unknown): { kind: 'index'; bytes: Uint8Array } | null;
declare function runIndex(req: { kind: 'index'; bytes: Uint8Array }): unknown;
self.addEventListener('message', (e: MessageEvent<unknown>) => {
  const req = parseRequest(e.data);              // validate: messages are untrusted input
  if (req) self.postMessage(runIndex(req));
});
```

**Support:** Module workers: Chrome 80, Safari 15, Firefox 114. OffscreenCanvas: Chrome 69, Safari 16.4 (WebGL contexts from 17), Firefox 105. Transferable ArrayBuffers: Baseline.

**Gotchas:**
- `postMessage` structured-clones its argument; cloning huge object graphs can cost more than the work. Send compact data or transfer buffers.
- Workers have no DOM. Bundlers (Vite, webpack 5) recognise the `new URL(…, import.meta.url)` form; Comlink turns messages into async calls.
- Web Crypto's `subtle` is async but may still run on the main thread in some engines: profile before moving it.

**Sources:** https://developer.mozilla.org/docs/Web/API/Worker/Worker · https://web.dev/articles/off-main-thread · https://github.com/GoogleChromeLabs/comlink

## Optimistic UI: apply the result immediately, reconcile later, and use undo instead of confirmation

Render the outcome of an action (sent message, toggled like, deleted row) before the network confirms it; mark it pending, reconcile on acknowledgment, and keep it with a retry if it fails. For destructive actions, hide the item now and send the delete only after an undo window closes. Spinners after every tap are the biggest perceived-speed web tell. Offline outbox: [offline-push-storage.md](offline-push-storage.md#outbox-plus-background-sync-with-a-fallback-that-works-everywhere).

```ts
type Msg = { id: string; text: string; status: 'sending' | 'sent' | 'failed'; at: number };
declare const store: { add(m: Msg): void; replace(id: string, m: Msg): void; patch(id: string, p: Partial<Msg>): void };
declare const api: { send(m: Msg): Promise<Msg> };
declare const hidden: Set<string>;
declare function render(): void;
declare function publishDelete(id: string): void;
declare function toast(o: { title: string; actionLabel: string; duration: number; onAction: () => void; onDismiss: () => void }): void;

export async function send(text: string): Promise<void> {
  const temp: Msg = { id: crypto.randomUUID(), text, status: 'sending', at: Date.now() };
  store.add(temp);                                         // visible in the same frame as the tap
  try {
    const saved = await api.send(temp);                    // the client id doubles as the idempotency key
    store.replace(temp.id, { ...saved, status: 'sent' });
  } catch {
    store.patch(temp.id, { status: 'failed' });            // keep it, show "Tap to retry"; never drop it silently
  }
}

// The delete is only sent when the toast goes away, so Undo always wins while it's visible
export function deleteWithUndo(id: string): void {
  let undone = false;
  hidden.add(id); render();
  toast({ title: 'Message deleted', actionLabel: 'Undo', duration: 5000,
    onAction: () => { undone = true; hidden.delete(id); render(); },
    onDismiss: () => { if (!undone) { hidden.delete(id); publishDelete(id); } } });
}
```

**Support:** Pattern only; works everywhere. React 19's `useOptimistic` provides the reconcile and rollback for actions.

**Gotchas:**
- Generate ids on the client so retries and acks can't duplicate; order by server time once acknowledged.
- Show pending state subtly (dimmed clock icon, reduced opacity), not a spinner.
- Don't be optimistic about things that can't be undone and are often rejected (payments, permission changes).
- If the app can close during the undo window, flush pending deletes on `pagehide`/`visibilitychange`, or persist them.

**Sources:** https://react.dev/reference/react/useOptimistic · https://www.nngroup.com/articles/response-times-3-important-limits/

## Skeletons instead of spinners for content, and loaders that only appear after a delay

When the layout is known, show a skeleton that matches it. Delay every loading indicator ~300-500ms with a CSS animation delay so fast loads never flash a loader, and keep stale content on screen while revalidating. Spinners draw attention to waiting; a loader that blinks for 80ms makes a fast app look slow. Designed empty/error/offline states: [navigation-ui-patterns.md](navigation-ui-patterns.md).

```css
/* Invisible for the first 400ms, then fades in: no JS timers */
.loader { animation: appear 200ms 400ms both; }
@keyframes appear { from { opacity: 0; } }

.skeleton {
  border-radius: 6px;
  background: linear-gradient(90deg, var(--sk) 25%, var(--sk-hi) 50%, var(--sk) 75%) 0 0 / 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
```

```html
<!-- Mark the busy region for assistive tech -->
<section aria-busy="true" aria-label="Messages"><div class="skeleton" style="height:56px"></div>…</section>
```

**Support:** Plain CSS; everywhere.

**Gotchas:**
- Timing (NN/g): < 100ms needs no indicator; up to ~1s keep old content or a skeleton; longer gets progress; > ~10s needs a determinate bar.
- A skeleton that doesn't match the final layout causes layout shift.
- Spinners only inside the control that triggered an action, never for the whole screen.
- Animating `background-position` repaints every frame: fine for a few blocks; for many, translate a gradient pseudo-element.
- With stale-while-revalidate, cached content shows at once and the skeleton only appears on a true cold start.

**Sources:** https://www.nngroup.com/articles/skeleton-screens/ · https://www.nngroup.com/articles/response-times-3-important-limits/ · https://web.dev/articles/stale-while-revalidate

## Instant tap feedback

Every tappable element needs a pressed state that appears the instant a finger lands and eases out on release (instant press, eased release; animate `scale`/`opacity` only). The mechanics (`:active` on iOS needing a touch listener, removing the tap highlight, hover only for `(hover: hover) and (pointer: fine)`, `touch-action: manipulation`, firing actions on click not pointerdown) are owned by [touch-gestures-input.md](touch-gestures-input.md).

```css
.pressable { transition: scale var(--dur-press) var(--ease-standard), background-color var(--dur-press); }
.pressable:active { scale: .97; background: var(--surface-pressed); transition-duration: 0s; } /* press instant, release eased */
```

**Support:** `:active` and the individual `scale` property: Baseline (iOS needs the touch-listener fix; see the gestures file).

**Gotchas:**
- Removing the tap highlight without an `:active` style leaves no feedback at all.
- Inside scrollers iOS delays the pressed state slightly to tell a tap from a scroll, which matches native.

**Sources:** https://developer.mozilla.org/docs/Web/CSS/:active · https://developer.mozilla.org/docs/Web/CSS/@media/hover

## App shell instant start: the first frame comes from HTML and the cache, not from JS

Ship a static shell (bars plus skeleton) with inline critical CSS in `index.html`, so the first paint looks like the app before any JS runs; serve it from the service-worker cache; set `color-scheme` and `theme-color` early so there's no white flash; show last-known data from IndexedDB before the network answers. A white screen then a spinner during JS boot is the most obvious "it's a website" moment of a PWA launch. Precaching and the worker: [offline-push-storage.md](offline-push-storage.md#precache-the-app-shell-with-workbox-injectmanifest-vs-generatesw); theme-color and `background_color`: [install-and-identity.md](install-and-identity.md).

```html
<head>
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#111111" media="(prefers-color-scheme: dark)">
  <link rel="preconnect" href="https://api.example.com" crossorigin>
  <style>/* inline critical CSS: tokens, shell layout, skeleton; body has an explicit background */</style>
  <script type="module" src="/assets/app.js"></script>
</head>
<body><div id="app"><header class="bar"></header><main class="skeleton-list" aria-busy="true"></main></div></body>
```

```ts
// sw.ts: answer SPA navigations with the cached shell
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(caches.match('/index.html').then((r) => r ?? fetch(e.request)));
});
```

**Support:** Service workers and Cache Storage: Baseline (iOS 11.3+, tab and home-screen app). `color-scheme` meta: Baseline. `theme-color`: Chrome Android 92 (full), Chrome desktop partial (installed apps), Safari 15+; Firefox ignores it. Navigation preload: Chrome 59, Safari 15.4, Firefox 99.

**Gotchas:**
- Navigation preload only helps network-first navigations; with a cache-first shell leave it off.
- Hash every asset and precache it with the shell, or an updated shell references chunks that no longer exist.
- Hydrate from local data first so the first real frame shows content, not a skeleton.
- Keep service-worker decisions in a unit-tested pure module with thin wiring in the worker.
- Avoid large inline scripts in `<head>`; they delay first paint.

**Sources:** https://web.dev/articles/app-shell · https://web.dev/articles/stale-while-revalidate · https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/meta/name/theme-color

## Keep previous screens alive instead of unmounting them

Instead of unmounting the previous screen on push, keep it in the DOM, `inert` and with rendering skipped (`content-visibility: hidden`, or React's `<Activity mode="hidden">`). On back it reappears instantly, exactly as it was, like a native navigation stack. Saving and restoring scroll per history entry: [navigation-ui-patterns.md](navigation-ui-patterns.md).

```css
/* Screens stacked in one grid cell; hidden ones keep DOM, state and layout but cost nothing to render */
.stack { display: grid; }
.stack > .screen { grid-area: 1 / 1; min-block-size: 0; }
.stack > .screen[inert] { content-visibility: hidden; }
```

**Support:** `content-visibility: hidden`: Chrome 85, Safari 18, Firefox 125. `inert`: Chrome 102, Safari 15.5, Firefox 112. React `<Activity>`: stable since React 19.2.

**Gotchas:**
- React's Activity hides with `display: none`, which resets inner scrollers' scroll position in most engines: save and restore `scrollTop` yourself, and verify `content-visibility: hidden` keeps it in your target browsers.
- Cap how many screens stay alive (e.g. 5) to bound memory; hidden screens pause timers, subscriptions and video.
- Don't make a screen `display: none`/`visibility: hidden` if it's about to be a view-transition source.

**Sources:** https://web.dev/articles/content-visibility · https://react.dev/reference/react/Activity · https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/inert

## Instant navigation: Speculation Rules prerender for multi-page apps, intent-based preloading for SPAs

`<script type="speculationrules">` lets Chromium prefetch or fully prerender likely next pages on hover or viewport heuristics, turning a navigation into a swap of an already-rendered page. In an SPA, start loading a route's code and data on `pointerdown` or hover, ~100ms before the click.

```html
<script type="speculationrules">
{
  "prerender": [{ "where": { "and": [{ "href_matches": "/*" }, { "not": { "href_matches": "/logout" } }] }, "eagerness": "moderate" }],
  "prefetch": [{ "where": { "href_matches": "/*" }, "eagerness": "conservative" }]
}
</script>
```

```ts
// SPA: warm route chunks on intent
const routeLoaders = new Map<string, () => Promise<unknown>>([
  ['/settings', () => import('./routes/settings')],
  ['/search', () => import('./routes/search')],
]);
document.addEventListener('pointerdown', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  const href = a?.getAttribute('href');
  if (href) void routeLoaders.get(new URL(href, location.href).pathname)?.();
}, { passive: true });
```

**Support:** Speculation rules: Chromium only (prerender Chrome 105 desktop / 103 Android, prefetch Chrome 110 desktop / 103 Android, `eagerness` and the `Speculation-Rules` header 121). Safari 26.2+: prefetch behind a feature flag only (macOS and iOS). Firefox: none. Detect with `HTMLScriptElement.supports('speculationrules')`.

**Gotchas:**
- Prerendered pages run JS: defer analytics and side effects until `document.prerendering` is false (`prerenderingchange`).
- Never prerender URLs that change state on GET (logout, add to cart).
- Eagerness heuristics change between Chrome versions (desktop hover delay, mobile viewport heuristics); test on current Chrome.
- Doesn't help an SPA's in-app routes; the pointerdown preload does. Watch data use on metered connections.

**Sources:** https://developer.chrome.com/docs/web-platform/prerender-pages · https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/script/type/speculationrules

## Web fonts that don't shift, and the system font

The system font stack, iOS Dynamic Type (`font: -apple-system-body`) and rem-based sizing are owned by [navigation-ui-patterns.md](navigation-ui-patterns.md): the system font is also the fastest font, at zero bytes. If you need a brand font, preload it and pair it with a metric-matched fallback so the swap causes no reflow (CLS).

```html
<link rel="preload" href="/fonts/brand.woff2" as="font" type="font/woff2" crossorigin>
```

```css
@font-face { font-family: 'Brand'; src: url(/fonts/brand.woff2) format('woff2'); font-display: swap; }
@font-face { font-family: 'Brand Fallback'; src: local('Arial'); size-adjust: 104%; }
h1 { font-family: 'Brand', 'Brand Fallback', system-ui, sans-serif; }
```

**Support:** `font-display`: Baseline. `size-adjust`: Chrome 92, Safari 17, Firefox 92. `ascent-override`/`descent-override`: Chrome 87, Firefox 89; Safari only in Technology Preview. `-webkit-font-smoothing`: macOS only.

**Gotchas:**
- `font-display: optional` avoids any swap, at the cost of sometimes showing the fallback on first visit.
- Tune `size-adjust` (and the overrides where supported) per font; tools such as Fontaine or Capsize compute them.
- Use tabular numbers for changing values ([layout stability](#layout-stability-craft-tabular-numbers-scrollbar-gutter-reserved-media-space)).

**Sources:** https://web.dev/articles/font-best-practices · https://developer.mozilla.org/docs/Web/CSS/@font-face/size-adjust

## Layout stability craft: tabular numbers, scrollbar-gutter, reserved media space

Small rules that stop things jumping: tabular numerals for ticking values, a stable scrollbar gutter on desktop, intrinsic sizes or `aspect-ratio` on media, min-heights for async slots. Native UIs never shift because a counter went from 9 to 10 or an avatar loaded; these shifts add up to CLS.

```css
.timestamp, .badge, .duration, .unread-count { font-variant-numeric: tabular-nums; }   /* digits keep the same width */
html { scrollbar-gutter: stable; }   /* desktop: no sideways jump when a modal hides the scrollbar */
img, video { max-inline-size: 100%; block-size: auto; }   /* with width/height attributes: space reserved before load */
.avatar { inline-size: 40px; aspect-ratio: 1; border-radius: 50%; }
.embed { aspect-ratio: 16 / 9; }
.link-preview-slot { min-block-size: 88px; }
```

**Support:** `font-variant-numeric`, `aspect-ratio`: Baseline. `scrollbar-gutter`: Chrome 94, Firefox 97, Safari 18.2; no effect with overlay scrollbars (phones, default macOS), where nothing shifts anyway.

**Gotchas:**
- `scrollbar-gutter: stable` on `html` always reserves the gutter, even on short pages; use `stable both-edges` if a centred layout looks off. Scrollbar styling: [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#desktop-scrollbars-stable-gutter-thin-themed-bars-hidden-on-strips).
- CLS also comes from late fonts and injected banners.

**Sources:** https://developer.mozilla.org/docs/Web/CSS/scrollbar-gutter · https://web.dev/articles/cls · https://developer.mozilla.org/docs/Web/CSS/font-variant-numeric

## Image loading and decoding that never pops in half-painted

Give the LCP image `fetchpriority="high"` and no lazy loading; lazy-load and async-decode everything else; decode a replacement with `img.decode()` before swapping; fade in over a blurred placeholder. Native apps show an image whole, often with a short fade.

```html
<img src="/hero.avif" width="1200" height="800" alt="" fetchpriority="high">
<img src="/avatar.webp" width="40" height="40" alt="" loading="lazy" decoding="async">
```

```ts
// Swap without a half-decoded frame (avatar change, gallery next)
export async function swapImage(img: HTMLImageElement, src: string): Promise<void> {
  const next = new Image(img.width, img.height);
  next.alt = img.alt; next.className = img.className; next.src = src;
  await next.decode().catch(() => {});   // rejects for broken images
  img.replaceWith(next);
}
```

```css
/* Fade in over a low-quality placeholder; add .loaded in a load listener */
.media { background: var(--lqip) center / cover; }
.media img { opacity: 0; transition: opacity var(--dur-small); }
.media img.loaded { opacity: 1; }
```

**Support:** `loading=lazy`: Chrome 77, Safari 15.4, Firefox 75. `fetchpriority`: Chrome 101, Safari 17.2, Firefox 132. `decoding` and `decode()`: Baseline (Safari 11.1+).

**Gotchas:**
- Never lazy-load the LCP or above-the-fold images.
- Changing `src` on an in-DOM `decoding=async` image can flash for a frame, hence the new element.
- Always set `width`/`height` (or `aspect-ratio`).
- Cache avatars in the service worker so scrolling lists don't re-fetch them.
- Huge images can crash the tab on low-memory iOS devices: serve slot-sized images (`srcset`/`sizes`).

**Sources:** https://web.dev/articles/fetch-priority · https://developer.mozilla.org/docs/Web/API/HTMLImageElement/decode · https://web.dev/articles/browser-level-image-lazy-loading

## prefers-reduced-motion done right: remove movement, keep the feedback

Under `prefers-reduced-motion: reduce`, replace sliding, zooming, parallax and bouncing with instant changes or short cross-fades. Cover CSS, view-transition pseudo-elements, WAAPI and JS. Keep durations at 1ms, not 0, so end events still fire. iOS and Android swap motion for dissolves when Reduce Motion is on; users with vestibular disorders depend on it (WCAG 2.3.3), and removing all feedback makes the app feel dead.

```css
/* Opt in to big motion; everyone keeps state feedback */
@media (prefers-reduced-motion: no-preference) {
  .sheet[open] { transition: translate 500ms var(--spring-smooth); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important; animation-iteration-count: 1 !important;
    transition-duration: 1ms !important; scroll-behavior: auto !important;
  }
  /* `*` doesn't match view-transition pseudo-elements */
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
}
```

```ts
// JS-driven motion (WAAPI, springs, scrollIntoView) ignores CSS overrides
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
export const ms = (n: number): number => (reduceMotion.matches ? 0 : n);
export const reveal = (el: Element): void => el.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'nearest' });
```

**Support:** `prefers-reduced-motion`: Chrome 74, Safari 10.1, Firefox 63 (Baseline). The OS setting reaches the browser on iOS (tab and home-screen app), Android, macOS and Windows.

**Gotchas:**
- A transition whose duration + delay is 0s never starts, so `transitionend` never fires and code waiting on it hangs. Use 1ms or 0.01ms.
- Finger-tracking gestures are user-controlled and can stay; turn off their fling and bounce continuations.
- Consider suppressing haptics under reduced motion too.
- Animation delays aren't shortened, so delayed loaders still work.
- Listen for `change` on the MediaQueryList if you cache the value. An in-app "Reduce motion" toggle can add a class on `<html>` that overrides the OS setting.

**Sources:** https://developer.mozilla.org/docs/Web/CSS/@media/prefers-reduced-motion · https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions · https://drafts.csswg.org/css-transitions/#starting

## Translucent blurred bars (backdrop-filter), with reduced-transparency and contrast fallbacks

A sticky bar with a semi-transparent background and `backdrop-filter: saturate() blur()`, so content blurs as it scrolls underneath; solid when blur is unsupported or the user asks for less transparency or more contrast. Frosted chrome is the defining iOS/macOS bar look (and the closest portable approximation of iOS 26's Liquid Glass). Bar layout and large titles: [navigation-ui-patterns.md](navigation-ui-patterns.md).

```css
.bar {
  position: sticky; top: 0; z-index: 10;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  -webkit-backdrop-filter: saturate(180%) blur(20px);   /* Safari before 18 */
  backdrop-filter: saturate(180%) blur(20px);
  border-block-end: 0.5px solid color-mix(in srgb, var(--text) 15%, transparent);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .bar { background: var(--surface); } }
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .bar { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
```

**Support:** `backdrop-filter`: Chrome 76, Firefox 103, Safari 18 unprefixed (`-webkit-` since Safari 9). `color-mix()`: Chrome 111, Safari 16.2, Firefox 113. `prefers-reduced-transparency`: Chromium 118+ only (Safari no, so iOS "Reduce Transparency" isn't visible to the web; Firefox behind a flag). `prefers-contrast`: Chrome 96, Safari 14.1, Firefox 101.

**Gotchas:**
- Content must actually scroll under the bar (sticky inside the scroller, or fixed with padded content), or there's nothing to blur.
- `backdrop-filter` makes the bar a containing block for fixed/absolute descendants: dropdowns inside get positioned and clipped by it. Render menus in the top layer.
- Large or many blurred areas are costly on low-end Android; animating the blur radius is very costly.
- Liquid Glass refraction isn't portable (`backdrop-filter: url(#svg)` is Chromium-only): don't chase it.
- A 0.5px hairline renders on high-DPI screens and rounds to 1px on 1× screens.

**Sources:** https://developer.mozilla.org/docs/Web/CSS/backdrop-filter · https://developer.mozilla.org/docs/Web/CSS/@media/prefers-reduced-transparency

## 120Hz-aware motion: time-based animation loops, and knowing when Safari caps you at 60fps

Drive JS animation from the rAF timestamp, not a frame count, so speed is identical at 30-144Hz. Prefer CSS and WAAPI on compositor properties, which run at the display rate. At 120Hz a frame is ~8.3ms; frame-count code runs twice as fast and main-thread animation stutters next to native scrolling.

```ts
// Fling continuation after a drag, independent of frame rate.
// 0.998 per ms is UIScrollView's 'normal' deceleration rate.
export function fling(el: HTMLElement, x0: number, v0: number /* px/ms */, onDone?: () => void): void {
  let x = x0, v = v0, last = performance.now();
  const step = (now: number): void => {
    const dt = Math.min(now - last, 32); last = now;   // clamp long gaps (tab switch, jank)
    v *= Math.pow(0.998, dt);
    x += v * dt;
    el.style.translate = `${x}px 0`;
    if (Math.abs(v) > 0.02) requestAnimationFrame(step); else onDone?.();
  };
  requestAnimationFrame(step);
}
```

**Support:** `requestAnimationFrame`: Baseline. Chromium (desktop, Android) and Firefox run rAF at the display rate. Safari on ProMotion devices (iOS, iPadOS, macOS) limits page rendering updates, rAF included, to ~60fps by default ("Prefer Page Rendering Updates near 60fps"), while native scrolling stays at 120Hz; users can turn the flag off in Safari's Feature Flags, and it has reappeared after iOS updates. In iOS Low Power Mode rAF and animations drop to ~30fps. Cross-origin iframes are throttled until interacted with.

**Gotchas:**
- Never hard-code 16.67ms or count frames. At 120Hz the JS budget per frame is roughly 4-6ms.
- You can't opt into 120Hz from a page in Safari: don't build anything that only feels right at 120Hz.
- Background tabs pause rAF entirely, hence the `dt` clamp.
- Hand motion that needs no per-frame logic to CSS/WAAPI, which stays smooth while the main thread is busy.

**Sources:** https://bugs.webkit.org/show_bug.cgi?id=173434 · https://developer.apple.com/documentation/uikit/uiscrollview/decelerationrate-swift.struct · https://developer.mozilla.org/docs/Web/API/Window/requestAnimationFrame

## Animate gradients, rings and counters with typed custom properties (@property)

Registering a custom property with a `syntax` (`<angle>`, `<percentage>`, `<color>`, `<number>`) makes it animatable, so progress rings, conic gradients and colour shifts transition smoothly instead of stepping.

```css
@property --progress { syntax: '<percentage>'; inherits: false; initial-value: 0%; }
.ring {
  inline-size: 28px; aspect-ratio: 1; border-radius: 50%;
  background: conic-gradient(var(--accent) var(--progress), var(--track) 0);
  mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
  transition: --progress 300ms var(--ease-standard);
}
/* el.style.setProperty('--progress', `${pct}%`) */
```

**Support:** `@property`: Chrome 85, Safari 16.4, Firefox 128 (Baseline July 2024). `CSS.registerProperty()`: Chrome 78, Safari 16.4, Firefox 128.

**Gotchas:**
- Custom-property animation repaints every frame and isn't composited: fine for rings and badges, not full-screen backgrounds.
- Use `inherits: false` unless children need the value.

**Sources:** https://developer.mozilla.org/docs/Web/CSS/@property · https://web.dev/articles/at-property

## Theme and appearance switches without a transition storm

Switching light/dark or accent restarts every colour transition at once. Cross-fade the page once with a view transition, or disable transitions for the frame in which the theme changes. Native appearance changes are one clean cross-fade. Theme state, `color-scheme` and `theme-color` sync: [navigation-ui-patterns.md](navigation-ui-patterns.md) and [install-and-identity.md](install-and-identity.md).

```ts
export function setTheme(next: 'light' | 'dark'): void {
  const root = document.documentElement;
  const apply = (): void => { root.dataset.theme = next; };
  // typeof, not `in`: lib.dom always declares it, so an `in` check would narrow `document` to never below
  if (typeof document.startViewTransition === 'function') { document.startViewTransition(apply).ready.catch(() => {}); return; } // one composited cross-fade
  const off = document.createElement('style');
  off.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.append(off);
  apply();
  void getComputedStyle(document.body).color;   // commit the new styles while transitions are off
  setTimeout(() => off.remove(), 1);
}
```

**Support:** Same-document View Transitions: Chrome 111, Safari 18, Firefox 144. The fallback works everywhere.

**Gotchas:**
- Also update `<meta name="theme-color">` and `color-scheme` so browser UI and form controls switch too.
- When the OS appearance changes while the app is open, the browser restyles at once: keep colour transitions off except where a specific interaction needs them.

**Sources:** https://developer.mozilla.org/docs/Web/API/Document/startViewTransition · https://github.com/pacocoursey/next-themes

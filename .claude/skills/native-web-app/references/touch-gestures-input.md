<!-- verified 2026-10-02: 9 corrections -->
# Touch, gestures, haptics and text input

How a web app should respond to fingers, mice, pens and keyboards so it feels like a native app: gestures that never
fight scrolling or the OS, instant press feedback, haptics where the platform allows them, the right on-screen keyboard,
and desktop input that stays desktop-like. Support data is MDN browser-compat-data 8.1.4 (2026-10-01) unless noted.

## Checklist

- [ ] **must** — Use Pointer Events for all input; run custom gestures only for `pointerType === 'touch'` → [section](#pointer-events-as-the-single-input-model)
- [ ] **must** — Declare `touch-action` per surface (`manipulation` on the root, `pan-y pinch-zoom` on swipe rows, `none` only on small handles) → [section](#touch-action-declares-what-the-browser-keeps)
- [ ] **must** — Keep touch and wheel listeners passive; opt into `passive: false` narrowly and check `cancelable` → [section](#passive-listeners-by-default)
- [ ] **must** — Lock each gesture to one axis after a ~10px slop → [section](#axis-locking-with-a-slop-threshold)
- [ ] **must** — Keep drawer edge swipes out of the system back gesture's way; never commit on `pointercancel` → [section](#edge-swipes-versus-system-back-gestures)
- [ ] **must** — Replace the browser's long-press callout with your own menu on touch → [section](#long-press-context-menus)
- [ ] **must** — Remove the tap delay and double-tap zoom without blocking pinch-zoom → [section](#no-tap-delay-and-no-double-tap-zoom)
- [ ] **must** — Remove the grey tap highlight and give every tappable element an immediate `:active` state → [section](#tap-highlight-and-pressed-states)
- [ ] **must** — Wrap hover styles in `@media (hover: hover) and (pointer: fine)` → [section](#no-sticky-hover-on-touch)
- [ ] **must** — Size hit targets by pointer type (44px on coarse pointers) → [section](#hit-targets-sized-by-pointer-type)
- [ ] **must** — Do activation-gated work (audio, focus, vibrate, popups) in `pointerup`/`click`, not touch `pointerdown` → [section](#user-activation-rules-on-touch)
- [ ] **must** — Autofocus fields only with a fine pointer; on touch, focus synchronously inside the tap → [section](#do-not-pop-the-keyboard-unasked)
- [ ] **must** — Give every field the right `type`, `inputmode` and `enterkeyhint` → [section](#the-right-on-screen-keyboard)
- [ ] **must** — Make UI chrome unselectable and content selectable → [section](#selection-behaviour)
- [ ] **should** — Commit swipes on distance or a fast flick, using velocity from recent samples → [section](#swipe-completion-by-distance-or-flick)
- [ ] **should** — Build swipe-to-act rows that follow the finger, resist past the threshold and signal arming → [section](#swipe-to-act-rows)
- [ ] **should** — Use rubber-band resistance instead of hard clamps → [section](#rubber-band-resistance)
- [ ] **should** — Use CSS scroll-snap for pagers, carousels and reveal-actions rows → [section](#native-momentum-with-css-scroll-snap)
- [ ] **should** — Let full-screen panels close with a right swipe and overlays with system Back → [section](#swipe-to-close-panels-and-system-back)
- [ ] **should** — Let sheets be dragged down to dismiss when their content is at the top → [section](#swipe-down-to-dismiss-sheets)
- [ ] **should** — Stop root bounce, scroll chaining and browser pull-to-refresh → [section](#overscroll-behavior-for-gestures)
- [ ] **should** — Build a custom pull-to-refresh, or better, refresh automatically → [section](#custom-pull-to-refresh)
- [ ] **should** — Offer desktop right-click menus, hover action bars and keyboard access, keeping native menus where they belong → [section](#desktop-context-menus-and-hover-actions)
- [ ] **should** — Reorder with pointer-driven drags on a handle, with autoscroll and a keyboard path → [section](#drag-and-drop-on-touch)
- [ ] **should** — Pinch, pan and double-tap zoom inside image viewers only → [section](#pinch-zoom-and-pan-in-image-viewers)
- [ ] **should** — Add Android haptics with the Vibration API, gated by a setting, reduced motion and activation → [section](#haptics-on-android)
- [ ] **should** — Unlock audio on the first tap so later sounds can play → [section](#unlock-audio-on-the-first-tap)
- [ ] **should** — Use precise `autocomplete` tokens, `one-time-code` and WebOTP → [section](#autofill-and-one-time-codes)
- [ ] **should** — Tune autocapitalize, autocorrect, spellcheck and writing suggestions per field → [section](#text-correction-per-field)
- [ ] **should** — Make Enter-to-send IME-safe and platform-appropriate, with an auto-growing composer → [section](#enter-to-send-done-right)
- [ ] **should** — Add desktop shortcuts with platform modifiers and layer-aware Escape → [section](#desktop-keyboard-shortcuts)
- [ ] **should** — Stop drag ghosts and callouts on UI images and links → [section](#no-ghost-drags-or-callouts-on-ui-images)
- [ ] **should** — Show focus rings only for keyboard users → [section](#focus-rings-only-for-keyboard-users)
- [ ] **should** — Render drags with transforms once per frame; use coalesced events for ink → [section](#smooth-drag-rendering)
- [ ] **nice** — Get iPhone haptics through the native switch label trick → [section](#haptics-on-iphone-with-the-switch-trick)
- [ ] **nice** — Play subtle UI sounds through Web Audio with an ambient audio session → [section](#subtle-ui-sounds)
- [ ] **nice** — Use `cursor: default` on chrome, `pointer` on links, `grab` on draggables → [section](#cursors-on-desktop)
- [ ] **nice** — Settle released drags with the finger's velocity → [section](#release-animations-that-continue-the-velocity)
- [ ] **nice** — Detect double-tap yourself for like or zoom → [section](#custom-double-tap-gestures)
- [ ] **nice** — Use interest invokers for hover cards on Chromium → [section](#interest-invokers-for-hover-cards)

## Pointer Events as the single input model

Handle `pointerdown/move/up/cancel` instead of separate mouse and touch listeners, and run custom gestures (swipe,
long-press) only for touch. Mouse and pen keep native behaviour (text selection, hover menus, drag), so the app doesn't
feel like a phone app on a Mac. Treating `pointercancel` as an abort removes the "half-swiped row stuck on screen" tell.

```ts
declare const el: HTMLElement, handle: HTMLElement, btn: HTMLButtonElement;
declare function start(id: number, x: number, y: number, t: number): void;
declare function move(e: PointerEvent): void;
declare function finish(e: PointerEvent): void;
declare function abort(e: PointerEvent): void;

el.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || !e.isPrimary) return; // mouse/pen: selection, hover, native DnD
  start(e.pointerId, e.clientX, e.clientY, e.timeStamp);
});
el.addEventListener('pointermove', move);
el.addEventListener('pointerup', finish);
el.addEventListener('pointercancel', abort); // browser/OS took the gesture (scroll, zoom, back swipe): reset, never commit

// Mouse drags only: keep receiving moves outside the element (touch is captured implicitly)
handle.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') handle.setPointerCapture(e.pointerId);
});

// click is a PointerEvent now, so a tap handler knows its input ('' = keyboard)
btn.addEventListener('click', (e) => {
  const touch = e instanceof PointerEvent && e.pointerType === 'touch';
  console.debug({ touch });
});
```

**Support:** Pointer Events: Chromium 55, Chrome Android 55, Firefox 59 (Android 79), Safari macOS 13, Safari iOS 13
(tab and home-screen app alike). `click`/`contextmenu` as `PointerEvent`: Chrome 92, Firefox 129, Safari 18.2.

**Gotchas:**
- Touch pointers are implicitly captured to the `pointerdown` target (spec).
- `pointercancel` fires as soon as the browser takes the touch for panning (as `touch-action` allows) or the OS takes
  it for a system gesture; your `pointerup` never comes.
- Track by `pointerId` and ignore `!isPrimary`, or a second finger corrupts the gesture.
- Apple Pencil reports `'pen'`; an iPad trackpad reports `'mouse'`.
- Don't register `touchstart` and pointer handlers for the same gesture on one element.
- Safari 27 fixed `preventDefault()` in `pointerdown` not suppressing the compatibility `mousedown`/`mouseup` on iOS;
  older iOS still sends them.
- Keep gesture math in pure functions and unit-test it with fixed coordinates and timestamps; the DOM adapter stays thin.
- Playwright's touchscreen API only taps: dispatch synthetic pointer events with `pointerType: 'touch'`, or use CDP
  `Input.dispatchTouchEvent`, to E2E-test swipes.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events · https://w3c.github.io/pointerevents/ ·
https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

## touch-action declares what the browser keeps

`touch-action` tells the browser, before any JS runs, which touch gestures it handles natively. What is left (for
example horizontal drags on a `pan-y` row) reaches your pointer handlers without being cancelled. Vertical scrolling
stays native and jank-free, with no `preventDefault`-on-`touchmove` hacks.

```css
html { touch-action: manipulation; }            /* pan + pinch, no double-tap zoom, no tap delay */
.swipe-row { touch-action: pan-y pinch-zoom; }  /* browser keeps vertical scroll AND pinch; horizontal drags are yours */
.h-pager { touch-action: pan-x pinch-zoom; }
.drag-handle, .sketch-canvas, .zoom-viewer { touch-action: none; } /* everything is yours: keep these areas small */
```

**Support:** `auto`/`none`/`manipulation`/`pan-x`/`pan-y`: Chromium 36, Chrome Android 36, Firefox 52, Safari iOS 9.3
(tab and home-screen app), Safari macOS 13. `pinch-zoom`: Chrome 56, Firefox 85, Safari 13 / iOS 13. `pan-left/right/up/down`:
Chromium 55+ only.

**Gotchas:**
- Read once at `pointerdown`; it can't change mid-gesture, so you can't switch to `none` after a long-press picks
  something up.
- The effective value is the intersection of the element and its ancestors up to the nearest scroll container. Plain
  `pan-y` also blocks pinch-zoom when a pinch starts on that element; use `pan-y pinch-zoom`. A pinch then sends your
  swipe a `pointercancel`, which is fine.
- It doesn't affect mouse input.
- `none` on large areas kills scrolling for users who start a scroll there.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action ·
https://w3c.github.io/pointerevents/#the-touch-action-css-property

## Passive listeners by default

Browsers treat `touchstart`, `touchmove`, `wheel` and `mousewheel` listeners on `window`, `document` and `body` as
passive by default, so `preventDefault()` is ignored there. A non-passive `touchmove` makes every scroll wait for the
main thread (laggy scroll start is the biggest web tell), and a `preventDefault` that silently does nothing breaks
custom gestures. Register non-passive listeners explicitly and narrowly.

```ts
declare const scroller: HTMLElement, viewer: HTMLElement;
declare let pulling: boolean;
declare function onScroll(): void;

// Narrow, explicit, and only cancel when you own the gesture
scroller.addEventListener('touchmove', (e) => {
  if (pulling && e.cancelable) e.preventDefault();
}, { passive: false });
viewer.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault(); // trackpad pinch
}, { passive: false });
window.addEventListener('scroll', onScroll, { passive: true });
```

**Support:** Passive by default on window/document/body: Chrome 55 (Android too), Firefox 61, Safari 11.1 / iOS 11.3.

**Gotchas:**
- Once native scrolling has started, `touchmove.cancelable` is false: always check it.
- Prefer CSS `touch-action` whenever the decision is static.
- Chrome logs "Unable to preventDefault inside passive event listener" when you get this wrong.

> **With React:** React 17+ registers `touchstart`, `touchmove` and `wheel` as passive at the root, so
> `preventDefault()` in `onTouchMove`/`onWheel` does nothing (facebook/react#19651). Attach natively in an effect:
> `el.addEventListener('touchmove', onMove, { passive: false })` and remove it in the cleanup.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#using_passive_listeners ·
https://github.com/facebook/react/issues/19651

## Axis locking with a slop threshold

Don't interpret a gesture until the finger has moved about 8-10px, then lock to the dominant axis for the rest of it.
Only an `x` lock moves rows or drawers, and a long-press is possible only while the axis is undecided. Native lists
never wobble sideways while you scroll; rendering offsets before the lock makes rows jitter.

```ts
export type Axis = 'x' | 'y' | null;
const SLOP = 10; // px (Android's touch slop is ~8dp)

export function lockAxis(dx: number, dy: number, axis: Axis): Axis {
  if (axis) return axis; // decided once per gesture
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; // bias toward 'y' (dx > dy * 1.2) if rows still twitch
}
export const dragX = (dx: number, axis: Axis): number => (axis === 'x' ? dx : 0);
export const stillHeld = (axis: Axis): boolean => axis === null; // long-press candidate
```

**Support:** Pure logic; works wherever Pointer Events do.

**Gotchas:**
- With `touch-action: pan-y`, a `y` decision usually also brings a `pointercancel` from the browser: handle both.
- Unit-test the pure functions with fixed coordinates; no screen needed.

**Sources:** https://developer.android.com/reference/android/view/ViewConfiguration

## Swipe completion by distance or flick

A swipe commits if it travelled the full distance (~64px), or a shorter one (~32px) at flick speed (≥0.5 px/ms) in the
same direction. Measure velocity over the last ~80ms, not the whole gesture, so "hesitate, then flick" still counts. For
snapping drawers and sheets, project where momentum would carry the content and snap to the nearest stop.

```ts
interface Sample { readonly x: number; readonly t: number }
const WINDOW_MS = 80;

export function velocity(s: readonly Sample[]): number { // px/ms
  const last = s.at(-1);
  if (!last) return 0;
  const first = s.find((p) => last.t - p.t <= WINDOW_MS) ?? last;
  return last.t === first.t ? 0 : (last.x - first.x) / (last.t - first.t);
}

const SWIPE_PX = 64, SHORT_PX = 32, FLICK = 0.5;
export const completes = (d: number, v: number): boolean =>
  Math.abs(d) >= SWIPE_PX || (Math.abs(d) >= SHORT_PX && Math.abs(v) >= FLICK && Math.sign(v) === Math.sign(d));

// WWDC18 "Designing Fluid Interfaces": distance momentum adds (decelerationRate 0.998 normal, 0.99 fast)
export const project = (v: number, rate = 0.998): number => (v * rate) / (1 - rate);
export const snap = (pos: number, v: number, stops: readonly [number, ...number[]]): number => {
  const target = pos + project(v);
  return stops.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
};
```

**Support:** Pure logic. Use `PointerEvent.timeStamp` (high-resolution ms) everywhere.

**Gotchas:**
- Total distance over total time works for clean flicks but under-reads a late flick: keep a small ring buffer of
  samples per pointer.
- Reject flicks whose final velocity reverses the drag: the user is pulling back to cancel.
- Start the snap animation at the release velocity ([release animations](#release-animations-that-continue-the-velocity)).

**Sources:** https://developer.apple.com/videos/play/wwdc2018/803/

## Swipe-to-act rows

On touch, the row follows a horizontal drag 1:1 up to the commit threshold, then resists. It signals arming (haptic
where possible, plus a visual cue), springs back on release, and runs the action only if still armed. An icon behind
the row fades in with progress. This is the iMessage/WhatsApp/Mail idiom: "let go now and it happens", without text.

```ts
const T = 64;
const rubber = (x: number, d: number, c = 0.55): number => (x * d * c) / (d + c * x);

export function swipeToReply(row: HTMLElement, onReply: () => void, tick: () => void): () => void {
  const ac = new AbortController();
  const opts = { signal: ac.signal };
  row.style.touchAction = 'pan-y pinch-zoom';
  let id = -1, x0 = 0, y0 = 0, off = 0, armed = false, raf = 0;
  let axis: 'x' | 'y' | null = null;
  const paint = () => { raf = 0; row.style.transform = off ? `translateX(${off}px)` : ''; };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY; axis = null; off = 0; armed = false;
    row.style.transition = 'none';
  }, opts);
  row.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    axis ??= Math.max(Math.abs(dx), Math.abs(dy)) < 10 ? null : Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (axis !== 'x') return;
    off = dx <= 0 ? 0 : dx <= T ? dx : T + rubber(dx - T, 200);
    if ((off >= T) !== armed) { armed = off >= T; if (armed) tick(); }
    schedule();
  }, opts);
  const end = (commit: boolean) => {
    if (id === -1) return;
    id = -1; off = 0;
    row.style.transition = 'transform 220ms cubic-bezier(.2,.9,.3,1)';
    schedule();
    if (commit && armed) onReply();
  };
  row.addEventListener('pointerup', () => end(true), opts);
  row.addEventListener('pointercancel', () => end(false), opts);
  return () => { ac.abort(); cancelAnimationFrame(raf); };
}
```

**Support:** Pointer Events plus `touch-action: pan-y pinch-zoom`: Chrome/Chrome Android 56, Firefox 85 (Android too),
Safari 13 / iOS 13.

**Gotchas:**
- A rubber band feels softer than a hard `min(offset, 96)` clamp.
- Disarming when the user drags back below the threshold is the "I changed my mind" path; native Mail allows it.
- Combine with the [flick rule](#swipe-completion-by-distance-or-flick) so a fast short swipe also commits.
- On iOS 26.5+ no haptic is possible mid-drag ([iPhone haptics](#haptics-on-iphone-with-the-switch-trick)), so the
  visual arming cue must work on its own.
- Mouse users need another path (hover action bar or menu).
- Don't fight an edge-swipe drawer: give the drawer only touches that start in the edge zone.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events ·
https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action

## Rubber-band resistance

When a drag passes its limit (threshold, list end, sheet top, zoom bounds), move the content by a diminishing amount,
then animate back on release. A hard stop feels like a bug; asymptotic resistance reads as physical and matches iOS
scroll views.

```ts
/** x = overshoot past the limit (px, >= 0), d = dimension of the view (px), c = 0.55 like UIScrollView */
export const rubber = (x: number, d: number, c = 0.55): number => (x * d * c) / (d + c * x);
export const clampRubber = (v: number, min: number, max: number, d: number): number =>
  v < min ? min - rubber(min - v, d) : v > max ? max + rubber(v - max, d) : v;
```

**Support:** Pure math; works everywhere.

**Gotchas:**
- The 0.55 constant and the formula (equivalent to `(1 - 1/(x*c/d + 1)) * d`) are community-derived from
  UIScrollView's behaviour, not documented by Apple.
- Smaller `d` means stiffer resistance.
- Always animate back on release, and skip the animation under `prefers-reduced-motion`.

**Sources:** https://developer.apple.com/videos/play/wwdc2018/803/ ·
https://medium.com/@nathangitter/building-fluid-interfaces-ios-swift-9732bb934bf5

## Native momentum with CSS scroll-snap

Use a horizontal scroll container with scroll-snap for paged views (onboarding, galleries, tab pages) and for Mail-style
rows that reveal actions behind them. The browser supplies real fling physics, snapping, rubber-banding and 120Hz
compositor scrolling with zero JS; hand-rolled JS carousels never match the OS friction. `scrollend` tells you where it
settled.

```html
<div class="pager"><section>1</section><section>2</section><section>3</section></div>
<div class="row">
  <div class="row-main">Message</div>
  <div class="row-actions"><button type="button">Archive</button><button type="button">Delete</button></div>
</div>
```

```css
.pager, .row { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; scrollbar-width: none; }
.pager > * { flex: 0 0 100%; scroll-snap-align: center; scroll-snap-stop: always; }
.row-main { flex: 0 0 100%; scroll-snap-align: start; }
.row-actions { display: flex; scroll-snap-align: end; }
```

```ts
declare const pager: HTMLElement;
declare function setPage(n: number): void;

const settled = () => setPage(Math.round(Math.abs(pager.scrollLeft) / pager.clientWidth)); // abs: RTL is <= 0
if ('onscrollend' in window) pager.addEventListener('scrollend', settled);
else {
  let t = 0;
  pager.addEventListener('scroll', () => { clearTimeout(t); t = window.setTimeout(settled, 120); }, { passive: true });
}
```

**Support:** `scroll-snap-type`: Chrome 69, Firefox 68, Safari 11. `scroll-snap-stop`: Chrome 75, Firefox 103, Safari 15.
`scrollend`: Chrome 114, Firefox 109, Safari 26.2 (macOS and iOS). `scrollbar-width`: Chrome 121, Firefox 64, Safari 18.2.
`scrollsnapchange`/`scrollsnapchanging`: Chromium 129 only.

**Gotchas:**
- `-webkit-overflow-scrolling: touch` is obsolete since iOS 13 (all overflow scrolling has momentum): delete it.
- Safari 27 fixed `scrollTo()` interrupting an in-progress momentum scroll on iOS.
- Snap rows inside a vertical list work well, but nest axes carefully: the row pans x, the list pans y.
- Don't animate `scrollLeft` from JS every frame; use `scrollTo({ left, behavior: 'smooth' })` and honour reduced motion.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-snap-type ·
https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollend_event ·
https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

## Edge swipes versus system back gestures

A left-edge swipe that opens a navigation drawer competes with the OS: Safari tabs use edge swipes for history,
Android gesture navigation uses both edges for system Back (predictive back), and desktop trackpads use a two-finger
horizontal swipe for history. Design so the system wins gracefully and your gesture still has room.

```ts
declare const main: HTMLElement;
declare function beginDrawerDrag(e: PointerEvent): void;

const EDGE = 28; // px: drawer gestures may start only this close to the left edge
main.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || e.clientX > EDGE) return;
  beginDrawerDrag(e); // pointercancel => the OS/browser took it (back gesture): do nothing
});
const inBrowserTab = matchMedia('(display-mode: browser)').matches; // tab: widen the zone past Safari's strip

// Last resort for games/canvases only (Safari): block the nav gesture where the touch starts at an edge
document.addEventListener('touchstart', (e) => {
  const x = e.touches[0]?.pageX ?? 0;
  if (x < 20 || x > innerWidth - 20) e.preventDefault();
}, { passive: false });
```

```css
.carousel, .swipe-row { overscroll-behavior-x: contain; } /* don't chain into history swipes at the scroller's end */
```

**Support:** Safari iOS tabs: edge back/forward swipe. iOS home-screen apps: edge back swipe since iOS 12.2, reportedly
active only when there is history (unverified on current iOS). iOS 26 added swipe-anywhere back for native apps; Safari
reportedly still uses edge-only (unverified). Android 10+ gesture navigation: the edges belong to system Back and pages
can't intercept it. `display-mode`: Chrome 42, Firefox 47, Safari 13 / iOS 12.2.

**Gotchas:**
- You can't detect or cancel the OS gesture; you only get `pointercancel`, so never commit on cancel.
- In a Safari tab the first few px belong to the back swipe, so your zone must be wider than that strip; in a
  standalone app with no history the whole zone works.
- Better: also open the drawer with a horizontal swipe anywhere on content without horizontal scrollers, and always
  with a visible button.
- `preventDefault` on `touchstart` also kills taps and scrolls that start there, works only in Safari (inconsistent in
  other iOS browsers), and doesn't belong in normal apps.
- `overscroll-behavior-x` is not a reliable block for browser swipe navigation (reports vary); use it to stop chaining.

**Sources:** https://pqina.nl/blog/blocking-navigation-gestures-on-ios-13-4/ ·
https://medium.com/@firt/whats-new-on-ios-12-2-for-progressive-web-apps-75c348f8e945 ·
https://github.com/ionic-team/ionic-framework/issues/22299

## Swipe to close panels and system Back

Every overlay (drawer, sheet, full-screen panel, lightbox) closes with Android Back and Escape, and on narrow screens a
pushed full-screen panel closes with a right swipe like iOS navigation. Back handling (CloseWatcher, history entries,
`<dialog closedby>`, the Navigation API) is owned by navigation-ui-patterns.md: see
navigation-ui-patterns.md (back button section). The gesture-specific parts are below.

```ts
declare function closePanel(opts: { animate: boolean }): void;

// Safari's edge swipe already animated the transition: skip your own exit animation
addEventListener('popstate', (e) => closePanel({ animate: !e.hasUAVisualTransition }));
```

**Support:** `PopStateEvent.hasUAVisualTransition`: Chrome 118, Firefox 149, Safari 18 / iOS 18.
`NavigateEvent.hasUAVisualTransition`: Chrome 118, Firefox 147, Safari 26.2. `CloseWatcher`: Chrome 126, Firefox 149,
Safari Technology Preview only (not iOS).

**Gotchas:**
- A right-swipe close must start away from the left edge in a Safari tab, or it races Safari's own back swipe.
- Reuse the [swipe-to-act](#swipe-to-act-rows) machinery (axis lock, flick rule, `pointercancel` abort).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/PopStateEvent/hasUAVisualTransition ·
https://developer.mozilla.org/en-US/docs/Web/API/CloseWatcher

## Swipe down to dismiss sheets

Bottom sheets follow a downward drag from the grabber, or from the content when it is scrolled to the top. They dismiss
past ~30% of their height or on a downward flick, and otherwise spring back, while content inside scrolls normally. A
sheet you can only close with an X feels like a web modal.

```ts
export function dragToDismiss(sheet: HTMLElement, body: HTMLElement, close: () => void): () => void {
  const ac = new AbortController();
  let y0 = 0, t0 = 0, dy = 0, decided = false, dragging = false;
  sheet.addEventListener('touchstart', (e) => {
    y0 = e.touches[0]?.clientY ?? 0; t0 = e.timeStamp; dy = 0; decided = false; dragging = false;
    sheet.style.transition = 'none';
  }, { passive: true, signal: ac.signal });
  sheet.addEventListener('touchmove', (e) => {
    const y = e.touches[0]?.clientY ?? y0;
    if (!decided) { decided = true; dragging = y > y0 && body.scrollTop <= 0; }
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();
    dy = Math.max(0, y - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: false, signal: ac.signal });
  sheet.addEventListener('touchend', (e) => {
    if (!dragging) return;
    const v = dy / Math.max(1, e.timeStamp - t0); // use a recent-sample window in production
    sheet.style.transition = 'transform 240ms cubic-bezier(.2,.9,.3,1)';
    if (dy > sheet.offsetHeight * 0.3 || v > 0.5) {
      sheet.style.transform = 'translateY(100%)';
      setTimeout(close, 240); // not transitionend: it never fires for 0ms (reduced motion)
    } else sheet.style.transform = '';
  }, { signal: ac.signal });
  return () => ac.abort();
}
```

```css
.sheet-body { overflow-y: auto; overscroll-behavior: contain; }
.sheet-grabber { touch-action: none; }
```

**Support:** Touch events: Chrome Android, Firefox Android, Safari iOS (not desktop Safari, not desktop Firefox by
default). `overscroll-behavior`: Chrome 63, Firefox 59, Safari 16 / iOS 16.

**Gotchas:**
- Pointer events don't work for drags that start on scrollable content: with `pan-y`, the browser takes a downward drag
  at `scrollTop` 0 (bounce) and sends `pointercancel`. Touch events keep coming, and the first move is still cancelable.
- Fade the backdrop with progress.
- Also close with Escape, Back and a backdrop tap; make the backdrop a real `<button>` so it is accessible.
- Desktop needs no drag.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Touch_events ·
https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior

## Overscroll behavior for gestures

Root bounce, scroll chaining into the page behind a modal, and Chrome's pull-to-refresh reloading the app are owned by
viewport-keyboard-safe-areas.md: see viewport-keyboard-safe-areas.md#overscroll-behavior-no-page-rubber-band-no-accidental-pull-to-refresh-no-scroll-chaining. What gestures need from it:
`html, body { overscroll-behavior: none }` before a [custom pull-to-refresh](#custom-pull-to-refresh), and
`overscroll-behavior: contain` on sheets, carousels and swipe rows so they don't chain.

**Support:** Chrome 63, Firefox 59, Safari 16 / iOS 16; Chrome 144 and Firefox 150 also apply it to containers without
scrollable overflow.

**Gotchas:**
- Chrome on Android keeps its pull-to-refresh even in installed standalone apps unless the root opts out.
- iOS home-screen apps have no pull-to-refresh and no reload button at all.

**Sources:** https://developer.chrome.com/blog/overscroll-behavior

## Custom pull-to-refresh

A spinner that follows a downward pull at the top of a list, with rubber-band resistance, arms past ~72px and refreshes
on release. Installed iOS apps have no reload affordance and users instinctively pull lists. Built with touch events so
native scrolling still works in every other case.

```ts
export function pullToRefresh(
  scroller: HTMLElement, spinner: HTMLElement, refresh: () => Promise<void>, tick: () => void,
): () => void {
  const ac = new AbortController();
  const T = 72;
  const rubber = (x: number, d: number) => (x * d * 0.55) / (d + 0.55 * x);
  let y0 = 0, pull = 0, tracking = false, armed = false, busy = false;
  const show = (y: number) => {
    spinner.style.transform = `translateY(${y}px) rotate(${y * 4}deg)`;
    spinner.style.opacity = String(Math.min(1, y / T));
  };
  scroller.addEventListener('touchstart', (e) => {
    tracking = !busy && e.touches.length === 1 && scroller.scrollTop <= 0;
    y0 = e.touches[0]?.clientY ?? 0; pull = 0; armed = false; spinner.style.transition = 'none';
  }, { passive: true, signal: ac.signal });
  scroller.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dy = (e.touches[0]?.clientY ?? y0) - y0;
    if (dy <= 0 && pull === 0) { tracking = false; return; } // scrolling up: native
    if (e.cancelable) e.preventDefault();
    pull = dy > 0 ? rubber(dy, innerHeight) : 0;
    if ((pull >= T) !== armed) { armed = pull >= T; if (armed) tick(); }
    show(pull);
  }, { passive: false, signal: ac.signal });
  scroller.addEventListener('touchend', () => {
    if (!tracking) return;
    tracking = false; spinner.style.transition = 'transform 200ms, opacity 200ms';
    if (!armed) { show(0); return; }
    busy = true; show(T);
    void refresh().finally(() => { busy = false; show(0); });
  }, { signal: ac.signal });
  return () => ac.abort();
}
```

**Support:** Touch events on Chrome Android, Firefox Android, Safari iOS. Root overscroll control: Chrome 63,
Firefox 59, Safari 16.

**Gotchas:**
- For realtime apps (chat), refreshing automatically on `visibilitychange` (visible) and `online` often beats
  pull-to-refresh: users shouldn't have to pull.
- Pointer events can't do this: the browser cancels them when it starts the overscroll.
- Lists anchored at the bottom (`column-reverse`) need the logic mirrored at the oldest end.
- Desktop needs a refresh button or shortcut instead.
- Keep the `touchmove` listener on the list only, never on `document`.
- The arming `tick()` can't produce a haptic on iOS 26.5+ (not a tap).

**Sources:** https://web.dev/learn/pwa/app-design · https://developer.chrome.com/blog/overscroll-behavior ·
https://developer.mozilla.org/en-US/docs/Web/API/Touch_events

## Long-press context menus

Holding still for ~450-500ms on a touch opens your action sheet (react, reply, copy…). On touch only, suppress the iOS
callout and link preview, the Android context menu and the selection loupe; moving past the slop or scrolling cancels
it. A browser "Copy / Open link / Share" callout over your app is a dead giveaway.

```ts
const LONG_MS = 450; // iOS UILongPressGestureRecognizer 500ms; Android default 400ms

export function longPress(el: HTMLElement, open: (x: number, y: number) => void): () => void {
  const ac = new AbortController();
  const opts = { signal: ac.signal };
  let timer = 0, fired = false, x0 = 0, y0 = 0;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    cancel(); fired = false; x0 = e.clientX; y0 = e.clientY;
    timer = window.setTimeout(() => { fired = true; open(x0, y0); }, LONG_MS);
  }, opts);
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); }, opts);
  el.addEventListener('pointerup', cancel, opts);
  el.addEventListener('pointercancel', cancel, opts); // scroll started
  el.addEventListener('contextmenu', (e) => { if (fired) e.preventDefault(); }, opts); // Android follows with its menu
  el.addEventListener('click', (e) => {
    if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
  }, { capture: true, signal: ac.signal });
  return () => { cancel(); ac.abort(); };
}
```

```css
@media (pointer: coarse) {
  .pressable { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
}
```

**Support:** `contextmenu`: Chromium, Chrome Android, Firefox (desktop and Android), Safari macOS; never fired for touch
on Safari iOS, so the timer is required there. `-webkit-touch-callout`: Safari iOS only.

**Gotchas:**
- Apply `user-select: none` and `-webkit-touch-callout: none` only for coarse pointers, so desktop users can still
  select text. Because touch users lose native selection, add "Copy text" and/or "Select text" to the menu.
- Android's long-press timeout is user-adjustable (Accessibility → Touch & hold delay); consider opening on Android's
  `contextmenu` event to respect it, keeping the timer for iOS.
- A haptic from the timer: on Android `navigator.vibrate` needs prior sticky activation, so the first long-press of a
  session may be silent; iOS can't tick from a timer at all.
- Make the menu reachable without long-press too (right-click, keyboard, a visible "…" button).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event ·
https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-touch-callout ·
https://developer.android.com/reference/android/view/ViewConfiguration

## Desktop context menus and hover actions

On desktop, the long-press actions appear in a hover toolbar (mouse), on `:focus-within` (keyboard) and in a custom
right-click menu. The native context menu stays for links, selected text and text fields: hijacking every right-click
(even over a selection or a spellcheck squiggle) is hostile.

```ts
declare const row: HTMLElement;
declare function openMenu(x: number, y: number): void;

row.addEventListener('contextmenu', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (getSelection()?.toString() || t?.closest('a[href], input, textarea, [contenteditable]')) return; // keep native
  e.preventDefault();
  const r = row.getBoundingClientRect();
  const fromKeyboard = e.clientX === 0 && e.clientY === 0; // Shift+F10 / Menu key (heuristic)
  openMenu(fromKeyboard ? r.left + 16 : e.clientX, fromKeyboard ? r.top + 16 : e.clientY);
});
```

```css
.row .actions { opacity: 0; }
@media (hover: hover) and (pointer: fine) { .row:hover .actions { opacity: 1; } }
.row:focus-within .actions { opacity: 1; }
```

**Support:** `contextmenu`: all desktop browsers. Shift+F10 and the Menu key fire it on Windows/Linux; macOS has no
standard key, so offer a visible menu button.

**Gotchas:**
- Keyboard-triggered coordinates vary by browser; position from the element rect when in doubt.
- Menus need arrow-key navigation, Escape to close, and focus return.
- Two-finger trackpad click behaves like right-click.
- Don't show hover-only controls on touch, where they are unreachable or sticky.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event ·
https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover

## Drag and drop on touch

Reorder lists and kanban cards with pointer events and `setPointerCapture` on a `touch-action: none` handle. A lift
effect (and haptic where possible) marks pickup, and the list scrolls itself near its edges. HTML5 DnD on touch is
inconsistent, so keep it for desktop file drops and cross-app drags.

```ts
declare const handle: HTMLElement, item: HTMLElement, list: HTMLElement;
declare function tick(): void;
declare function previewDrop(y: number): void;
declare function commitDrop(y: number): void;

handle.style.touchAction = 'none';
handle.addEventListener('pointerdown', (e) => {
  handle.setPointerCapture(e.pointerId);
  const ac = new AbortController();
  const startY = e.clientY;
  let raf = 0, y = startY;
  item.classList.add('lifted'); tick();
  const loop = () => {
    const r = list.getBoundingClientRect();
    if (y < r.top + 48) list.scrollBy(0, -8); else if (y > r.bottom - 48) list.scrollBy(0, 8);
    item.style.transform = `translateY(${y - startY}px)`;
    previewDrop(y);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const up = () => {
    ac.abort(); cancelAnimationFrame(raf); // removes move, up and cancel listeners together
    item.classList.remove('lifted'); item.style.transform = ''; commitDrop(y);
  };
  handle.addEventListener('pointermove', (ev) => { y = ev.clientY; }, { signal: ac.signal });
  handle.addEventListener('pointerup', up, { signal: ac.signal });
  handle.addEventListener('pointercancel', up, { signal: ac.signal });
});
```

```css
.drag-handle { cursor: grab; }
.lifted { cursor: grabbing; box-shadow: var(--shadow-lifted); scale: 1.02; }
```

**Support:** Pointer capture: Chrome 55, Firefox 59, Safari 13 / iOS 13. HTML DnD on touch: iOS/iPadOS 15+ and Chrome
Android ~96+ per community reports (BCD's mobile rows are coarse); don't rely on it for in-app reordering.

**Gotchas:**
- `touch-action` is fixed at `pointerdown`, so dragging a whole row after a long-press needs touch events: start a
  timer on a passive `touchstart`, and once it fires call `preventDefault()` on the next cancelable `touchmove` (from a
  `passive: false` listener) to stop the scroll.
- Provide a non-drag path (move up/down buttons or arrow keys plus an `aria-live` announcement).
- Suppress the click that follows a mouse drag.
- Mark images inside items `draggable="false"` so the browser's image drag doesn't start instead.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture ·
https://caniuse.com/dragndrop · https://github.com/timruffles/mobile-drag-drop

## Pinch-zoom and pan in image viewers

A lightbox zooms around the pinch midpoint with two pointers, pans with one finger when zoomed, and rubber-bands past
its limits. It also handles desktop trackpad pinch: Chromium and Firefox send `wheel` with `ctrlKey`, Safari macOS sends
non-standard gesture events. Otherwise pinching a web image zooms the whole page and its UI.

```ts
declare const viewer: HTMLElement;
declare function pan(dx: number, dy: number): void;
declare function apply(scale: number): void;

const pts = new Map<number, { x: number; y: number }>();
let scale = 1, start = 1, d0 = 0;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const dist = () => {
  const [a, b] = [...pts.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
};
viewer.style.touchAction = 'none';
viewer.addEventListener('pointerdown', (e) => {
  viewer.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2) { d0 = dist(); start = scale; }
});
viewer.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 2 && d0 > 0) scale = clamp(start * (dist() / d0), 1, 6);
  else if (scale > 1) pan(dx, dy);
  apply(scale);
});
const lift = (e: PointerEvent) => { pts.delete(e.pointerId); d0 = 0; };
viewer.addEventListener('pointerup', lift);
viewer.addEventListener('pointercancel', lift);

// Trackpad pinch on Chromium/Firefox
viewer.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  scale = clamp(scale * Math.exp(-e.deltaY / 100), 1, 6);
  apply(scale);
}, { passive: false });

// Safari (macOS trackpad, iOS): non-standard GestureEvent, not in TypeScript's DOM lib
interface SafariGestureEvent extends UIEvent { readonly scale: number }
const isGesture = (e: Event): e is SafariGestureEvent => 'scale' in e && typeof e.scale === 'number';
viewer.addEventListener('gesturestart', (e) => { e.preventDefault(); start = scale; });
viewer.addEventListener('gesturechange', (e) => {
  if (!isGesture(e)) return;
  e.preventDefault();
  scale = clamp(start * e.scale, 1, 6);
  apply(scale);
});
```

**Support:** Multi-pointer Pointer Events: Chrome 55, Firefox 59, Safari 13 / iOS 13. `wheel` + `ctrlKey` for pinch:
Chromium and Firefox (de facto). `GestureEvent`: Safari macOS and iOS only (non-standard).

**Gotchas:**
- Zoom around the focal point: adjust the translation by `(midpoint - origin) * (1 - newScale / oldScale)`, or the
  image drifts.
- Swap to a higher-resolution source when zoomed.
- Double-tap toggles 1x/2.5x at the tap point; implement it yourself ([double-tap](#custom-double-tap-gestures)).
- At scale 1, a vertical drag dismisses and a horizontal one goes to the next image.
- `touch-action: none` goes on the viewer only; never disable page zoom globally to make this work.

**Sources:** https://danburzo.ro/dom-gestures/ · https://developer.mozilla.org/en-US/docs/Web/API/GestureEvent

## No tap delay and no double-tap zoom

A `width=device-width` viewport and `touch-action: manipulation` on the root make taps fire immediately and stop
fast-tapped buttons from zooming, while users keep pinch-zoom for accessibility. The 16px field rule that stops iOS
zooming into focused inputs is owned by viewport-keyboard-safe-areas.md: see
viewport-keyboard-safe-areas.md#stop-ios-focus-zoom-16px-form-fields-on-coarse-pointers-only.

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

```css
html { touch-action: manipulation; -webkit-text-size-adjust: 100%; }
```

**Support:** `width=device-width` removed the tap delay in Chrome 32 and iOS 9.3. `touch-action: manipulation`:
Chrome 36, Firefox 52, Safari iOS 9.3, Safari macOS 13.

**Gotchas:**
- Never use `maximum-scale=1` or `user-scalable=no`: it fails axe/WCAG 1.4.4, and iOS has ignored `user-scalable=no`
  since iOS 10 anyway.
- FastClick and similar libraries are obsolete and harmful.
- Elements with `pan-y` or `none` also don't double-tap zoom.

**Sources:** https://webkit.org/blog/5610/more-responsive-tapping-on-ios/ ·
https://developer.chrome.com/blog/300ms-tap-delay-gone-away

## Tap highlight and pressed states

Turn off the WebKit/Blink tap highlight and give every tappable element its own immediate pressed state (scale, tint
or opacity). The translucent grey box on tap is unmistakably web, and buttons with no press feedback feel dead. Native
controls react on touch-down.

```css
html { -webkit-tap-highlight-color: transparent; }
.btn { transition: transform 120ms ease-out, background-color 120ms; }
.btn:active { transform: scale(.97); background: var(--btn-press); transition-duration: 0s; }
/* lists: delay the pressed tint a little so it doesn't flash when the touch becomes a scroll */
.row:active { background: var(--row-press); transition: background-color 0s 60ms; }
```

```ts
// iOS Safari applies :active only when a touchstart listener exists on the element or an ancestor
document.body.addEventListener('touchstart', () => {}, { passive: true });
```

**Support:** `-webkit-tap-highlight-color`: Chromium, Chrome Android, Safari iOS (Firefox has no tap highlight).
`:active` everywhere, but Safari iOS needs a `touchstart` handler.

**Gotchas:**
- Removing the highlight without adding `:active` leaves no feedback at all.
- Frameworks may already register `touchstart` at their root (React does); verify on a device.
- The 60ms delay is a tuning heuristic, not a platform constant.
- Keep pressed styles off disabled controls; respect reduced motion for the scale (a colour change is fine).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/:active ·
https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-tap-highlight-color

## No sticky hover on touch

Apply hover styles and hover-revealed UI only when the primary input can hover. On phones `:hover` sticks after a tap,
and on iOS a `:hover` that reveals content turns the first tap into a "hover" that needs a second tap to click.

```css
@media (hover: hover) and (pointer: fine) {
  .item:hover { background: var(--hover); }
  .card:hover .quick-actions { opacity: 1; }
}
/* is any mouse/trackpad connected at all? (hybrids, iPad + trackpad) */
@media (any-hover: hover) { .tooltip-hint { display: inline; } }
```

**Support:** `hover`: Chrome 38 (Android 50), Firefox 64, Safari 9 / iOS 9. `any-hover`/`any-pointer`: Chrome 41, Firefox 64, Safari 9.

**Gotchas:**
- Some Android devices wrongly match `(hover: hover)` (BCD note), which is why `pointer: fine` is added.
- For behaviour rather than style, decide per event with `pointerType`: hybrids switch inputs mid-session.
- In JS, use `matchMedia('(hover: hover)')` with a `change` listener.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover ·
https://css-tricks.com/annoying-mobile-double-tap-link-issue/

## Hit targets sized by pointer type

Interactive elements get at least 44×44 CSS px on coarse pointers and may stay denser for a mouse. A pseudo-element
enlarges small icons' hit area without changing layout. Mis-taps on tiny icons are a constant web-app frustration.

```css
:root { --hit: 32px; }
@media (pointer: coarse) { :root { --hit: 44px; } }
.icon-btn { position: relative; min-width: var(--hit); min-height: var(--hit); }
.icon-btn.compact::after { content: ''; position: absolute; inset: -8px; } /* larger hit area, same layout */
.toolbar { gap: 8px; } /* spacing also counts against mis-taps */
```

**Support:** `pointer` media query: Chrome 41, Firefox 64, Safari 9.

**Gotchas:**
- References: Apple HIG 44×44pt, Material 48×48dp, WCAG 2.2 2.5.8 (AA) 24×24 CSS px minimum, 2.5.5 (AAA) 44×44.
- Overlapping expanded areas steal each other's taps: keep ~8px spacing.
- iPadOS Safari reports a desktop UA; use `navigator.maxTouchPoints > 1` if you must tell an iPad from a Mac.
- Hybrid laptops may report `pointer: fine` while being touched, so size primary actions generously regardless.

**Sources:** https://developer.apple.com/design/human-interface-guidelines/accessibility ·
https://m3.material.io/foundations/designing/structure ·
https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

## Haptics on Android

Short vibrations for meaningful moments (a send, a gesture arming, a long-press opening) make touch feel physical.
Fire them only if the device can, the user hasn't turned haptics off in your settings, reduced motion isn't requested,
the page has had user activation, and it is visible.

```ts
const PATTERNS = { tap: [10], tick: [15], notice: [12, 60, 12] } as const;
export type Haptic = keyof typeof PATTERNS;

export function haptic(kind: Haptic, enabledInSettings: boolean): boolean {
  if (!enabledInSettings || typeof navigator.vibrate !== 'function') return false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false; // Chrome would block + log
  if (document.visibilityState !== 'visible') return false;
  return navigator.vibrate([...PATTERNS[kind]]);
}
```

**Support:** Chrome Android 32+ (needs sticky user activation since Chrome 60; blocked in cross-origin iframes),
Samsung Internet, Edge Android. Firefox Android: API present but disabled since 79 (returns `true`, no vibration).
Firefox desktop: removed in 129. Safari macOS and iOS: never. `navigator.userActivation`: Chrome 72, Firefox 120,
Safari 16.4.

**Gotchas:**
- A `true` return doesn't mean the user felt anything (Firefox Android, desktop Chrome without a motor), and you can't
  detect that.
- Some phones reportedly clip pulses under ~10ms; battery saver or silent mode may suppress vibration. Test on cheap
  devices.
- Keep pulses short (10-20ms) so they feel like taps, and never fire them for a stream of incoming events.
- There's no `prefers-reduced-haptics`; reduced motion is a proxy, but also offer an explicit toggle.
- A "Web Haptics API" (`navigator.playHaptics()` plus CSS haptic declarations) is only an explainer/WICG proposal with a
  Chromium intent to prototype. It hasn't shipped: don't build on it.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate ·
https://bugzilla.mozilla.org/show_bug.cgi?id=1900037 ·
https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/Haptics/explainer.md

## Haptics on iPhone with the switch trick

Safari on iPhone plays a Taptic Engine tick when a native `<input type="checkbox" switch>` toggles. A transparent
`<label>` over a button, wired to a hidden switch, turns the user's real tap into a switch toggle (a tick) while your
click handler runs the action. It is the only way to get haptics in Safari on iPhone, which has no Vibration API.

```html
<span class="haptic-host">
  <button type="button" id="send">Send</button>
  <input type="checkbox" switch id="hx-send" class="haptic-switch" aria-hidden="true" tabindex="-1">
  <label for="hx-send" class="haptic-label" aria-hidden="true"></label>
</span>
```

```css
.haptic-host { position: relative; display: inline-block; }
.haptic-switch { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.haptic-label { position: absolute; inset: 0; }
```

```ts
declare const label: HTMLLabelElement;
declare function send(): void;

// Only where there is no Vibration API on a touch device (iPhone)
const iosHaptics = typeof navigator.vibrate !== 'function' && matchMedia('(pointer: coarse)').matches;
if (iosHaptics) label.addEventListener('click', () => send()); // the real tap toggled the switch (tick); act here
```

**Support:** The `switch` attribute: Safari 17.4+ (macOS and iOS; WebKit only, non-standard). Haptic on toggle: iOS 18+
(none on 17.4). iOS 18.0-26.4: any toggle ticks, including `label.click()` from script shortly after a gesture.
iOS 26.5+: only a real finger tap on the switch or its label ticks; a programmatic `label.click()` reaches the switch as
an untrusted click and is silent (WebKit bug 309082, per library authors; not in Apple release notes). Same in tab and
home-screen app. No effect on Android, desktop, iPad (no Taptic Engine) or Firefox.

**Gotchas:**
- A hack on non-standard behaviour that already broke once (26.5): wrap it behind your `haptic()` abstraction and be
  ready to drop it.
- Drags never produce a click, so ticks at swipe thresholds, from long-press timers or after an `await` are impossible
  on 26.5+; only a haptic inside a real tap works.
- The overlay covers the element's children: attach it to leaf controls, never containers.
- Keep scrolls that start on the element working (libraries had to fix this).
- Hide switch and label from assistive tech (`aria-hidden`, `tabindex="-1"`). Keyboard activation hits the real
  button, with no haptic, which is fine.
- Whether it honours the iOS System Haptics setting is unverified.
- Libraries: ios-haptics, tappt. Test on real devices on every iOS release.

**Sources:** https://webkit.org/blog/15054/an-html-switch-control/ · https://github.com/tijnjh/ios-haptics ·
https://github.com/mxerf/tappt/pull/5

## User activation rules on touch

Audio playback, vibrate, keyboard-opening focus, fullscreen, popups and clipboard writes need user activation. Per the
HTML Standard, a touch `pointerdown` is not activation-triggering; `pointerup`, `touchend`, `click` and `keydown` are.
Doing the work on the wrong event makes the first tap appear to do nothing (no sound, no keyboard).

```ts
declare function unlockAudio(): void;

// Activation-triggering (HTML): keydown (not Escape or reserved keys), mousedown, pointerdown only if
// pointerType is 'mouse', pointerup if pointerType is not 'mouse', touchend.
for (const type of ['pointerup', 'touchend', 'click', 'keydown'] as const)
  addEventListener(type, unlockAudio, { capture: true, passive: true });

if (navigator.userActivation?.isActive) { /* transient: may open popups / play audio now */ }
if (navigator.userActivation?.hasBeenActive) { /* sticky: vibrate, autoplay in Chrome */ }
```

**Support:** `navigator.userActivation`: Chrome 72, Firefox 120, Safari 16.4. The activation-triggering event list is in
the HTML Standard (User Activation v2) and applies in all current engines.

**Gotchas:**
- Unlocking on `pointerdown` only works for mouse; on phones add `pointerup`/`click`.
- Transient activation expires (a few seconds in Chromium, reportedly ~1s in WebKit), and an `await` before the gated
  call can lose it in Safari: call `play()`, `focus()` and `vibrate()` synchronously in the handler, then do async work.
- Some APIs consume activation (popups); others need only sticky activation (vibrate, Chrome autoplay).

**Sources:** https://html.spec.whatwg.org/multipage/interaction.html#activation-triggering-input-event ·
https://webkit.org/blog/13862/the-user-activation-api/ · https://developer.mozilla.org/en-US/docs/Web/API/UserActivation

## Unlock audio on the first tap

On the first activation, resume a shared `AudioContext` and "bless" any `<audio>` element you'll play later without a
gesture (play it once inside the gesture, then pause it), and keep reusing those same objects. Without this, the first
incoming-call ringtone or message sound is silent.

```ts
let ctx: AudioContext | undefined;
const ringtone = Object.assign(new Audio('/ringtone.m4a'), { loop: true, preload: 'auto' });
let unlocked = false;

export function unlockAudio(): void {
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state !== 'running') void ctx.resume();
  if (unlocked) return;
  ringtone.muted = true;
  ringtone.play().then(() => {
    ringtone.pause(); ringtone.currentTime = 0; ringtone.muted = false; unlocked = true;
  }, () => {});
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ctx && ctx.state !== 'running') void ctx.resume();
});
```

**Support:** `AudioContext.resume()`: Chrome 41, Firefox 40, Safari 9. Autoplay: Chrome allows sound after sticky
activation (plus engagement); Safari requires the specific element or context to have been started in a gesture.

**Gotchas:**
- Muted `play()` is often allowed without activation, so a resolved muted play doesn't prove the element is unlocked
  for sound.
- Run the unlock from a real activation event (`pointerup`/`click`/`keydown`), not touch `pointerdown`.
- iOS can reportedly leave a context `running` yet silent if it was resumed outside a valid gesture, and it suspends or
  interrupts it in the background: re-resume on visibility.
- A call arriving before any tap can't make sound: show it visually and use a system notification.
- iOS requires playing the same element you unlocked, so keep one instance.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay ·
https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos

## Subtle UI sounds

Pre-decode short sounds (sent, received, error) into `AudioBuffer`s and play them through Web Audio at low volume. On
Safari, set `navigator.audioSession.type` so UI sounds mix with other audio and obey the silent switch. Native apps
play quiet, instant UI sounds that never stop your podcast.

```ts
type WithSession = Navigator & { audioSession: { type: string } };
const hasSession = (n: Navigator): n is WithSession => 'audioSession' in n;
if (hasSession(navigator)) navigator.audioSession.type = 'ambient'; // mixes with other audio; silent switch mutes it

const buffers = new Map<string, AudioBuffer>();
export async function load(ctx: AudioContext, name: string, url: string): Promise<void> {
  const res = await fetch(url);
  buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
}
export function play(ctx: AudioContext, name: string, enabled: boolean): void {
  const buf = buffers.get(name);
  if (!enabled || !buf || ctx.state !== 'running' || document.hidden) return;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = 0.35;
  src.buffer = buf;
  src.connect(gain).connect(ctx.destination);
  src.start();
}
```

**Support:** `navigator.audioSession`: Safari macOS and iOS 16.4+ only (Firefox Nightly/preview; no Chromium). Types:
`auto`, `playback`, `transient`, `transient-solo`, `ambient`, `play-and-record`. Web Audio everywhere.

**Gotchas:**
- On iOS, Web Audio uses an ambient-like session by default, which the ring/silent switch mutes. Use `playback` only
  for media or calls that must sound in silent mode; a ringtone respecting silent mode matches native behaviour.
- Pair every sound with an in-app "Sounds" toggle; don't sound every keystroke.
- Declare the audio session type locally if your TypeScript lib lacks it, as here.

**Sources:** https://www.w3.org/TR/audio-session/ · https://nattog.dev/blog/web-audio-ios-unmute

## Do not pop the keyboard unasked

Autofocus text fields on load only when the primary pointer is fine (desktop). On touch, focus only in direct response
to a tap and inside that handler; after sending, refocus synchronously so the keyboard stays up. A keyboard that pops
up on navigation feels like a website; one that refuses to open on "Reply" feels broken.

```ts
declare const composer: HTMLTextAreaElement, sendBtn: HTMLButtonElement;
declare function loadDraft(): Promise<string>;
declare function send(): void;

if (matchMedia('(pointer: fine)').matches) composer.focus({ preventScroll: true }); // on mount

// iOS opens the keyboard only for focus() inside the user's gesture: do it before any await
function onReplyTap(): void {
  composer.focus();
  void loadDraft().then((d) => { composer.value = d; });
}
// Target doesn't exist yet? Focus a hidden proxy input synchronously, then move focus once it renders.

// Send button: keep focus (and the keyboard) in the textarea
sendBtn.addEventListener('click', () => { send(); composer.focus(); });
```

**Support:** `focus({ preventScroll })`: Chrome 64, Firefox 68, Safari 15 / iOS 15.5; BCD lists no support in Chrome
Android or Firefox Android. `focus({ focusVisible })`: Chrome 145, Firefox 104, Safari 18.4.

**Gotchas:**
- The `autofocus` attribute and `focus()` after an `await` or `setTimeout` won't show the keyboard on iOS.
- Some apps `preventDefault` the send button's `pointerdown`/`mousedown` to keep focus in place; behaviour differs
  across iOS versions (Safari 27 fixed `pointerdown.preventDefault()` not suppressing compat mouse events), so test.
- Chromium's VirtualKeyboard API (`virtualkeyboardpolicy="manual"` plus `navigator.virtualKeyboard.show()/hide()`,
  Chrome 94, Chromium only) and `inputmode="none"` give finer control.

> **With React:** run the fine-pointer autofocus in a `useEffect` with an empty dependency list, not via the
> `autoFocus` prop.

**Sources:** https://gist.github.com/cathyxz/73739c1bdea7d7011abb236541dc9aaa ·
https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API

## The right on-screen keyboard

Every field declares the keyboard it needs (numeric pad, email, URL, search) and what its Return key does (send,
search, next, done, go). A "Send" label on Return and a digits-only pad for codes are details users notice at once.

```html
<textarea enterkeyhint="send"></textarea>
<input type="search" enterkeyhint="search">
<input type="email" autocomplete="email" enterkeyhint="next">
<input type="tel" autocomplete="tel">
<input type="url" inputmode="url">
<input inputmode="numeric" autocomplete="one-time-code" maxlength="6">
<input inputmode="decimal" enterkeyhint="done">
```

**Support:** `enterkeyhint`: Chrome 77, Firefox 94, Safari 13.1 / iOS 13.4. `inputmode`: Chrome 66, Firefox 95
(Android 79), Safari 12.1 / iOS 12.2 (`inputmode="none"` from iOS 13).

**Gotchas:**
- `enterkeyhint` only changes the label: implement the behaviour (move focus on `next`, submit on `go`/`search`, blur
  on `done`).
- Use `inputmode="numeric"` rather than `type="number"` for codes, PINs and card numbers: `number` adds spinners, loses
  leading zeros and changes on wheel.
- Values: `enter`, `done`, `go`, `next`, `previous`, `search`, `send`.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/enterkeyhint ·
https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inputmode

## Autofill and one-time codes

Precise `autocomplete` tokens let the OS offer saved names, emails, passwords and SMS or email codes above the
keyboard. On Chrome Android, WebOTP reads a domain-bound SMS code after one tap. One-tap code entry and filled-in
credentials are some of the most native moments in onboarding. (Passkeys: see device-apis.md (passkeys).)

```html
<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}">
<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false">
<input name="password" type="password" autocomplete="current-password">
```

```ts
declare const codeInput: HTMLInputElement, form: HTMLFormElement;

if ('OTPCredential' in window) {
  const ac = new AbortController();
  form.addEventListener('submit', () => ac.abort(), { once: true }); // typed by hand: stop waiting
  const options = { otp: { transport: ['sms'] }, signal: ac.signal }; // variable: works whether or not the lib types otp
  navigator.credentials.get(options).then((c) => {
    if (c && 'code' in c && typeof c.code === 'string') codeInput.value = c.code;
  }, () => {});
}
// Last line of the SMS: @example.com #123456
```

**Support:** `autocomplete`: universal. `one-time-code` suggestions: Safari iOS (from Messages/Mail) and Safari macOS,
Chrome Android. WebOTP (`OTPCredential`): Chrome Android 84, desktop Chrome 93 (cross-device); not Firefox or Safari.

**Gotchas:**
- Abort the WebOTP request when the form is submitted manually.
- Use `new-password` on sign-up so password managers generate one.
- `autocomplete="off"` is widely ignored for credentials: don't fight autofill.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete ·
https://developer.mozilla.org/en-US/docs/Web/API/WebOTP_API

## Text correction per field

Turn capitalization, autocorrect, spellcheck and inline writing suggestions off for handles, codes, URLs and keys, and
keep them on for prose. An autocorrected username or invite code is a frustrating tell.

```html
<input name="handle" autocapitalize="none" autocorrect="off" spellcheck="false" writingsuggestions="false">
<input name="invite" autocapitalize="characters" autocorrect="off" spellcheck="false">
<textarea name="message" autocapitalize="sentences" autocorrect="on" spellcheck="true"></textarea>
```

**Support:** `autocapitalize`: Chrome 43 (matters on Android), Firefox 111, Safari iOS 10.3 (not Safari macOS).
`autocorrect`: Safari 14.1 / iOS 14.5, Firefox 136, Chrome 153. `spellcheck`: universal. `writingsuggestions`:
Chrome 124, Safari 18; not Firefox.

**Gotchas:**
- `autocapitalize` has no effect on `type=email/url/password` (already off), and doesn't apply to `contenteditable` on
  iOS (WebKit bug 164538).
- Set `autocorrect="off"` alongside `autocapitalize="none"` on key or name fields; older Chromium ignores it, iOS uses it.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/autocapitalize ·
https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/autocorrect ·
https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/writingsuggestions

## Enter-to-send done right

On desktop, Enter sends and Shift+Enter adds a newline. On touch keyboards either Return inserts a newline and a Send
button sends (the iMessage/WhatsApp convention), or `enterkeyhint="send"` and Return sends: pick one. Never send while
an IME composition is being confirmed, and let the textarea grow with its content.

```ts
declare function send(): void;

function onKeyDown(e: KeyboardEvent): void {
  // biome-ignore lint/suspicious/noDeprecated: keyCode 229 is the only signal for Safari's post-composition Enter
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (e.shiftKey || touchOnly) return; // newline
  e.preventDefault();
  send();
}
```

```css
textarea.composer { field-sizing: content; min-height: 1lh; max-height: 8lh; }
```

**Support:** `isComposing`: universal. `field-sizing`: Chrome 123, Firefox 152, Safari 26.2 (macOS and iOS); fall back to
JS measuring elsewhere.

**Gotchas:**
- Safari fires the IME-confirm Enter after `compositionend`, so `isComposing` alone isn't enough.
- If touch Return inserts a newline, set `enterkeyhint="enter"` (or leave it unset) so the label doesn't promise "send".
- An iPad with a hardware keyboard (`any-pointer: fine`) should behave like desktop.

**Sources:** https://github.com/assistant-ui/assistant-ui/issues/8319 ·
https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing ·
https://developer.mozilla.org/en-US/docs/Web/CSS/field-sizing

## Desktop keyboard shortcuts

Cmd on Apple platforms and Ctrl elsewhere for app shortcuts (⌘K jump, ⌘, settings), single-key shortcuts only outside
text fields, and Escape closing the topmost layer. Show shortcuts in menus and tooltips and expose them with
`aria-keyshortcuts`. "Ctrl" on a Mac, or shortcuts firing while typing, are web tells.

```ts
declare function openJump(): void;
declare function focusSearch(): void;
declare function closeTopLayer(): void;

const apple = /Mac|iPhone|iPad/.test(navigator.platform); // deprecated but universal
const mod = (e: KeyboardEvent) => (apple ? e.metaKey : e.ctrlKey);
addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  const typing = e.target instanceof Element &&
    e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  if (mod(e) && e.key.toLowerCase() === 'k') { e.preventDefault(); openJump(); return; }
  if (!typing && !mod(e) && e.key === '/') { e.preventDefault(); focusSearch(); return; }
  if (e.key === 'Escape' && !typing) closeTopLayer();
});
```

```html
<button type="button" aria-keyshortcuts="Meta+K">Jump to… <kbd>⌘K</kbd></button>
```

**Support:** `KeyboardEvent.key`/`code`: universal. `navigator.platform` is deprecated but works everywhere
(`navigator.userAgentData.platform` is Chromium-only). `Keyboard.getLayoutMap()`: Chromium only.

**Gotchas:**
- Browser-reserved combos (Ctrl/Cmd+W, T, N, Tab) never reach a page in a tab.
- Override Cmd/Ctrl+F only if your in-app search is genuinely better.
- Use `e.code` for position-based shortcuts that must survive non-US layouts, `e.key` for mnemonic letters.
- Skip `e.repeat` for toggles. Modal `<dialog>` handles its own Escape.
- An iPad with a hardware keyboard sends the same events.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key ·
https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-keyshortcuts

## Selection behaviour

Buttons, tabs, nav, toolbars and labels are not selectable; content (messages, docs) and fields are. Codes select whole
with one tap, and selection uses your brand colour. Highlighting a button label on double-click, or a text loupe on a
long-pressed tab, are classic web tells.

```css
button, nav, header, [role="tab"], .toolbar, .chrome-label { -webkit-user-select: none; user-select: none; }
.content, .message-body { -webkit-user-select: text; user-select: text; }
input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; } /* never inherit none into fields */
.invite-code, .hash { -webkit-user-select: all; user-select: all; }
::selection { background: var(--selection-bg); color: var(--selection-fg); }
```

**Support:** Unprefixed `user-select`: Chrome 54, Firefox 69. Safari macOS and iOS stable still need
`-webkit-user-select` (unprefixed only in Technology Preview).

**Gotchas:**
- Always write both prefixed and unprefixed forms.
- Historically `-webkit-user-select: none` inherited into iOS inputs made them uneditable, hence the explicit reset.
- Don't apply `none` to content on desktop.
- On touch, if long-press opens your menu (with selection off), offer Copy and Select text actions.
- Safari 27 reportedly improved iOS selection inside editable content (unverified details).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/user-select ·
https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

## Cursors on desktop

Use the arrow cursor over app chrome and labels instead of an I-beam, and the hand only on links (optionally on
buttons, as a design choice). Drag handles get `grab`/`grabbing`, resizers `col-resize`/`row-resize`. An I-beam over a
toolbar label signals "web page".

```css
.app-chrome, .app-chrome * { cursor: default; }
a[href] { cursor: pointer; }
.drag-handle { cursor: grab; }
.dragging, .dragging * { cursor: grabbing; }
.split-resizer { cursor: col-resize; }
.content, input, textarea { cursor: auto; }
```

**Support:** Universal on desktop; irrelevant on touch.

**Gotchas:**
- Whether buttons get the hand is a design-system decision (macOS and Windows native buttons use the arrow); be
  consistent.
- Don't let `cursor: default` override text cursors in editable areas.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/cursor

## No ghost drags or callouts on UI images

Stop UI images (avatars, logos, icons) and app-chrome links from producing a browser drag ghost on desktop and the
save/preview/share callout on iOS long-press. Native apps never show either.

```html
<img src="/avatar.png" alt="" draggable="false">
<a href="/settings" draggable="false">Settings</a>
```

```css
.ui img, .ui svg, .ui a { -webkit-user-drag: none; }
@media (pointer: coarse) { .ui img, .ui a { -webkit-touch-callout: none; } }
```

**Support:** `draggable`: universal. `-webkit-user-drag`: Chromium, Safari (not Firefox, where `draggable="false"` is
enough). `-webkit-touch-callout`: Safari iOS only.

**Gotchas:**
- Leave content images (shared photos) draggable and saveable: users expect that.
- On links, `draggable="false"` also prevents dragging to the tab bar: fine for chrome, bad for content links.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/draggable ·
https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-touch-callout

## Focus rings only for keyboard users

Show focus outlines when focus comes from the keyboard, not after a tap or click. A ring around a button after every
tap looks unpolished, and removing focus styles entirely breaks keyboard users. (Broader accessibility parity: see
navigation-ui-patterns.md (accessibility parity).)

```css
:focus:not(:focus-visible) { outline: none; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
```

```ts
declare const nextItem: HTMLElement;
// after keyboard-driven navigation, force the ring on programmatic focus
// (a variable, because older TypeScript DOM libs lack focusVisible)
const opts = { preventScroll: false, focusVisible: true };
nextItem.focus(opts);
```

**Support:** `:focus-visible`: Chrome 86, Firefox 85, Safari 15.4. `focus({ focusVisible })`: Chrome 145,
Firefox 104, Safari 18.4.

**Gotchas:**
- Text inputs always match `:focus-visible` when focused, as expected.
- Use `box-shadow` rings if outlines clip inside `overflow: hidden` containers.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible

## Smooth drag rendering

During drags, write only `transform`/`opacity`, once per frame, and don't re-render a framework tree on every
`pointermove`. For drawing or handwriting, read all coalesced samples and optionally predicted ones. Content lagging
behind the finger at 120Hz is the clearest "not native" signal. (General rendering performance: see
motion-performance.md.)

```ts
declare const el: HTMLElement, canvas: HTMLCanvasElement;
declare const x0: number;
const ctx = canvas.getContext('2d', { desynchronized: true }); // lower latency in Chromium

let raf = 0, x = 0;
el.addEventListener('pointerdown', () => { el.style.willChange = 'transform'; }); // only while dragging
el.addEventListener('pointermove', (e) => {
  x = e.clientX - x0;
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; el.style.transform = `translate3d(${x}px,0,0)`; });
});
el.addEventListener('pointerup', () => { cancelAnimationFrame(raf); raf = 0; el.style.willChange = ''; });

// ink: every hardware sample, not one per frame
canvas.addEventListener('pointermove', (e) => {
  if (!ctx) return;
  const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  for (const p of samples.length ? samples : [e]) ctx.lineTo(p.offsetX, p.offsetY);
  ctx.stroke();
});
```

**Support:** `getCoalescedEvents`: Chrome 58, Firefox 59 (Android 79), Safari 18.2 / iOS 18.2. `getPredictedEvents`:
Chrome 77, Firefox 89, Safari 18.2. `pointerrawupdate`: Chromium 77 (secure contexts only), Firefox 148; not Safari.

**Gotchas:**
- `getCoalescedEvents()` may return an empty list (some Firefox Android builds), hence the fallback to the event itself.
- Setting framework state per move is fine at small scale; writing style directly and committing state on release
  avoids re-render jank on long lists.
- Never animate `left`/`top`/`width` while dragging.
- Cancel the pending rAF on end.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents ·
https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getPredictedEvents

## Release animations that continue the velocity

When a drag ends, animate to the resting place with a duration derived from the remaining distance and release
velocity, using a decelerating or spring-like curve; under reduced motion, jump. A fixed 300ms ease after a fast flick
looks like the UI catching your finger. (View Transitions and general reduced-motion rules: see motion-performance.md.)

```ts
export function settle(el: HTMLElement, from: number, to: number, v: number /* px/ms */): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.style.transition = 'none';
    el.style.transform = `translateX(${to}px)`;
    return;
  }
  const ms = Math.min(400, Math.max(140, Math.abs(to - from) / Math.max(0.3, Math.abs(v))));
  el.style.transition = `transform ${ms}ms var(--spring)`;
  el.style.transform = `translateX(${to}px)`;
}
```

```css
:root { --spring: cubic-bezier(.2, .9, .3, 1); }
@supports (transition-timing-function: linear(0, 1)) {
  :root { --spring: linear(0, 0.45 10%, 0.85 22%, 1.02 36%, 1.005 50%, 1); }
}
```

**Support:** `linear()` easing: Chrome 113, Firefox 112, Safari 17.2 / iOS 17.2.

**Gotchas:**
- `transitionend` doesn't fire for 0ms transitions (reduced motion): don't hang state changes on it.
- Overshooting springs are fine for snaps; avoid overshoot on destructive commits.
- Generate `linear()` spring curves with a tool rather than by hand.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear ·
https://developer.apple.com/videos/play/wwdc2018/803/

## Custom double-tap gestures

Detect two touch taps within ~300ms and ~24px yourself, and use `dblclick` for the mouse. With
`touch-action: manipulation` the browser no longer zooms on double-tap, so you own the gesture (double-tap to like or
to zoom).

```ts
declare const el: HTMLElement;
declare function onDoubleTap(x: number, y: number): void;

let last = 0, lx = 0, ly = 0, lastTouchUp = 0;
el.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'touch') return;
  lastTouchUp = e.timeStamp;
  if (e.timeStamp - last < 300 && Math.hypot(e.clientX - lx, e.clientY - ly) < 24) {
    last = 0;
    onDoubleTap(e.clientX, e.clientY);
    return;
  }
  last = e.timeStamp; lx = e.clientX; ly = e.clientY;
});
el.addEventListener('dblclick', (e) => {
  if (e.timeStamp - lastTouchUp > 600) onDoubleTap(e.clientX, e.clientY); // ignore dblclick synthesized from touch
});
```

**Support:** Pointer Events everywhere. Whether `dblclick` fires for touch varies by browser, hence the guard.

**Gotchas:**
- If a single tap also does something, it must wait out the double-tap window, which adds lag to every tap. Use
  double-tap only where a single tap is harmless (a message bubble, an image at 1x).
- Give the action a visible alternative (button or menu item).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Element/dblclick_event · https://w3c.github.io/pointerevents/

## Interest invokers for hover cards

The `interestfor` attribute on a button or link shows a target popover when the user "shows interest": hover with a
mouse, focus or a hotkey with a keyboard, long-press on touch. User and link preview cards then work for every input
type with browser-managed timing and no hand-written hover or long-press logic. (Popover basics: see
navigation-ui-patterns.md (popover).)

```html
<button type="button" interestfor="user-card">@alex</button>
<div id="user-card" popover="hint">…profile preview…</div>
```

```ts
const supported = 'interestForElement' in HTMLButtonElement.prototype;
if (!supported) { /* polyfill (mfreed7/interestfor) or keep your own hover/long-press code */ }
```

**Support:** `interestfor`: Chromium and Chrome Android 142+ only; not Firefox, Safari macOS or Safari iOS.
`popover="hint"` (current spec): Chrome 151, Firefox 153, Safari Technology Preview only.

**Gotchas:**
- Chromium-only today: a progressive enhancement.
- A long-press used for interest conflicts with a long-press context menu on the same element: pick one per element.
- iOS got tap-outside light dismiss for popovers only in Safari 18.3.

**Sources:** https://developer.chrome.com/blog/new-in-chrome-142 · https://github.com/mfreed7/interestfor ·
https://css-tricks.com/a-first-look-at-the-interest-invoker-api-for-hover-triggered-popovers/

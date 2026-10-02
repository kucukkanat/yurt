/**
 * gestures.ts: touch gestures that feel native (swipe with axis lock and flick, long-press, rubber banding,
 * momentum snapping), as pure math plus thin Pointer Events wiring.
 *
 * Rules this follows:
 *   - Pointer Events are the one input model, and custom gestures run only for pointerType 'touch'. Mouse and pen keep
 *     text selection, hover menus and native drag.
 *   - pointercancel means the browser or OS took the touch (scroll, pinch, the system back swipe): reset, never commit.
 *   - touch-action decides, before any JS runs, what the browser keeps. A horizontally swipeable row needs
 *     `touch-action: pan-y pinch-zoom` (native.css .swipe-x): vertical scroll and pinch zoom stay native, horizontal
 *     drags reach the handlers. Plain `pan-y` blocks pinch zoom when the pinch starts on the row. `none` only on small
 *     handles and canvases. touch-action is read at pointerdown and can't change mid-gesture.
 *   - A drag is nothing until it moves SLOP px, then locks to its dominant axis for good: a mostly vertical drag is a
 *     scroll, never a swipe, so rows don't wobble while the list scrolls.
 *   - A swipe completes on distance, or on a shorter fast flick measured over the last ~80 ms (not the whole gesture).
 *   - Long-press opens your menu on touch instead of the iOS callout or the Android context menu, and is cancelled by
 *     movement or a scroll. Make the same actions reachable without it (right-click, keyboard, a visible button).
 *   - Gated work (vibrate, audio, focus that opens the keyboard) belongs in pointerup/click: a touch pointerdown is not
 *     a user activation.
 *
 * Browsers: Pointer Events Chrome 55, Firefox 59, Safari 13; touch-action pan-x/pan-y/pinch-zoom iOS 13+. Pull-down
 * gestures on scrollable content (dismiss a sheet, pull to refresh) need Touch Events instead: the browser sends
 * pointercancel when it starts the overscroll.
 *
 * Adapt: the thresholds below (Yurt-tested defaults; Android's touch slop is ~8dp, iOS long-press 500 ms, Android 400).
 * Unit-test the pure functions with fixed coordinates and timestamps; E2E needs synthetic pointer events with
 * pointerType 'touch' (Playwright's touchscreen only taps).
 */

/** Movement (px) before a gesture picks an axis. */
export const SLOP = 10;
/** Distance (px) that completes a swipe, or SHORT_PX at FLICK speed (px/ms) in the same direction. */
export const SWIPE_PX = 64;
export const SHORT_PX = 32;
export const FLICK = 0.5;
/** Velocity is measured over this recent window (ms). */
export const VELOCITY_WINDOW_MS = 80;
/** Holding still this long (ms) is a long-press. */
export const LONG_PRESS_MS = 450;
/** Drawer edge swipes may start only this close (px) to the edge; wider than Safari's own back-swipe strip. */
export const EDGE_PX = 28;

export type Axis = 'x' | 'y' | null;
export type Direction = 'left' | 'right' | 'up' | 'down';

export interface Sample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

/** One finger's gesture so far. Immutable: every move returns a new value. */
export interface Track {
  readonly id: number;
  readonly start: Sample;
  readonly axis: Axis;
  /** Recent samples only (the velocity window), oldest first. */
  readonly recent: readonly Sample[];
}

export const begin = (id: number, x: number, y: number, t: number): Track => ({
  id,
  start: { x, y, t },
  axis: null,
  recent: [{ x, y, t }],
});

/** The axis a gesture locks to: undecided inside the slop, then the dominant axis, decided once. */
export function lockAxis(dx: number, dy: number, axis: Axis, slop = SLOP): Axis {
  if (axis) return axis;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < slop) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

export function moveTo(tr: Track, x: number, y: number, t: number): Track {
  const recent = [...tr.recent, { x, y, t }].filter((s) => t - s.t <= VELOCITY_WINDOW_MS);
  return { ...tr, axis: lockAxis(x - tr.start.x, y - tr.start.y, tr.axis), recent };
}

const last = (tr: Track): Sample => tr.recent.at(-1) ?? tr.start;

/** Offset along the locked axis (0 while undecided or locked to the other axis): what to paint while dragging. */
export function offset(tr: Track, along: 'x' | 'y'): number {
  if (tr.axis !== along) return 0;
  const p = last(tr);
  return along === 'x' ? p.x - tr.start.x : p.y - tr.start.y;
}

/** Velocity (px/ms) along an axis over the recent window. */
export function velocity(samples: readonly Sample[], along: 'x' | 'y'): number {
  const first = samples[0];
  const end = samples.at(-1);
  if (!first || !end || end.t === first.t) return 0;
  return ((along === 'x' ? end.x - first.x : end.y - first.y) / (end.t - first.t));
}

/** Whether a drag of `distance` px released at `v` px/ms completes: far enough, or a short flick the same way. */
export const completes = (distance: number, v: number): boolean =>
  Math.abs(distance) >= SWIPE_PX ||
  (Math.abs(distance) >= SHORT_PX && Math.abs(v) >= FLICK && Math.sign(v) === Math.sign(distance));

/** The swipe a finished gesture made, if any. A flick that reverses at the end (pulling back to cancel) is none. */
export function swipeOf(tr: Track): Direction | null {
  if (!tr.axis) return null;
  const d = offset(tr, tr.axis);
  if (!completes(d, velocity(tr.recent, tr.axis))) return null;
  if (tr.axis === 'x') return d > 0 ? 'right' : 'left';
  return d > 0 ? 'down' : 'up';
}

/** Still a long-press candidate: the finger hasn't committed to moving anywhere. */
export const stillHeld = (tr: Track): boolean => tr.axis === null;

/**
 * Rubber-band resistance: how far content moves for an `overshoot` px drag past a limit, in a view `dimension` px
 * long. c = 0.55 approximates UIScrollView (community-derived, not documented by Apple).
 */
export const rubber = (overshoot: number, dimension: number, c = 0.55): number =>
  (overshoot * dimension * c) / (dimension + c * overshoot);

/** Clamps `v` to [min, max] with rubber banding past either end, instead of a hard stop. */
export const clampRubber = (v: number, min: number, max: number, dimension: number): number =>
  v < min ? min - rubber(min - v, dimension) : v > max ? max + rubber(v - max, dimension) : v;

/** Distance (px) momentum would still carry content released at `v` px/ms (0.998 normal, 0.99 snappy deceleration). */
export const project = (v: number, rate = 0.998): number => (v * rate) / (1 - rate);

/** The stop a drawer or sheet released at `pos` with velocity `v` should snap to: nearest to where momentum lands. */
export function snapTo(pos: number, v: number, stops: readonly number[]): number {
  const target = pos + project(v);
  return stops.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), stops[0] ?? pos);
}

/** Duration (ms) for a release animation that continues the finger's speed; 0 under reduced motion. */
export const settleMs = (distance: number, v: number, reducedMotion: boolean): number =>
  reducedMotion ? 0 : Math.round(Math.min(400, Math.max(140, Math.abs(distance) / Math.max(0.3, Math.abs(v)))));

/** Whether a touch moved too far for a long-press (it's becoming a scroll or a drag). */
export const movedPastSlop = (dx: number, dy: number, slop = SLOP): boolean => Math.hypot(dx, dy) > slop;

/* ------------------------------------------------------------------------------------------------- DOM wiring */

export interface SwipeHandlers {
  /** Called once per frame while a locked drag moves, with the offset along the swipe axis (0 on release/cancel). */
  readonly onDrag?: (offset: number) => void;
  readonly onSwipe: (direction: Direction) => void;
  /** Which axis this element swipes along (default 'x'). */
  readonly axis?: 'x' | 'y';
  /** Only start when the touch begins within this many px of the left edge (drawers). */
  readonly fromLeftEdge?: number;
}

/**
 * Swipes on `el`, touch only. Set the element's touch-action in CSS (.swipe-x = pan-y pinch-zoom for horizontal
 * swipes). Returns a cleanup.
 */
export function onSwipe(el: HTMLElement, handlers: SwipeHandlers): () => void {
  const along = handlers.axis ?? 'x';
  let tr: Track | null = null;
  let frame = 0;

  const paint = (value: number) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => handlers.onDrag?.(value));
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    if (handlers.fromLeftEdge !== undefined && e.clientX > handlers.fromLeftEdge) return;
    tr = begin(e.pointerId, e.clientX, e.clientY, e.timeStamp);
  };
  const move = (e: PointerEvent) => {
    if (!tr || e.pointerId !== tr.id) return;
    tr = moveTo(tr, e.clientX, e.clientY, e.timeStamp);
    if (tr.axis === along) paint(offset(tr, along));
  };
  const up = (e: PointerEvent) => {
    if (!tr || e.pointerId !== tr.id) return;
    const done = swipeOf(moveTo(tr, e.clientX, e.clientY, e.timeStamp));
    tr = null;
    paint(0);
    if (done && (along === 'x') === (done === 'left' || done === 'right')) handlers.onSwipe(done);
  };
  const cancel = (e: PointerEvent) => {
    if (!tr || e.pointerId !== tr.id) return;
    tr = null; // the browser or OS took the touch: spring back, never commit
    paint(0);
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return () => {
    cancelAnimationFrame(frame);
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}

/**
 * Long-press on touch opens `open(x, y)` (your action sheet) and suppresses what would follow: the Android context
 * menu and the click on release. Pair with CSS on the element for coarse pointers:
 * `-webkit-touch-callout: none; -webkit-user-select: none; user-select: none` (iOS callout and loupe), and offer
 * "Copy" / "Select text" in the menu since touch users lose native selection there. Returns a cleanup.
 */
export function onLongPress(el: HTMLElement, open: (x: number, y: number) => void, ms = LONG_PRESS_MS): () => void {
  let timer = 0;
  let fired = false;
  let start: { x: number; y: number; id: number } | null = null;
  const stop = () => {
    clearTimeout(timer);
    start = null;
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    fired = false;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    const { x, y } = start;
    timer = window.setTimeout(() => {
      fired = true;
      start = null;
      open(x, y);
    }, ms);
  };
  const move = (e: PointerEvent) => {
    if (start && e.pointerId === start.id && movedPastSlop(e.clientX - start.x, e.clientY - start.y)) stop();
  };
  // Android follows a long-press with its own context menu; iOS doesn't fire contextmenu for touch at all.
  const menu = (e: Event) => {
    if (fired) e.preventDefault();
  };
  // The release after a long-press must not also "tap" the element.
  const click = (e: Event) => {
    if (!fired) return;
    fired = false;
    e.preventDefault();
    e.stopPropagation();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop); // a scroll started
  el.addEventListener('contextmenu', menu);
  el.addEventListener('click', click, { capture: true });
  return () => {
    stop();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', stop);
    el.removeEventListener('pointercancel', stop);
    el.removeEventListener('contextmenu', menu);
    el.removeEventListener('click', click, { capture: true });
  };
}

/**
 * iOS applies :active (native.css pressed states) only when a touchstart listener exists on the element or body.
 * A passive no-op listener is enough and costs nothing. Frameworks may already add one; verify on a device.
 */
export function enableActiveStates(): () => void {
  const noop = () => {};
  document.body.addEventListener('touchstart', noop, { passive: true });
  return () => document.body.removeEventListener('touchstart', noop);
}

/**
 * Right-click, two-finger click and Shift+F10 / the Menu key open the same menu as the touch long-press, without
 * stealing the native menu from links, fields or a text selection. Touch-originated contextmenu events (Android's
 * long-press) are left to onLongPress so the menu doesn't open twice. Returns a cleanup.
 */
export function onContextMenu(el: HTMLElement, open: (x: number, y: number) => void): () => void {
  const handler = (e: MouseEvent) => {
    // contextmenu is a PointerEvent in Chrome 92+, Firefox 129+, Safari 18.2+.
    if (typeof PointerEvent !== 'undefined' && e instanceof PointerEvent && e.pointerType === 'touch') return;
    const target = e.target instanceof Element ? e.target : null;
    if (getSelection()?.toString() || target?.closest('a[href], input, textarea, [contenteditable]')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const fromKeyboard = e.clientX === 0 && e.clientY === 0; // heuristic: the Menu key / Shift+F10 report 0,0
    open(fromKeyboard ? r.left + 16 : e.clientX, fromKeyboard ? r.top + 16 : e.clientY);
  };
  el.addEventListener('contextmenu', handler);
  return () => el.removeEventListener('contextmenu', handler);
}

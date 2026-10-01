/**
 * Touch gestures as pure functions of where a finger went and when, so thresholds are tested without a screen.
 * ui/touch.ts turns pointer events into these.
 */

export interface Track {
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  t: number;
  /** The axis the gesture committed to once it moved far enough; null while undecided. */
  axis: 'x' | 'y' | null;
}

/** Moving this far (px) decides the axis: a mostly-vertical drag is a scroll, never a swipe. */
const LOCK_PX = 10;
/** A swipe covers this distance (px), or SHORT_PX when it's fast (a flick). */
const SWIPE_PX = 64;
const SHORT_PX = 32;
const FLICK_PX_PER_MS = 0.5;
/** Holding still this long (ms) is a long-press. */
export const LONG_PRESS_MS = 450;

export const begin = (x: number, y: number, t: number): Track => ({ x0: x, y0: y, t0: t, x, y, t, axis: null });

export function moveTo(tr: Track, x: number, y: number, t: number): Track {
  const dx = Math.abs(x - tr.x0);
  const dy = Math.abs(y - tr.y0);
  const axis = tr.axis ?? (Math.max(dx, dy) >= LOCK_PX ? (dx > dy ? 'x' : 'y') : null);
  return { ...tr, x, y, t, axis };
}

/** How far a horizontal gesture has gone (0 while it isn't one): the offset to show while dragging. */
export const dragX = (tr: Track) => (tr.axis === 'x' ? tr.x - tr.x0 : 0);

export type Swipe = 'left' | 'right' | 'up' | 'down';

/** The swipe a finished gesture made, if it was one: far enough, or a quick flick, along its locked axis. */
export function swipeOf(tr: Track): Swipe | null {
  if (!tr.axis) return null;
  const d = tr.axis === 'x' ? tr.x - tr.x0 : tr.y - tr.y0;
  const speed = Math.abs(d) / Math.max(1, tr.t - tr.t0);
  if (Math.abs(d) < SWIPE_PX && !(Math.abs(d) >= SHORT_PX && speed >= FLICK_PX_PER_MS)) return null;
  if (tr.axis === 'x') return d > 0 ? 'right' : 'left';
  return d > 0 ? 'down' : 'up';
}

/** Far enough that letting go now completes the swipe: when to give the "it'll work" haptic tick while dragging. */
export const reached = (offset: number) => Math.abs(offset) >= SWIPE_PX;

/** Still a long-press candidate: the finger hasn't committed to moving anywhere. */
export const stillHeld = (tr: Track) => tr.axis === null;

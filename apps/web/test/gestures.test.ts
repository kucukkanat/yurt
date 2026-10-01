import { describe, expect, it } from 'vitest';
import { begin, dragX, moveTo, reached, stillHeld, swipeOf } from '../src/lib/gestures';
import { fc } from './fuzz';

/** A gesture from (0,0) at t=0 through each point [x, y, t]. */
const path = (...pts: [number, number, number][]) => pts.reduce((tr, [x, y, t]) => moveTo(tr, x, y, t), begin(0, 0, 0));

describe('gestures', () => {
  it('stay undecided until the finger moves 10px, then lock to the axis it moved along', () => {
    expect(path([6, 4, 50]).axis).toBeNull();
    expect(stillHeld(path([6, 4, 50]))).toBe(true);
    expect(path([12, 3, 50]).axis).toBe('x');
    expect(path([3, -12, 50]).axis).toBe('y');
    // Once locked, it stays: a horizontal swipe that drifts down is still horizontal.
    expect(path([12, 0, 50], [20, 60, 100]).axis).toBe('x');
    expect(stillHeld(path([12, 0, 50]))).toBe(false);
  });

  it('report the horizontal drag only for horizontal gestures', () => {
    expect(dragX(path([40, 2, 50]))).toBe(40);
    expect(dragX(path([2, 40, 50]))).toBe(0);
  });

  it('are swipes when long enough, or short and quick; scrolls and slow nudges are not', () => {
    expect(swipeOf(path([70, 0, 400]))).toBe('right');
    expect(swipeOf(path([-70, 0, 400]))).toBe('left');
    expect(swipeOf(path([0, 70, 400]))).toBe('down');
    expect(swipeOf(path([0, -70, 400]))).toBe('up');
    expect(swipeOf(path([40, 0, 50]))).toBe('right'); // a flick
    expect(swipeOf(path([40, 0, 400]))).toBeNull(); // too slow for its length
    expect(swipeOf(path([20, 0, 5]))).toBeNull(); // too short, however fast
    expect(swipeOf(path([4, 4, 5]))).toBeNull(); // never moved enough to count
    expect(swipeOf(begin(0, 0, 0))).toBeNull();
  });

  it('say when a drag has gone far enough to complete', () => {
    expect([reached(63), reached(64), reached(-64)]).toEqual([false, true, true]);
  });

  it('never decide a swipe against the axis they locked to', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: -300, max: 300 }), fc.integer({ min: -300, max: 300 }), fc.integer({ min: 1, max: 2000 })), { maxLength: 8 }), (pts) => {
        const tr = path(...pts);
        const s = swipeOf(tr);
        if (s) expect(tr.axis).toBe(s === 'left' || s === 'right' ? 'x' : 'y');
      }),
    );
  });
});

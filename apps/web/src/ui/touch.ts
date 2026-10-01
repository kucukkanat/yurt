import type React from 'react';
import { useRef, useState } from 'react';
import { begin, dragX, LONG_PRESS_MS, moveTo, reached, stillHeld, swipeOf, type Swipe, type Track } from '../lib/gestures';

/**
 * Pointer events → gestures (lib/gestures.ts), for touch only: mouse and pen keep their usual behaviour (selecting
 * text, hover menus). Elements using these set `touch-action: pan-y`, so the browser keeps vertical scrolling and
 * leaves horizontal drags to us instead of cancelling them.
 */

type Pointer = React.PointerEvent<HTMLElement>;
interface Handlers {
  onPointerDown(e: Pointer): void;
  onPointerMove(e: Pointer): void;
  onPointerUp(e: Pointer): void;
  onPointerCancel(e: Pointer): void;
  onContextMenu?(e: React.MouseEvent<HTMLElement>): void;
}

/** Runs every handler set for each event, so one element can take a swipe and a long-press. */
export const both = (a: Handlers, b: Handlers): Handlers => ({
  onPointerDown: (e) => {
    a.onPointerDown(e);
    b.onPointerDown(e);
  },
  onPointerMove: (e) => {
    a.onPointerMove(e);
    b.onPointerMove(e);
  },
  onPointerUp: (e) => {
    a.onPointerUp(e);
    b.onPointerUp(e);
  },
  onPointerCancel: (e) => {
    a.onPointerCancel(e);
    b.onPointerCancel(e);
  },
  onContextMenu: (e) => {
    a.onContextMenu?.(e);
    b.onContextMenu?.(e);
  },
});

/**
 * Swipes on an element. `edge`: only gestures that start within this many px of the left edge (opening a drawer).
 * `onReach` fires once per gesture as the drag passes the swipe distance. `offset` is the live horizontal drag, for
 * moving the element with the finger.
 */
export function useSwipe(on: Partial<Record<Swipe, () => void>>, opts: { edge?: number; onReach?: () => void } = {}) {
  const track = useRef<Track | null>(null);
  const passed = useRef(false);
  const [offset, setOffset] = useState(0);
  const end = () => {
    track.current = null;
    setOffset(0);
  };
  const handlers: Handlers = {
    onPointerDown: (e) => {
      if (e.pointerType !== 'touch' || (opts.edge !== undefined && e.clientX > opts.edge)) return;
      track.current = begin(e.clientX, e.clientY, e.timeStamp);
      passed.current = false;
    },
    onPointerMove: (e) => {
      if (!track.current) return;
      track.current = moveTo(track.current, e.clientX, e.clientY, e.timeStamp);
      const x = dragX(track.current);
      setOffset(x);
      if (!passed.current && reached(x)) {
        passed.current = true;
        opts.onReach?.();
      }
    },
    onPointerUp: (e) => {
      const t = track.current;
      end();
      const s = t && swipeOf(moveTo(t, e.clientX, e.clientY, e.timeStamp));
      if (s) on[s]?.();
    },
    onPointerCancel: end,
  };
  return { handlers, offset };
}

/** A touch held still for LONG_PRESS_MS runs `onLong`; the browser's own long-press menu is suppressed then. */
export function useLongPress(onLong: () => void): Handlers {
  const track = useRef<Track | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    track.current = null;
  };
  return {
    onPointerDown: (e) => {
      if (e.pointerType !== 'touch') return;
      fired.current = false;
      track.current = begin(e.clientX, e.clientY, e.timeStamp);
      timer.current = setTimeout(() => {
        track.current = null;
        fired.current = true;
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      if (!track.current) return;
      track.current = moveTo(track.current, e.clientX, e.clientY, e.timeStamp);
      if (!stillHeld(track.current)) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // Android follows a long-press with the page's context menu (copy, open link…): ours replaced it.
    onContextMenu: (e) => {
      if (fired.current) e.preventDefault();
    },
  };
}

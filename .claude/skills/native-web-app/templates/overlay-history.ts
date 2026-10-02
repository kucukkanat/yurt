/**
 * overlay-history.ts: Back closes the topmost overlay (drawer, sheet, full-screen panel, lightbox, menu) before it
 * navigates, the way native apps behave. On Android, Back leaving the screen (or the app) with a sheet open is the most
 * common "this is a website" complaint.
 *
 * Two mechanisms behind one call:
 *   - CloseWatcher (Chrome/Edge 126+, Firefox 149+; Safari only in Technology Preview as of Safari 27): Android Back,
 *     Esc and assistive-tech dismiss become a close event. Modal <dialog> (showModal) and popover="auto" already join
 *     the same stack with no code (Android Back closes them from Chrome 120): prefer them, and use this for custom UI.
 *   - Fallback (Safari/iOS, older browsers): one same-document history entry per open overlay (pushState, no URL
 *     change), so browser Back, the iOS edge swipe and history.back() pop the overlay through popstate.
 *
 * Rules:
 *   - Call onCloseRequest() INSIDE the tap/click handler that opens the overlay. CloseWatchers created without user
 *     activation are grouped (one Back closes all of them), and Chrome's history intervention lets the Back button
 *     skip entries pushed without activation, so Back would leave the app.
 *   - Close from your own UI (X button, scrim tap) with `.close()`, so every path runs the same close once.
 *   - If the overlay goes away by other means (the route changed), call `.dispose()`, or the next Back is swallowed.
 *   - Never push a "sentinel" entry after a Back to trap the user; you can't, and Chrome then marks entries skippable.
 *   - Don't also listen for Escape on the same overlay: CloseWatcher already maps it (it would double-fire).
 *   - iOS has no Back button for in-page overlays: always show a visible close button too.
 *   - When Safari already animated an edge swipe back (hasUAVisualTransition), skip your own exit animation.
 *
 * Adapt: nothing required. Pure helpers (depthOf, withDepth, overlaysToClose) are unit-testable; Playwright doesn't
 * reproduce Chrome's Android skip behaviour, so check Back on a real Android device.
 */

/** How the overlay is being closed. */
export interface CloseInfo {
  /** False when the browser already animated the transition (Safari edge swipe): close without your own animation. */
  readonly animate: boolean;
}

export interface CloseRequest {
  /** Close from your own UI. Runs the close callback once, through the same path as Back. */
  close(): void;
  /** Forget the overlay without running the callback (it was closed by something else, e.g. a route change). */
  dispose(): void;
}

/* ------------------------------------------------------------------------------------------------- pure helpers */

const STATE_KEY = 'overlays';

/** How many overlays a history entry was pushed for (0 for ordinary entries and foreign state). */
export function depthOf(state: unknown): number {
  if (typeof state !== 'object' || state === null || !(STATE_KEY in state)) return 0;
  const depth: unknown = Reflect.get(state, STATE_KEY);
  return typeof depth === 'number' && Number.isInteger(depth) && depth > 0 ? depth : 0;
}

/** The history state for an entry at `depth`, keeping whatever the app's router stored there. */
export function withDepth(state: unknown, depth: number): Record<string, unknown> {
  const base: Record<string, unknown> = typeof state === 'object' && state !== null ? { ...state } : {};
  return { ...base, [STATE_KEY]: depth };
}

/**
 * How many open overlays (their entries' depths, bottom first) a popstate to an entry at `depth` closes: every one
 * pushed above it. A Forward onto a stale entry closes none.
 */
export function overlaysToClose(openDepths: readonly number[], depth: number): number {
  let n = 0;
  for (let i = openDepths.length - 1; i >= 0 && (openDepths[i] ?? 0) > depth; i--) n++;
  return n;
}

/* ------------------------------------------------------------------------------------------------- DOM wiring */

interface CloseWatcherLike extends EventTarget {
  close(): void;
  destroy(): void;
}
type CloseWatcherCtor = new () => CloseWatcherLike;

/** Read at runtime, not declared globally: future lib.dom versions may declare it differently. */
function closeWatcherCtor(): CloseWatcherCtor | null {
  const ctor: unknown = Reflect.get(window, 'CloseWatcher');
  return isCtor(ctor) ? ctor : null;
}
const isCtor = (v: unknown): v is CloseWatcherCtor => typeof v === 'function';

/** An open overlay using the history fallback, and the depth of the history entry pushed for it. */
interface Open {
  readonly depth: number;
  readonly close: (info: CloseInfo) => void;
}
/** Bottom first. Depths only grow upwards, but may have gaps (an overlay below was closed directly). */
const stack: Open[] = [];
let listening = false;

const topDepth = (): number => stack.at(-1)?.depth ?? 0;

function onPopState(e: PopStateEvent): void {
  const animate = !('hasUAVisualTransition' in e && e.hasUAVisualTransition === true);
  const depth = depthOf(e.state);
  for (
    let n = overlaysToClose(
      stack.map((o) => o.depth),
      depth,
    );
    n > 0;
    n--
  )
    stack.pop()?.close({ animate });
  // Forward onto an entry whose overlay is gone: bring the entry back in line with what's open.
  if (depth > topDepth()) history.replaceState(withDepth(e.state, topDepth()), '');
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', onPopState);
  // After a reload or restore an entry may still claim open overlays while none are: neutralise it, or the next
  // overlay's Back would land on it and close nothing.
  if (depthOf(history.state) > 0) history.replaceState(withDepth(history.state, 0), '');
}

/** Call once at boot (optional: the first onCloseRequest does it too) so a restored entry is neutralised early. */
export function setupOverlayHistory(): void {
  if (!closeWatcherCtor()) listen();
}

/**
 * Registers `onClose` to run on the next close request (Android Back, Esc, browser Back, iOS edge swipe) while the
 * overlay is open. Call it inside the user gesture that opens the overlay.
 */
export function onCloseRequest(onClose: (info: CloseInfo) => void): CloseRequest {
  const Watcher = closeWatcherCtor();
  if (Watcher) {
    const watcher = new Watcher();
    watcher.addEventListener('close', () => onClose({ animate: true }), { once: true });
    // close() on an inactive (closed or destroyed) watcher is a no-op, so repeated calls are safe.
    return { close: () => watcher.close(), dispose: () => watcher.destroy() };
  }

  listen();
  let done = false;
  // history.back() is async: a second close()/dispose() before its popstate must not go back a second time
  // (that would pop the page underneath, or leave the app).
  let goingBack = false;
  // Above the current entry, not stack.length + 1: a stale entry left below must not share our depth, or Back from
  // this overlay would land on an entry of equal depth and close nothing.
  const depth = depthOf(history.state) + 1;
  const item: Open = {
    depth,
    close: (info) => {
      if (done) return;
      done = true;
      onClose(info);
    },
  };
  stack.push(item);
  history.pushState(withDepth(history.state, depth), '');
  const ownsCurrentEntry = () => stack.at(-1) === item && depthOf(history.state) === depth;
  const remove = () => {
    const i = stack.indexOf(item);
    if (i !== -1) stack.splice(i, 1);
  };

  return {
    close: () => {
      if (done || goingBack) return;
      // Let Back do it, so popstate stays the single close path. If history has moved on (the app navigated above
      // the overlay, or it isn't the top one), close directly and leave the stale entry: a later Back over it is a
      // harmless no-op.
      if (ownsCurrentEntry()) {
        goingBack = true;
        history.back();
      } else {
        remove();
        item.close({ animate: true });
      }
    },
    dispose: () => {
      if (done) return;
      done = true;
      const top = ownsCurrentEntry() && !goingBack;
      remove();
      if (top) history.back(); // pop our now-empty entry; popstate finds nothing left to close
    },
  };
}

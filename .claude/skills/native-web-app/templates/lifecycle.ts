/**
 * lifecycle.ts: survive the app being backgrounded, frozen, discarded or restored from the back/forward cache, the
 * way native apps do: save on the way out, reconnect and resync on the way back, re-take the screen wake lock.
 *
 * Facts this is built on:
 *   - visibilitychange to 'hidden' is the LAST event you can count on before a phone OS suspends or kills a
 *     backgrounded web app. Save there (and debounced while typing), never on unload/beforeunload: unload is
 *     unreliable on mobile, is being phased out in Chrome, and blocks the back/forward cache.
 *   - On return, assume sockets died silently (a socket killed during suspension may never fire 'close') and timers
 *     were frozen: reconnect if stale, fetch everything since the last cursor, check for an app update.
 *   - pagehide/pageshow with `persisted` mark bfcache entry and restore. Close sockets on entry, reopen on restore.
 *   - Chromium adds freeze/resume and document.wasDiscarded (the tab was discarded and reloaded).
 *   - The browser releases a screen wake lock whenever the page is hidden: request it again when visible.
 *   - A late heartbeat means the page was suspended (iOS suspends hidden web apps within seconds; Chrome throttles
 *     timers in pages hidden for more than 5 minutes).
 *
 * Browsers: visibilitychange, pagehide, pageshow everywhere (Safari 14.1+ reliable on app switch). freeze, resume,
 * wasDiscarded: Chrome 68+ only. Screen Wake Lock: Chrome/Edge 84, Safari 16.4 (iOS Home Screen apps fixed in 18.4),
 * Firefox 126. beforeunload: not on iOS Safari.
 *
 * Adapt: the handlers you pass to watchLifecycle (save, suspend, resume). The decisions (`resumePlan`, `backoffMs`,
 * `connectionState`, `wasAsleep`) are pure; headless test browsers always report 'visible', so test those and keep the
 * wiring thin.
 */

/* ------------------------------------------------------------------------------------------------- pure decisions */

export type ResumeReason = 'visible' | 'bfcache' | 'resume' | 'online' | 'woke' | 'discarded';

export interface ResumePlan {
  /** Drop and reopen live connections (or ping them with a timeout first). */
  readonly reconnect: boolean;
  /** Fetch what changed since the last cursor. */
  readonly resync: boolean;
  /** Ask the service worker registration for an update (it throttles itself, see sw-client.ts). */
  readonly checkForUpdate: boolean;
}

/** What to do when the app comes back. Short blips (under `staleMs`) only resync; long absences reconnect too. */
export function resumePlan(s: { readonly reason: ResumeReason; readonly awayMs: number; readonly online: boolean; readonly staleMs?: number }): ResumePlan {
  if (!s.online) return { reconnect: false, resync: false, checkForUpdate: false };
  const long = s.awayMs >= (s.staleMs ?? 30_000);
  const restored = s.reason === 'bfcache' || s.reason === 'discarded' || s.reason === 'online' || s.reason === 'woke';
  return { reconnect: restored || long, resync: true, checkForUpdate: long || s.reason === 'discarded' };
}

/** A heartbeat that fires much later than scheduled means the page was asleep (suspended or frozen). */
export const wasAsleep = (lastBeat: number, now: number, intervalMs: number): boolean => now - lastBeat > intervalMs * 3;

/** Reconnect delay: exponential backoff capped at 30 s, with jitter so a fleet of clients doesn't reconnect at once. */
export const backoffMs = (attempt: number, random: number = Math.random()): number => Math.min(30_000, 500 * 2 ** Math.max(0, attempt)) * (0.5 + random / 2);

/** navigator.onLine false is definitely offline; true is only "maybe", so combine it with the transport's real state. */
export type Connection = 'online' | 'reconnecting' | 'offline';
export const connectionState = (browserOnline: boolean, transportUp: boolean): Connection => (!browserOnline ? 'offline' : transportUp ? 'online' : 'reconnecting');

/* ------------------------------------------------------------------------------------------------- DOM wiring */

export interface LifecycleHandlers {
  /**
   * Persist drafts, route and scroll anchor. Runs on hidden, pagehide and freeze; may run several times in a row.
   * Keep it synchronous (start IndexedDB writes, don't await the network): iOS gives very little time after 'hidden'.
   */
  readonly save: () => void;
  /** Leaving: pause polling, publish presence 'away'; on bfcache entry (`bfcache` true) also close sockets. */
  readonly suspend?: (info: { readonly bfcache: boolean }) => void;
  /** Back: act on the plan (reconnect, resync, update check), publish presence 'online', mark the visible item read. */
  readonly resume: (plan: ResumePlan, reason: ResumeReason) => void;
  readonly staleMs?: number;
}

/** Wires the lifecycle events to the handlers. Call once at startup; returns a cleanup. */
export function watchLifecycle(h: LifecycleHandlers): () => void {
  const INTERVAL = 10_000;
  let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
  let beat = Date.now();
  // One return often fires several events (pageshow + visibilitychange, resume + visibilitychange): act once, unless
  // a later event needs more (a reconnect) than the first one planned.
  let last = { at: 0, reconnect: false };
  const back = (reason: ResumeReason) => {
    // Unfrozen or back online while still in the background: wait for the user to see it (visibilitychange).
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    const awayMs = hiddenAt === 0 ? 0 : now - hiddenAt;
    const plan = resumePlan({ reason, awayMs, online: navigator.onLine, ...(h.staleMs === undefined ? {} : { staleMs: h.staleMs }) });
    hiddenAt = 0;
    beat = now;
    if (now - last.at < 1000 && (last.reconnect || !plan.reconnect)) return;
    last = { at: now, reconnect: plan.reconnect };
    h.resume(plan, reason);
  };
  const leave = (bfcache: boolean) => {
    if (hiddenAt === 0) hiddenAt = Date.now();
    h.save();
    h.suspend?.({ bfcache });
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') leave(false);
    else back('visible');
  };
  const onPageHide = (e: PageTransitionEvent) => leave(e.persisted);
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) back('bfcache');
  };
  const onFreeze = () => h.save(); // Chromium: the page is about to be frozen
  const onResume = () => back('resume'); // Chromium: unfrozen
  const onOnline = () => back('online'); // skip the backoff wait

  const heartbeat = window.setInterval(() => {
    const now = Date.now();
    if (document.visibilityState === 'visible' && wasAsleep(beat, now, INTERVAL)) {
      hiddenAt = beat;
      back('woke');
    }
    beat = now;
  }, INTERVAL);

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('freeze', onFreeze);
  document.addEventListener('resume', onResume);
  window.addEventListener('online', onOnline);

  // Chromium discarded this tab in the background and reloaded it now: restore UI state, then resync.
  if (Reflect.get(document, 'wasDiscarded') === true) back('discarded');

  return () => {
    clearInterval(heartbeat);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('freeze', onFreeze);
    document.removeEventListener('resume', onResume);
    window.removeEventListener('online', onOnline);
  };
}

/**
 * beforeunload only while there really are unsaved changes (it is not shown on iOS, and a permanent listener hurts
 * the back/forward cache in some browsers). Call with true when an edit starts and false once it is saved.
 */
let unsavedGuard: ((e: BeforeUnloadEvent) => void) | null = null;
export function setUnsavedChanges(unsaved: boolean): void {
  if (unsaved && !unsavedGuard) {
    unsavedGuard = (e) => {
      e.preventDefault();
      // Legacy browsers (Chrome/Edge < 119) only show the prompt when returnValue is set.
      e.returnValue = true;
    };
    window.addEventListener('beforeunload', unsavedGuard);
  } else if (!unsaved && unsavedGuard) {
    window.removeEventListener('beforeunload', unsavedGuard);
    unsavedGuard = null;
  }
}

/**
 * Keeps the screen on while something on it matters (a call, a recipe, a QR code), re-taking the lock each time the
 * page becomes visible again. Failures (battery saver, policy, hidden page) are expected and silent.
 */
export function createWakeLock(): { readonly set: (on: boolean) => Promise<void>; readonly dispose: () => void } {
  let wanted = false;
  let sentinel: WakeLockSentinel | null = null;
  // One request at a time: set(true) and a visibilitychange can race, and a second lock would leak.
  let pending: Promise<void> | null = null;

  const request = async () => {
    try {
      const s = await navigator.wakeLock.request('screen');
      // Turned off (or already held) while the request was in flight: don't keep a lock nobody will release.
      if (!wanted || sentinel) {
        await s.release();
        return;
      }
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
      });
    } catch {
      /* NotAllowedError: carry on without it */
    }
  };
  const acquire = (): Promise<void> => {
    if (!('wakeLock' in navigator) || sentinel || document.visibilityState !== 'visible') return Promise.resolve();
    pending ??= request().finally(() => {
      pending = null;
    });
    return pending;
  };
  const onVisibility = () => {
    if (wanted) void acquire();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    set: async (on) => {
      wanted = on;
      if (on) await acquire();
      else {
        const s = sentinel;
        sentinel = null;
        await s?.release();
      }
    },
    dispose: () => {
      wanted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release();
      sentinel = null;
    },
  };
}

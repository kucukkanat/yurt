/**
 * haptics.ts: short taptic feedback for meaningful moments (a send, a swipe arming, a long-press opening a menu).
 *
 * Android: the Vibration API (Chrome Android 32+, Samsung Internet, Edge Android). It needs sticky user activation
 * (calls before the first tap are ignored, Chrome 60+), is blocked in cross-origin iframes, and a `true` return doesn't
 * prove anything vibrated (Firefox Android returns true and does nothing; Firefox desktop removed the API in 129).
 *
 * iPhone: Safari has never had the Vibration API. The only way to a haptic is the native switch control
 * (`<input type="checkbox" switch>`, Safari 17.4+): iOS 18+ plays a system tick when it toggles. Since iOS 26.5 only a
 * REAL finger tap on the switch or its <label> ticks; a programmatic label.click() is silent. So `addSwitchHaptic()`
 * lays an invisible label over a control: the finger's tap toggles the switch (tick) and is forwarded to the control.
 * Consequences: no haptics from timers, drags or after an await on iOS (swipe thresholds and long-press timers stay
 * silent; give them a visual cue), and this is a hack on non-standard behaviour that already changed once. Re-test on
 * every iOS release and be ready to drop it. iPads have no Taptic Engine. Sources: webkit.org/blog/15054 (switch
 * control), the ios-haptics and tappt libraries (26.5 change).
 *
 * Always: gate on an in-app setting (there is no prefers-reduced-haptics) and on prefers-reduced-motion as a proxy,
 * keep pulses 10-20 ms so they read as taps, never use vibration as the only signal, and never fire for streams of
 * incoming events. The Web Haptics proposal (navigator.playHaptics) has not shipped: don't build on it.
 *
 * Adapt: PATTERNS, and pass your settings toggle in. The decision (`shouldVibrate`) is pure and unit-testable.
 */

/** Vibration patterns (ms). Some phones clip pulses under ~10 ms. */
export const PATTERNS = {
  /** A touch that did something: send, toggle, confirm. */
  tap: [10],
  /** A gesture crossed its threshold, or a long-press opened a menu. */
  tick: [15],
  /** Something arrived for me while I'm looking: a mention. */
  notice: [12, 60, 12],
} as const satisfies Record<string, readonly number[]>;
export type Haptic = keyof typeof PATTERNS;

export interface HapticEnv {
  /** The user's in-app haptics setting. */
  readonly enabled: boolean;
  readonly canVibrate: boolean;
  readonly reducedMotion: boolean;
  /** Sticky activation (navigator.userActivation.hasBeenActive); true where the API is missing. */
  readonly hasBeenActive: boolean;
  readonly visible: boolean;
}

/** Whether to vibrate at all. */
export const shouldVibrate = (env: HapticEnv): boolean => env.enabled && env.canVibrate && !env.reducedMotion && env.hasBeenActive && env.visible;

/** Whether the iOS switch trick is the only haptic path here: a touch device without the Vibration API. */
export const switchHapticsApply = (env: { readonly canVibrate: boolean; readonly coarsePointer: boolean }): boolean => !env.canVibrate && env.coarsePointer;

/* ------------------------------------------------------------------------------------------------- DOM wiring */

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

function currentEnv(enabled: boolean): HapticEnv {
  return {
    enabled,
    canVibrate: 'vibrate' in navigator,
    reducedMotion: reducedMotion(),
    // Chrome would block and log a vibrate() before the first user activation.
    hasBeenActive: 'userActivation' in navigator ? navigator.userActivation.hasBeenActive : true,
    visible: document.visibilityState === 'visible',
  };
}

/** A short vibration (Android). True when the device accepted it, which doesn't prove it was felt. */
export function haptic(kind: Haptic, enabledInSettings: boolean): boolean {
  if (!shouldVibrate(currentEnv(enabledInSettings))) return false;
  return navigator.vibrate([...PATTERNS[kind]]);
}

/**
 * iOS haptics for one leaf control (a send button, a toggle): appends a hidden switch and a transparent <label> that
 * covers `host`, so a real tap toggles the switch (the system tick) and is forwarded to `control` as a click.
 * `host` must wrap only `control` (the label covers all of it): `<span class="haptic-host"><button>Send</button></span>`.
 * Hidden from assistive tech; keyboard users reach the real control, without a haptic. If a framework owns `host`'s
 * children, render the same markup yourself instead:
 *   <input type="checkbox" switch id="hx-send" aria-hidden="true" tabindex="-1" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">
 *   <label for="hx-send" aria-hidden="true" style="position:absolute;inset:0"></label>
 * Returns a cleanup, or null where it doesn't apply (Vibration API present, or no touch screen).
 */
export function addSwitchHaptic(host: HTMLElement, control: HTMLElement, enabled: () => boolean): (() => void) | null {
  if (!switchHapticsApply({ canVibrate: 'vibrate' in navigator, coarsePointer: matchMedia('(pointer: coarse)').matches })) {
    return null;
  }
  const id = `haptic-${Math.random().toString(36).slice(2)}`;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', ''); // WebKit's native switch; elsewhere a plain hidden checkbox
  input.id = id;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  Object.assign(input.style, { position: 'absolute', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });

  const label = document.createElement('label');
  label.htmlFor = id;
  label.setAttribute('aria-hidden', 'true');
  Object.assign(label.style, { position: 'absolute', inset: '0' });

  const onClick = (e: MouseEvent) => {
    // Haptics off: cancel the label's activation so the switch doesn't toggle (no tick), but still run the action.
    if (!enabled() || reducedMotion()) e.preventDefault();
    e.stopPropagation(); // the forwarded click below is the one the page should see
    control.click();
  };
  label.addEventListener('click', onClick);
  // The label's activation also dispatches a click on the switch, which bubbles: keep it from reaching the page too.
  const swallow = (e: Event) => e.stopPropagation();
  input.addEventListener('click', swallow);

  const restorePosition = getComputedStyle(host).position === 'static' ? host.style.position : null;
  if (restorePosition !== null) host.style.position = 'relative';
  host.append(input, label);
  return () => {
    label.removeEventListener('click', onClick);
    input.removeEventListener('click', swallow);
    input.remove();
    label.remove();
    if (restorePosition !== null) host.style.position = restorePosition;
  };
}

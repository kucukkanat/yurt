import { useApp } from '../store';

/** Vibration patterns (ms), short enough to feel like taps rather than buzzes. */
const PATTERNS = {
  /** A touch that did something: sending a message. */
  tap: [8],
  /** A gesture crossed its threshold, or a long-press opened a menu. */
  tick: [14],
  /** Something arrived for me while I'm looking: an @mention or a DM. */
  notice: [12, 60, 12],
} as const;
export type Haptic = keyof typeof PATTERNS;

/**
 * A short vibration, when this device can (Android browsers; iOS has no vibration API), the user hasn't turned
 * haptics off, and hasn't asked for reduced motion. True when the device accepted it.
 */
export function haptic(kind: Haptic): boolean {
  if (!useApp.getState().settings.haptics || !('vibrate' in navigator) || matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return navigator.vibrate([...PATTERNS[kind]]);
}

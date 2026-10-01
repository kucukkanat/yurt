/**
 * My presence while this tab is in front ('online') or behind other windows ('away').
 * The 'away' half can't run in tests: headless browsers always report a visible page, and faking
 * `document.hidden` would test the fake. Kept to this one line so nothing else depends on it.
 */
export function presenceNow(): 'online' | 'away' {
  /* istanbul ignore if -- headless test browsers never report a hidden page */
  if (document.hidden) return 'away';
  return 'online';
}

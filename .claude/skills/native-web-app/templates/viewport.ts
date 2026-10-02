/**
 * viewport.ts: fit the app shell to the space above the on-screen keyboard.
 *
 * Three platform behaviours:
 *   - Android (Chrome 108+, Firefox 133+, Samsung 21+) with `interactive-widget=resizes-content` in the viewport meta
 *     (head.html) shrinks the layout itself. No JS needed; this module stays inert there.
 *   - iOS/iPadOS (every iOS browser is WebKit, none support interactive-widget as of Safari 27) keeps the layout and
 *     pans the visual viewport over it, so a bottom composer hides under the keyboard. `track()` sizes the shell to the
 *     visible height and moves it to where iOS panned, but ONLY while a keyboard is up; otherwise CSS 100% stands (in
 *     an installed iOS app the visual viewport can be one status bar shorter than the layout while 100% is right).
 *   - Chromium's VirtualKeyboard API (Chrome/Edge 94+ on Android and touch Windows/ChromeOS, not Safari/Firefox) is an
 *     opt-in alternative: the keyboard overlays the page and we size the shell from its rectangle, which lets you
 *     animate with the keyboard or swap it for an emoji panel. Pass `{ overlayKeyboard: true }` to use it.
 *
 * CSS contract (native.css): `body { height: var(--app-height, 100%); transform: translateY(var(--app-top, 0px)); }`,
 * bottom bars use `var(--safe-bottom)`, and the scrolling pane carries `data-scroll-root`. While a keyboard is up the
 * root also gets `data-keyboard` (hide the tab bar with `[data-keyboard] .app-tabbar { display: none }` if you like).
 *
 * Adapt: KEYBOARD_MIN if your browser chrome is unusually tall; the field selector in FIELD.
 * Pure parts (`varsFor`, `varsForKeyboard`, `revealDelta`) are unit-testable without a browser. Call `track()` once at
 * startup; it returns a cleanup.
 */

/** Taller than any browser bar that comes and goes, shorter than any on-screen keyboard (px). */
export const KEYBOARD_MIN = 120;

/** Focusable text fields whose visibility we keep while the keyboard is up. */
const FIELD =
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"], [type="file"], [type="image"], [type="hidden"]), textarea, select, [contenteditable]:not([contenteditable="false"])';

export type ViewportVar = '--app-height' | '--app-top' | '--safe-bottom';
/** CSS custom properties to set on <html>; null removes the property so the stylesheet default applies. */
export type ViewportVars = Readonly<Record<ViewportVar, string | null>>;

const CLEARED: ViewportVars = { '--app-height': null, '--app-top': null, '--safe-bottom': null };

/** What the visual viewport reports: the visible height, the pinch-zoom scale, and its top in page coordinates. */
export interface VisibleViewport {
  readonly height: number;
  readonly scale: number;
  readonly pageTop: number;
}

/**
 * The shell variables for a layout of `layoutHeight` px and the current visual viewport (iOS path).
 * Heights are multiplied by the scale so pinch zoom never shrinks the app, and a zoomed page isn't moved while the
 * user pans. With no keyboard (or a layout that already resized for it, Android) everything is cleared.
 */
export function varsFor(layoutHeight: number, vv: VisibleViewport): ViewportVars {
  const visible = vv.height * vv.scale;
  if (layoutHeight - visible < KEYBOARD_MIN) return CLEARED;
  return {
    '--app-height': `${visible}px`,
    '--app-top': `${vv.scale === 1 ? vv.pageTop : 0}px`,
    // The keyboard covers the home indicator, so its inset would only add a gap above the keyboard.
    '--safe-bottom': '0px',
  };
}

/** The shell variables when the keyboard overlays the page (VirtualKeyboard API path): the layout minus the keyboard. */
export function varsForKeyboard(layoutHeight: number, keyboardHeight: number): ViewportVars {
  if (keyboardHeight < KEYBOARD_MIN) return CLEARED;
  return { '--app-height': `${Math.max(0, layoutHeight - keyboardHeight)}px`, '--app-top': '0px', '--safe-bottom': '0px' };
}

export const keyboardUp = (vars: ViewportVars): boolean => vars['--app-height'] !== null;

/**
 * How far to scroll a pane (positive = down) so `field` is visible inside it with `pad` px to spare; 0 if it already is.
 * Scrolling only the pane, never the document, keeps the locked shell from jumping ("the app moved up and stayed").
 */
export function revealDelta(field: { readonly top: number; readonly bottom: number }, pane: { readonly top: number; readonly bottom: number }, pad = 12): number {
  if (field.top < pane.top + pad) return field.top - (pane.top + pad);
  if (field.bottom > pane.bottom - pad) return field.bottom - (pane.bottom - pad);
  return 0;
}

/* ------------------------------------------------------------------------------------------------- DOM wiring */

/** Chromium's VirtualKeyboard, typed locally (not in TypeScript's lib.dom) and only used after a runtime check. */
interface VirtualKeyboardLike extends EventTarget {
  overlaysContent: boolean;
  readonly boundingRect: DOMRectReadOnly;
}

function isVirtualKeyboard(v: unknown): v is VirtualKeyboardLike {
  return v instanceof EventTarget && 'overlaysContent' in v && typeof v.overlaysContent === 'boolean' && 'boundingRect' in v && v.boundingRect instanceof DOMRectReadOnly;
}

function virtualKeyboard(): VirtualKeyboardLike | null {
  const vk: unknown = Reflect.get(navigator, 'virtualKeyboard');
  return isVirtualKeyboard(vk) ? vk : null;
}

export interface TrackOptions {
  /** Use the VirtualKeyboard API where it exists (Chromium) instead of letting the browser resize the layout. */
  readonly overlayKeyboard?: boolean;
  /** Told when the keyboard comes up or goes down. */
  readonly onKeyboard?: (up: boolean) => void;
}

/** Keeps the shell fitted to the space above the keyboard. Returns a cleanup that removes listeners and variables. */
export function track(options: TrackOptions = {}): () => void {
  const root = document.documentElement;
  let wasUp = false;

  const apply = (vars: ViewportVars): void => {
    for (const [name, value] of Object.entries(vars)) {
      if (value === null) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
    const up = keyboardUp(vars);
    root.toggleAttribute('data-keyboard', up);
    if (up !== wasUp) {
      wasUp = up;
      options.onKeyboard?.(up);
    }
    if (up) requestAnimationFrame(revealFocusedField);
  };

  const vk = options.overlayKeyboard === true ? virtualKeyboard() : null;
  if (vk) {
    // Scripted twin of interactive-widget=overlays-content: nothing resizes, we lay out around the keyboard.
    vk.overlaysContent = true;
    const onGeometry = () => apply(varsForKeyboard(root.clientHeight, vk.boundingRect.height));
    vk.addEventListener('geometrychange', onGeometry);
    return () => {
      vk.removeEventListener('geometrychange', onGeometry);
      vk.overlaysContent = false;
      apply(CLEARED);
    };
  }

  const vv = window.visualViewport;
  if (!vv) return () => {}; // very old engines: CSS alone

  // iOS fires resize once at the end of the keyboard animation, and scrolls the layout viewport even with
  // overflow: hidden, so follow both resize and scroll. pageTop (not offsetTop) includes that scroll.
  const onChange = () => apply(varsFor(root.clientHeight, vv));
  // iOS sometimes leaves a locked page panned after the keyboard closes (and iOS 26.0 kept a stale offsetTop):
  // re-sync, and scroll the never-scrolling document back to the top.
  const onFocusOut = () =>
    requestAnimationFrame(() => {
      if (window.scrollY !== 0 && !document.activeElement?.matches(FIELD)) window.scrollTo(0, 0);
      onChange();
    });
  vv.addEventListener('resize', onChange);
  vv.addEventListener('scroll', onChange);
  document.addEventListener('focusout', onFocusOut);
  onChange();
  return () => {
    vv.removeEventListener('resize', onChange);
    vv.removeEventListener('scroll', onChange);
    document.removeEventListener('focusout', onFocusOut);
    apply(CLEARED);
  };
}

/** Scrolls the focused field's pane (marked data-scroll-root) so the field sits above the keyboard. */
function revealFocusedField(): void {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !field.matches(FIELD)) return;
  const pane = field.closest<HTMLElement>('[data-scroll-root]');
  if (!pane) return;
  const delta = revealDelta(field.getBoundingClientRect(), pane.getBoundingClientRect());
  if (delta !== 0) pane.scrollTop += delta;
}

/**
 * Focus a field from code (a "Reply" button, a roving tabindex) without the browser scrolling the locked document.
 * Call it synchronously inside the tap handler: iOS opens the keyboard only for focus() within a user gesture.
 */
export function focusWithoutJump(field: HTMLElement): void {
  field.focus({ preventScroll: true });
  revealFocusedField();
}

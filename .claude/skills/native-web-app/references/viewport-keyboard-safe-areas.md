# Viewport, keyboard, safe areas and scrolling

How an app-like page fills the screen: viewport meta, zoom, viewport units, a locked shell, safe areas, the on-screen keyboard per platform, and lists that scroll like native ones.
Support as of Oct 2026 (MDN browser-compat-data 8.1.4: Chrome 154, Safari 27, Firefox 157). Drop-in code: [`../templates/head.html`](../templates/head.html), [`../templates/native.css`](../templates/native.css), [`../templates/viewport.ts`](../templates/viewport.ts). TS compiles under `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

## Checklist

- [ ] **must** — Ship one viewport meta with `viewport-fit=cover, interactive-widget=resizes-content` → [Viewport meta](#viewport-meta-baseline-for-app-like-pages)
- [ ] **must** — Never block pinch-zoom (`maximum-scale`, `user-scalable=no`) → [Zoom](#never-disable-zoom-no-maximum-scale--user-scalableno)
- [ ] **must** — Give fields 16px on coarse pointers so iOS never zooms on focus → [16px fields](#stop-ios-focus-zoom-16px-form-fields-on-coarse-pointers-only)
- [ ] **must** — Replace `100vh` with `svh`/`dvh` or a `100%` chain → [Viewport units](#dynamic-viewport-units-svh--lvh--dvh-and-the-100vh-bug)
- [ ] **must** — Lock the document; bars are grid rows, panes scroll → [Locked shell](#locked-app-shell-with-in-flow-bars-and-inner-scroll-containers)
- [ ] **must** — Pad chrome with `--safe-*` tokens from `env(safe-area-inset-*, 0px)` → [Safe areas](#safe-area-tokens-envsafe-area-inset--with-fallbacks-and-max)
- [ ] **must** — Handle every keyboard model: resize, overlay, iOS pan → [Keyboard models](#know-the-three-keyboard-resize-behaviors-per-platform)
- [ ] **must** — On iOS, fit the shell to the visual viewport only while a keyboard is up → [iOS keyboard](#ios-keyboard-size-and-move-the-shell-to-the-visual-viewport-only-while-a-keyboard-is-up)
- [ ] **must** — `overscroll-behavior: none` on the root, `contain` on scrollers → [Overscroll](#overscroll-behavior-no-page-rubber-band-no-accidental-pull-to-refresh-no-scroll-chaining)
- [ ] **should** — Set `text-size-adjust: 100%` → [Text inflation](#text-size-adjust-100-no-landscapefont-boosting-inflation)
- [ ] **should** — Pad fixed bottom bars with `safe-area-max-inset-bottom` → [Edge-to-edge](#android-edge-to-edge-safe-area-max-inset--for-stable-bottom-bars)
- [ ] **should** — Avoid fixed bottom bars on iOS, or lift them above the keyboard → [Fixed vs keyboard](#positionfixed--sticky-with-the-ios-keyboard-and-the-ios-26-regressions)
- [ ] **should** — Reveal a focused field by scrolling only its pane → [Focused field](#keep-the-focused-field-visible-without-moving-the-locked-shell)
- [ ] **should** — Grow the composer with `field-sizing: content` → [Composer](#auto-growing-composer-with-field-sizing-content)
- [ ] **should** — Open chat lists at the newest message and keep them pinned → [Chat lists](#chattimeline-lists-that-open-and-stay-at-the-bottom-column-reverse-wrapper)
- [ ] **should** — Rely on scroll anchoring; compensate only where it's missing → [Anchoring](#scroll-anchoring-overflow-anchor-now-in-every-engine)
- [ ] **should** — Lock background scroll under dialogs in CSS → [Scroll lock](#scroll-lock-under-modals-and-sheets-in-css)
- [ ] **should** — Build pagers on scroll snap + `scrollend` → [Pagers](#scroll-snap-pagers-and-carousels-with-scrollend)
- [ ] **should** — Stable gutters, thin themed scrollbars, none on strips → [Scrollbars](#desktop-scrollbars-stable-gutter-thin-themed-bars-hidden-on-strips)
- [ ] **should** — Stop sideways wobble (`overflow-x: clip`, `min-width: 0`) → [No wobble](#no-sideways-wobble-overflow-x-clip-and-min-width-0)
- [ ] **should** — Reflow on rotation; never lock it for normal screens → [Orientation](#orientation-changes-respond-dont-lock)
- [ ] **should** — Size components with container queries → [Containers](#container-queries-for-components-that-adapt-to-their-pane)
- [ ] **should** — List-detail split view from ~768px, by width → [Split view](#large-screens-list-detail-split-view-by-width-not-device)
- [ ] **should** — Pick the iOS status bar style and pad for it → [Status bar](#ios-home-screen-status-bar-defaultblack-vs-black-translucent)
- [ ] **should** — Give Safari 26+ an opaque edge element to tint from → [Toolbar tint](#safari-26-toolbar-tinting-and-full-screen-dims-come-from-edge-hugging-fixedsticky-elements)
- [ ] **nice** — Lay out around the keyboard with the VirtualKeyboard API → [VirtualKeyboard](#virtualkeyboard-api-chromium-overlayscontent-geometrychange-keyboard-inset-)
- [ ] **nice** — Delete obsolete iOS scroll/height hacks → [Obsolete hacks](#delete-obsolete-ios-scrollingheight-hacks)
- [ ] **nice** — Sticky section headers with `scroll-padding` and a stuck style → [Sticky headers](#sticky-section-headers-with-scroll-padding-and-a-stuck-state)
- [ ] **nice** — Put panes on either side of a fold → [Segments](#foldables-viewport-segments-api-dual-pane-across-the-hinge)
- [ ] **nice** — Tabletop layout on half-folded devices → [Posture](#device-posture-api-folded-vs-continuous)

**Owned by other files:**
- `touch-action: manipulation` on the root (no double-tap zoom, pinch kept); custom pull-to-refresh → [touch-gestures-input.md](touch-gestures-input.md).
- Collapsing large titles and hide-on-scroll bars (`animation-timeline: scroll()`, `@container scroll-state(scrolled)`); `content-visibility: auto` for long lists → [motion-performance.md](motion-performance.md).
- Per-screen scroll restoration for inner scrollers (Navigation API, `history.scrollRestoration = 'manual'`) and OS text size (`<meta name="text-scale">`, iOS Dynamic Type) → [navigation-ui-patterns.md](navigation-ui-patterns.md); restoring after a relaunch → [offline-push-storage.md](offline-push-storage.md).
- Window Controls Overlay (`env(titlebar-area-*)`) → [install-and-identity.md](install-and-identity.md#window-controls-overlay); the status-bar and `theme-color` tags → [install-and-identity.md](install-and-identity.md#apple-meta-tags).
- `screen.orientation.lock()` → [device-apis.md](device-apis.md). Device and Playwright testing → [platform-quirks-testing.md](platform-quirks-testing.md).

## Viewport meta baseline for app-like pages

One meta turns off the 980px virtual viewport, draws edge to edge, and makes Android shrink the layout for the keyboard. Without it the page renders zoomed out or letterboxed around the notch, and a bottom composer vanishes under the keyboard.

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<!-- viewport-fit=cover: draw under notch / home indicator / Android gesture bar; env(safe-area-inset-*) become
       non-zero, so you MUST pad with them.
     interactive-widget=resizes-content: Android shrinks the layout viewport (vh, dvh, %) for the keyboard. -->
```

**Support:** desktop browsers ignore the meta. `viewport-fit`: Safari iOS 11+ (tab and home-screen app), Chrome Android 135+, Firefox Android 79+. `interactive-widget`: Chrome Android 108+, Samsung 21+, Firefox Android 133+; no iOS browser (tab or home-screen app) as of Safari 27 — WebKit landed it in Aug 2026, unshipped in Safari and Technology Preview as of mid-Sept.

**Gotchas:**
- Unknown keys are ignored, so the tag is safe on iOS; iOS still needs the [visualViewport fix](#ios-keyboard-size-and-move-the-shell-to-the-visual-viewport-only-while-a-keyboard-is-up).
- Chrome Android 108+ and Firefox Android 132+ default to `resizes-visual`: set `resizes-content` explicitly.
- With `resizes-content` every viewport unit shrinks with the Android keyboard, and each show/hide relayouts.
- `overlays-content` only if you lay out around the keyboard yourself ([VirtualKeyboard](#virtualkeyboard-api-chromium-overlayscontent-geometrychange-keyboard-inset-)).
- Never add `maximum-scale`, `minimum-scale`, `user-scalable` or `height=device-height`.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport · https://developer.chrome.com/blog/viewport-resize-behavior · https://www.bram.us/2026/09/11/webkit-supports-interactive-widget-and-hopefully-safari-will-too/

## Never disable zoom (no maximum-scale / user-scalable=no)

Keep pinch-zoom (WCAG 1.4.4, axe) and fix what people block it for with targeted CSS.

```html
<!-- NEVER: axe 'meta-viewport' (critical) fails maximum-scale < 2 or user-scalable=no;
     'meta-viewport-large' flags maximum-scale < 5 -->
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
```

```css
/* Instead, with the baseline meta: */
html { touch-action: manipulation; } /* no double-tap zoom; pinch stays */
@media (pointer: coarse) {
  input, textarea, select, [contenteditable] { font-size: max(16px, 1rem) !important; } /* no focus zoom */
}
```

**Support:** iOS 10+ ignores both for user pinch, but `maximum-scale=1` still suppresses focus zoom — the trap, because it looks like a fix on iPhone. Chrome, Samsung and Firefox on Android honour them, so pinch really is blocked there.

**Gotchas:**
- Field-tested: code that sizes the app from `visualViewport` must multiply heights by `visualViewport.scale`, or pinch-zoom shrinks the layout.
- Run axe on every E2E page so a meta regression fails CI ([platform-quirks-testing.md](platform-quirks-testing.md)).

**Sources:** https://github.com/dequelabs/axe-core/blob/develop/lib/checks/mobile/meta-viewport.json

## Stop iOS focus-zoom: 16px form fields on coarse pointers only

iOS zooms into a focused field whose computed font-size is under 16px and stays zoomed after blur — a top "this is a website" tell. Force 16px on touch-first devices, keep compact sizes on desktop.

```css
@media (pointer: coarse) {
  /* !important: component styles set 13-14px and iOS checks the computed size; 1rem keeps user text scaling */
  input, textarea, select, [contenteditable] { font-size: max(16px, 1rem) !important; }
}
```

**Support:** the zoom happens in every iOS/iPadOS browser, tab and home-screen app; Chromium, Safari macOS and Firefox don't zoom. `(pointer: coarse)`: Chrome 41, Safari 9, Firefox 64.

**Gotchas:**
- Include `contenteditable` editors and header search fields.
- iPad with a trackpad still reports a coarse primary pointer, so the rule stays on (correct: iPadOS zooms too).
- No `transform: scale()` tricks, no `maximum-scale=1`.
- Field-tested: 16px raises the line box; recheck composer and toolbar heights.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/pointer

## text-size-adjust: 100% (no landscape/font-boosting inflation)

iOS enlarges text on rotation to landscape and Android "font boosting" inflates some blocks; native text never jumps.

```css
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; } /* prefix: iOS Safari, Firefox Android */
```

**Support:** Chrome/Edge/Samsung 54+ unprefixed; Safari iOS and Firefox Android (49+) `-webkit-` only; Safari macOS and Firefox desktop: no-op. Experimental in BCD.

**Gotchas:**
- Use `100%`, not `none` (`none` has broken user text zoom in some browsers). OS accessibility text scaling still works.
- `<meta name="text-scale">` (Chrome 146+) disables autosizing anyway.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-size-adjust

## Dynamic viewport units (svh / lvh / dvh) and the 100vh bug

Mobile `100vh` is the large viewport (bars retracted), so it overflows while browser bars show: hidden bottom buttons, jumping heroes. `svh` = bars shown, `lvh` = bars hidden, `dvh` = current.

```css
.hero     { min-height: 100vh; min-height: 100svh; } /* visible on first paint, never jumps */
.sheet    { max-height: 90vh;  max-height: 90svh; }  /* sheets and modals always fit */
.bg-layer { position: fixed; inset: 0; }             /* or 100lvh: no gap as bars retract */
.shell    { height: 100vh;     height: 100dvh; }     /* only where the document doesn't scroll */
html, body { height: 100%; }                         /* locked shell: a 100% chain is the safest default */
```

**Support:** Chrome/Edge/Chrome Android 108, Safari 15.4 (macOS, iOS tab and home-screen app), Firefox 101, Samsung 21. Installed apps have no bars: sv = lv = dv.

**Gotchas:**
- `dvh` changes while toolbars collapse during document scroll (relayout, shifts): size scrolling content with `svh`.
- No unit follows the iOS keyboard; on Android with `resizes-content` all of them shrink with it.
- Field-tested: in an installed iOS app the visual viewport can be a status bar shorter than the layout (797 vs 844 px) while `100%` is exact. Default to `100%`; override only while a keyboard is up.
- Safari 26.0 left a bottom gap under viewport-sized fixed containers; 26.1 fixed it.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length · https://webkit.org/blog/17541/webkit-features-for-safari-26-1/

## Locked app shell with in-flow bars and inner scroll containers

The document never scrolls; header, tab bar and composer are grid rows (not `position: fixed`) and each pane scrolls itself. Like native: chrome stays put, no page rubber-band, no address-bar jumps, no fixed-bar jitter, and the keyboard becomes "resize one box".

```html
<body>
  <div class="app">
    <header class="app-header">…</header>
    <main class="app-scroll" data-scroll-root>…</main>
    <nav class="app-footer">…</nav>
  </div>
</body>
```

```css
html { height: 100%; }
body { height: var(--app-height, 100%); margin: 0; overflow: hidden; overscroll-behavior: none; }
.app {
  height: 100%; display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto; /* plain 1fr = minmax(auto, 1fr): grows, never scrolls */
  padding-left: var(--safe-left); padding-right: var(--safe-right);
}
.app-header { padding-top: var(--safe-top); }  /* bar backgrounds bleed to the edge */
.app-footer { padding-bottom: max(8px, var(--safe-bottom)); }
.app-scroll { overflow-y: auto; overscroll-behavior-y: contain; } /* flex: flex: 1; min-height: 0 */
```

**Support:** all engines. iOS honours body `overflow: hidden` for touch since WebKit bug 153852 (2019).

**Gotchas:**
- Trade-off: in a tab the browser toolbar never minimizes, iOS tap-status-bar-to-top only scrolls the document, Chrome Android pull-to-refresh only acts on the document. Content sites should keep document scrolling with `100svh` screens.
- `overflow: hidden` doesn't stop *programmatic* scrolling of html/body (`scrollIntoView`, `focus()`, anchors) → [Focused field](#keep-the-focused-field-visible-without-moving-the-locked-shell).
- Browsers restore only document scroll on back/forward; inner scrollers need per-entry restore ([navigation-ui-patterns.md](navigation-ui-patterns.md)).

**Sources:** https://bugs.webkit.org/show_bug.cgi?id=153852 · https://web.dev/learn/pwa/app-design

## Safe-area tokens: env(safe-area-inset-*) with fallbacks and max()

Expose the insets as overridable custom properties, pad content with `max(design padding, inset)`, let backgrounds bleed. Content clears the notch, Dynamic Island, home indicator and landscape cutouts while bars reach the edge.

```css
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
}
.app-header { padding-top: max(12px, var(--safe-top)); }
.row { padding-left: max(16px, var(--safe-left)); padding-right: max(16px, var(--safe-right)); } /* landscape notch */
.fab { position: fixed; right: calc(16px + var(--safe-right)); bottom: calc(16px + var(--safe-bottom)); }
.composer { padding-bottom: max(0px, 10px - var(--safe-bottom)); } /* parent already pads --safe-bottom */
```

**Support:** `env()`: Chrome 69, Safari 11.1 / iOS 11.3, Firefox 65. Non-zero only with `viewport-fit=cover` (Safari iOS tab and home-screen app, Chrome Android 135+, Firefox Android); 0 on desktop.

**Gotchas:**
- Physical left/right, not `padding-inline`: the cutout side follows landscape direction, not text direction.
- `env()` isn't allowed in media queries; always pass a `0px` fallback so `calc()`/`max()` stay valid.
- Values differ between a Safari tab and the installed app and move with toolbars: test both.
- Field-tested: set `--safe-bottom: 0px` while the iOS keyboard covers the home indicator, or a gap shows above the keyboard.
- Installed iOS app with `black-translucent`: `--safe-top` is the status bar height.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env · https://polypane.app/blog/using-safe-area-inset-to-build-mobile-safe-layouts/

## Android edge-to-edge: safe-area-max-inset-* for stable bottom bars

From Chrome 135 on Android, `viewport-fit=cover` pages draw behind the gesture bar once Chrome's bottom "chin" retracts, so `safe-area-inset-bottom` changes while scrolling; `safe-area-max-inset-bottom` is constant. Fixed bottom bars stop jittering and never sit under the gesture handle.

```css
.bottom-cta {
  position: fixed; left: 0; right: 0; bottom: 0;
  padding-bottom: calc(12px + env(safe-area-max-inset-bottom, env(safe-area-inset-bottom, 0px)));
}
```

**Support:** Chrome Android 135+ only (Chromium docs); Safari and Firefox fall back to the second argument. No BCD or MDN entry yet.

**Gotchas:**
- The 135 rollout targeted phones with gesture navigation; 3-button navigation and tablets kept the old bar.
- A locked shell rarely retracts the chin (no document scroll); test with gesture navigation anyway.

**Sources:** https://developer.chrome.com/docs/css-ui/edge-to-edge · https://developer.chrome.com/blog/edge-to-edge

## Know the three keyboard resize behaviors per platform

Every "keyboard covers my input / composer floats mid-screen / page jumped" bug comes from assuming one model.

| Behaviour | What resizes | Who |
|---|---|---|
| `resizes-visual` (default) | Visual viewport only; layout, `vh` and fixed elements get covered. iOS also pans to the field | Every iOS browser, Chrome Android 108+, Firefox Android 132+, ChromeOS, Windows |
| `resizes-content` | Visual + layout viewport; fixed bottom bars move up | Android, via `interactive-widget` |
| `overlays-content` | Nothing; you lay out around it | `interactive-widget` or VirtualKeyboard API (Chromium) |

Setup: Android → `resizes-content` (no JS); iOS → [visualViewport shell](#ios-keyboard-size-and-move-the-shell-to-the-visual-viewport-only-while-a-keyboard-is-up); bottom UI in flow, never fixed.

```ts
const KEYBOARD_MIN = 120; // px: taller than any browser bar that comes and goes, shorter than any keyboard

/** True while a keyboard covers the bottom of a layout that did NOT resize for it. */
export function keyboardCoversLayout(): boolean {
  const vv = window.visualViewport;
  return vv !== null && document.documentElement.clientHeight - vv.height * vv.scale > KEYBOARD_MIN;
}
```

**Support:** `visualViewport`: Chrome 61, Safari 13, Firefox 91 (Android 68).

**Gotchas:**
- No "keyboard opened" event: `visualViewport` `resize` is the signal. iOS fires it once at the end of the animation, so layout snaps; only Chromium's `geometrychange` can follow it.
- `focusin` fires before the keyboard is up: don't measure then.
- iPad floating/split and hardware keyboards barely shrink the viewport; the threshold treats them as none (right).
- Returns false on Android with `resizes-content` (the layout already fits).
- `focus()` from code opens the iOS keyboard only inside a user gesture. Keyboard kind (`inputmode`, `enterkeyhint`) → [touch-gestures-input.md](touch-gestures-input.md).

**Sources:** https://developer.chrome.com/blog/viewport-resize-behavior · https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport

## iOS keyboard: size and move the shell to the visual viewport, only while a keyboard is up

iOS pans over a layout that doesn't resize. Drive `--app-height` (visible height × scale), `--app-top` (where iOS panned to) and `--safe-bottom: 0` from `visualViewport`, but only while the covered height exceeds a keyboard threshold; otherwise clear them so CSS `100%` stands. The composer then sits on the keyboard with the header visible, like native chat. Full version (focus reveal, VirtualKeyboard path): [`../templates/viewport.ts`](../templates/viewport.ts).

```ts
export const KEYBOARD_MIN = 120;
type Visible = { readonly height: number; readonly scale: number; readonly pageTop: number };
type ShellVars = Record<'--app-height' | '--app-top' | '--safe-bottom', string | null>;

/** Pure: unit-test with plain numbers. */
export function viewportVars(layoutHeight: number, vv: Visible): ShellVars {
  const height = vv.height * vv.scale; // × scale: pinch-zoom must not shrink the app
  if (layoutHeight - height < KEYBOARD_MIN) return { '--app-height': null, '--app-top': null, '--safe-bottom': null };
  // while zoomed the user is panning, not iOS; the keyboard covers the home indicator
  return { '--app-height': `${height}px`, '--app-top': `${vv.scale === 1 ? vv.pageTop : 0}px`, '--safe-bottom': '0px' };
}

export function trackViewport(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  const update = (): void => {
    for (const [name, value] of Object.entries(viewportVars(root.clientHeight, vv))) {
      if (value === null) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update); // iOS pans the layout viewport even with overflow: hidden
  update();
  return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
}
// viewportVars(844, { height: 508, scale: 1, pageTop: 336 }) → '508px', '336px', '0px'  (keyboard up)
// viewportVars(844, { height: 797, scale: 1, pageTop: 0 })   → all null                 (standalone status bar)
```

```css
html { height: 100%; }
body {
  height: var(--app-height, 100%); margin: 0; overflow: hidden; overscroll-behavior: none;
  transform: translateY(var(--app-top, 0px)); /* a transform, so position: fixed overlays move with the app */
}
```

**Support:** needed in every iOS/iPadOS browser, tab and home-screen app. Inert on Android with `resizes-content` (difference stays under the threshold) and on desktop. `visualViewport.pageTop`: Safari 13+.

**Gotchas:**
- Field-tested: don't set `--app-height` from `visualViewport` all the time; an installed iOS app's visual viewport can be a status bar short (797 vs 844), leaving a band.
- Use `pageTop` (scroll + `offsetTop`), not `offsetTop`, and listen to `scroll` too.
- The body transform makes body the containing block for fixed descendants (intended) and a stacking context.
- Top-layer elements (modal `<dialog>`, `popover`) render as siblings of the root, so the transform doesn't move them: a sheet with a field needs its own placement from `--app-top`/`--app-height` (from the spec; verify on a device).
- iOS 26.0 sometimes kept a stale `offsetTop` after the keyboard closed: re-sync on `focusout` ([next](#positionfixed--sticky-with-the-ios-keyboard-and-the-ios-26-regressions)).
- When Safari ships `interactive-widget`, the threshold check makes this inert by itself.
- With Vite/React: call `trackViewport()` once in the root's `useEffect` and return its cleanup.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport · https://developer.apple.com/forums/thread/800154

## position:fixed / sticky with the iOS keyboard (and the iOS 26 regressions)

iOS lays out fixed elements against the layout viewport, which ignores the keyboard: fixed bottom bars hide under it, float mid-page while it pans, or stay offset after it closes. Best: no fixed bottom UI, in-flow rows in a [locked shell](#locked-app-shell-with-in-flow-bars-and-inner-scroll-containers).

```ts
/** Document-scroll pages that must keep a fixed bottom bar: lift it above the visible bottom. */
export function liftAboveKeyboard(bar: HTMLElement): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const place = (): void => {
    const hidden = window.innerHeight - (vv.offsetTop + vv.height); // layout px below the visible area
    bar.style.transform = `translateY(${-Math.max(0, hidden)}px)`;
  };
  vv.addEventListener('resize', place);
  vv.addEventListener('scroll', place);
  place();
}

// Locked pages (document never scrolls) can stay panned after the iOS keyboard closes.
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
document.addEventListener('focusout', () => requestAnimationFrame(() => {
  if (window.scrollY !== 0 && !document.activeElement?.matches(FIELD)) window.scrollTo(0, 0);
}));
```

**Support:** the problem: every iOS browser. Safari 26 (Liquid Glass) added fixed/sticky misplacement reports; 26.1 fixed the bottom gap. Android with `resizes-content` lifts fixed bars by itself.

**Gotchas:**
- The `innerHeight − (offsetTop + height)` formula is community practice whose meaning shifted across iOS releases: verify on a device.
- The `activeElement` check skips the reset when focus moves to another field.
- In iOS 26 Safari tabs `bottom: 0` sits relative to the area under the floating toolbar; in-flow bars in a `100%` shell avoid it.

**Sources:** https://developer.apple.com/forums/thread/800125 · https://webkit.org/blog/17541/webkit-features-for-safari-26-1/

## VirtualKeyboard API (Chromium): overlaysContent, geometrychange, keyboard-inset-*

Opt out of the browser's keyboard resizing and lay out around the keyboard in CSS (`env(keyboard-inset-*)`) or JS (`boundingRect`, `geometrychange`): a keyboard-height grid row, an emoji panel that swaps with the keyboard, dual-screen devices.

```ts
interface VirtualKeyboardLike extends EventTarget {
  overlaysContent: boolean;
  readonly boundingRect: DOMRectReadOnly;
  show(): void;
  hide(): void;
}
const nav: Navigator & { readonly virtualKeyboard?: VirtualKeyboardLike } = navigator; // not in lib.dom; no cast
const vk = nav.virtualKeyboard;
if (vk) {
  vk.overlaysContent = true; // the viewport stops resizing; env(keyboard-inset-*) become non-zero
  vk.addEventListener('geometrychange', () =>
    document.documentElement.toggleAttribute('data-keyboard', vk.boundingRect.height > 0));
}
```

```css
.app { grid-template-rows: auto minmax(0, 1fr) auto env(keyboard-inset-height, 0px); }
```

```html
<div contenteditable virtualkeyboardpolicy="manual"></div> <!-- keyboard only on navigator.virtualKeyboard.show() -->
```

**Support:** Chrome/Edge 94+ on Android and touch ChromeOS/Windows, Samsung 17, WebView 94. No Safari, no Firefox. Experimental, secure contexts.

**Gotchas:**
- `overlaysContent = true` is the scripted `overlays-content`: insets become non-zero, and the browser stops keeping the focused field visible (use `scroll-padding-bottom: env(keyboard-inset-height, 0px)` or [reveal it](#keep-the-focused-field-visible-without-moving-the-locked-shell)).
- Spec: `show()` needs sticky user activation, a focused form control or editing host with `virtualkeyboardpolicy="manual"`, and `inputmode` other than `none`; on Windows a touch or pen pointer.
- Keep the iOS `visualViewport` path.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API · https://www.w3.org/TR/virtual-keyboard/

## Keep the focused field visible without moving the locked shell

`scrollIntoView()` and `focus()` also scroll html/body and `overflow: hidden` ancestors, which shifts the whole shell ("the app jumped up and stayed"). After the keyboard resize, scroll only the pane; focus from code with `preventScroll`; give scrollers `scroll-padding` for sticky bars.

```ts
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Scrolls `scroller` only, never the document, so `el` is visible with `pad` px to spare. */
export function reveal(el: Element, scroller: HTMLElement, pad = 12): void {
  const e = el.getBoundingClientRect();
  const s = scroller.getBoundingClientRect();
  if (e.top < s.top + pad) scroller.scrollTop -= s.top + pad - e.top;
  else if (e.bottom > s.bottom - pad) scroller.scrollTop += e.bottom - (s.bottom - pad);
}

// After the keyboard resize, not on focus (the keyboard isn't up yet)
window.visualViewport?.addEventListener('resize', () => {
  const el = document.activeElement;
  const scroller = el?.closest<HTMLElement>('[data-scroll-root]');
  if (el && scroller && el.matches(FIELD)) requestAnimationFrame(() => reveal(el, scroller));
});

/** Focus from code (Reply button, roving tabindex): synchronously inside the tap, or iOS shows no keyboard. */
export function focusInPane(field: HTMLElement): void {
  field.focus({ preventScroll: true });
  const scroller = field.closest<HTMLElement>('[data-scroll-root]');
  if (scroller) reveal(field, scroller);
}
```

```css
.app-scroll { scroll-padding-top: var(--sticky-h, 0px); scroll-padding-bottom: 16px; }
```

**Support:** `focus({ preventScroll })`: Chrome 64, Safari 15 / iOS 15.5, Firefox 68; BCD lists Chrome and Firefox for Android as unsupported (unverified, likely a data gap). `scrollIntoView({ container: 'nearest' })` (scroll only the nearest scroller): Chrome/Edge 140+ only. `scroll-padding` for `scrollIntoView`: Safari 14.1 / iOS 14.5.

**Gotchas:**
- `overflow: clip` on a non-root wrapper also blocks programmatic scrolling; on html/body it acts as `hidden`.
- Use `block: 'nearest'`: Safari still ignores `center` (BCD).
- The `container` option is missing from TypeScript's lib.dom.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView · https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus

## Auto-growing composer with field-sizing: content

A textarea that grows line by line, then scrolls, with no JS; fixed boxes with inner scrollbars or per-keystroke JS jank feel webby.

```css
.composer textarea {
  field-sizing: content; min-block-size: 2.75rem;
  max-block-size: 8lh;   /* then scroll; lh, not vh (vh ignores the iOS keyboard) */
  overflow-y: auto; resize: none;
}
```

```ts
/** Fallback for Safari < 26.2 and Firefox < 152. */
export function autoGrow(textarea: HTMLTextAreaElement, maxPx = 200): void {
  if (CSS.supports('field-sizing', 'content')) return;
  const fit = (): void => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxPx)}px`;
  };
  textarea.addEventListener('input', fit);
  fit();
}
```

**Support:** `field-sizing`: Chrome 123, Safari 26.2 (macOS, iOS), Firefox 152, Samsung 27. `lh`: Chrome 109, Safari 16.4, Firefox 120.

**Gotchas:**
- Scope it: it also changes `<input>`/`<select>` widths. An empty field sizes to its placeholder.
- Put the composer in an `auto` grid row so growth shrinks the list instead of pushing under the keyboard.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/field-sizing

## Chat/timeline lists that open and stay at the bottom (column-reverse wrapper)

A `column-reverse` scroller with ONE child holding messages oldest → newest has its scroll origin at the bottom: it opens at the newest message with no jump, stays pinned when it shrinks (keyboard, composer), and prepending history doesn't move the view.

```html
<div class="log" role="log" data-scroll-root><div><!-- messages, oldest → newest --></div></div>
```

```css
.log { display: flex; flex-direction: column-reverse; overflow-y: auto; overscroll-behavior-y: contain; min-height: 0; }
```

```ts
/** column-reverse: scrollTop is 0 at the bottom and negative above it. */
export const showJumpToLatest = (log: HTMLElement): boolean => -log.scrollTop > 160;
export const toLatest = (log: HTMLElement): void =>
  log.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

/** Normal-column alternative (field-tested): pin while near the bottom, also when the pane or content resizes. */
export function stickToBottom(log: HTMLElement, threshold = 160): () => void {
  let atBottom = true;
  const pinIfAtBottom = (): void => { if (atBottom) log.scrollTop = log.scrollHeight; };
  const onScroll = (): void => { atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < threshold; };
  const ro = new ResizeObserver(pinIfAtBottom); // keyboard, composer growth, new rows, late images
  ro.observe(log);
  if (log.firstElementChild) ro.observe(log.firstElementChild);
  log.addEventListener('scroll', onScroll, { passive: true });
  pinIfAtBottom();
  return () => { ro.disconnect(); log.removeEventListener('scroll', onScroll); };
}
```

**Support:** all current engines: spec-negative `scrollTop` in Chrome 81+, Firefox 81+, Safari always.

**Gotchas:**
- Code that assumes `scrollTop >= 0` breaks.
- While the reader is scrolled up, a new bottom message may shift their view in some engines (unverified): test and compensate.
- One wrapper keeps reading and Tab order chronological; reversing the DOM makes screen readers read newest-first.
- Alternative pin trick: rows `overflow-anchor: none`, a 1px last child `overflow-anchor: auto` (all engines since Safari 27).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTop · https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-anchor

## Scroll anchoring (overflow-anchor), now in every engine

The browser keeps what you're reading still when content above it is inserted or resized; jumping content is a strong web tell. Exclude transient rows as anchors.

```css
.feed .loading-row, .feed .typing { overflow-anchor: none; } /* default elsewhere: auto */
```

```ts
/** Prepend older history without moving the view; compensate only where native anchoring won't. */
export function prependKeepingPosition(scroller: HTMLElement, prepend: () => void): void {
  // Spec: no anchoring at scroll offset 0, so compensate there too
  if (CSS.supports('overflow-anchor', 'auto') && scroller.scrollTop > 0) return prepend();
  const fromBottom = scroller.scrollHeight - scroller.scrollTop;
  prepend(); // must update the DOM synchronously (React: flushSync, or compensate in useLayoutEffect)
  scroller.scrollTop = scroller.scrollHeight - fromBottom;
}
```

**Support:** Chrome 56, Firefox 66, Safari 27.0 (macOS, iOS; Sept 2026, first support).

**Gotchas:**
- Compensating where anchoring works moves content twice.
- It doesn't help when the scroller shrinks (keyboard): use the [column-reverse list](#chattimeline-lists-that-open-and-stay-at-the-bottom-column-reverse-wrapper) or a `ResizeObserver`.
- Start loading older history before the very top. Keep the fallback while iOS < 27 is in your support window.
- Give images `width`/`height` or `aspect-ratio`.

**Sources:** https://drafts.csswg.org/css-scroll-anchoring-1/ · https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

## overscroll-behavior: no page rubber-band, no accidental pull-to-refresh, no scroll chaining

`none` on the root kills page bounce/glow, pull-to-refresh and overscroll navigation; `contain` on scrollers stops a list's end from scrolling what's behind it. Pulling a chat down and reloading the app never happens natively.

```css
html, body { overscroll-behavior: none; }                         /* set both: engines differ on which counts */
.app-scroll { overflow-y: auto; overscroll-behavior-y: contain; }  /* no chaining; own bounce kept */
.carousel, .tabs-strip { overscroll-behavior-x: contain; }         /* no back/forward from horizontal edges */
```

**Support:** Chrome 63, Firefox 59, Safari 16 (macOS, iOS). Chrome 144 and Firefox 150 also apply it to scroll containers without overflow (`overflow: hidden`, or `auto` that fits); Safari only when the box overflows.

**Gotchas:**
- `contain` keeps the element's own bounce; `none` removes it too.
- Chrome Android shows pull-to-refresh in installed apps too: disable it and offer refresh another way ([touch-gestures-input.md](touch-gestures-input.md), or auto-sync); content sites can keep it.
- Field-tested: the root value doesn't reliably stop iOS main-frame rubber-banding (embedded WKWebViews ignore it); the [locked shell](#locked-app-shell-with-in-flow-bars-and-inner-scroll-containers) does.
- `overscroll-behavior-x` doesn't reliably block two-finger history swipes in Chrome on Windows; no page can block OS back gestures.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior · https://developer.chrome.com/release-notes/144

## Scroll lock under modals and sheets in CSS

Page content scrolling under a sheet is a web tell, and JS locks (`body { position: fixed }`) lose the scroll position and flash. Do it in CSS.

```css
dialog { overscroll-behavior: contain; }                             /* modal dialogs get overflow: auto */
dialog::backdrop { overflow: hidden; overscroll-behavior: contain; } /* non-scrollable container, stops chaining */
html:has(dialog:modal) { overflow: hidden; }                         /* for engines without the 144/150 behaviour */
html { scrollbar-gutter: stable; }                                   /* desktop: no shift when the scrollbar goes */
```

**Support:** the pure `overscroll-behavior` lock: Chrome 144+, Firefox 150+. Safari needs the `:has()` fallback (`:has`, `<dialog>`: 15.4).

**Gotchas:**
- A locked shell never scrolls the document, so this matters for document-scroll pages and sheets over inner scrollers (`.sheet-body { overscroll-behavior: contain }`).
- iOS doesn't always enforce html `overflow: hidden` (collapsed toolbar; historically standalone): test on a device. With the `position: fixed` hack, save and restore `scrollY`.
- Dialog behaviour → [navigation-ui-patterns.md](navigation-ui-patterns.md); its animation → [motion-performance.md](motion-performance.md).

**Sources:** https://www.bram.us/2025/11/25/use-overscroll-behavior-contain-to-prevent-a-page-from-scrolling-while-a-dialog-is-open/

## Delete obsolete iOS scrolling/height hacks

These are now no-ops or bugs: extra stacking contexts, janky non-passive listeners, stale sizes.

```css
/* delete */
.scroller { -webkit-overflow-scrolling: touch; } /* momentum is default since iOS 13 */
.full { height: -webkit-fill-available; }
/* use */
.full { height: 100svh; } /* or a 100% chain in a locked shell */
/* delete in JS: innerHeight-based --vh toolbar hacks, 'orientationchange' / window.orientation,
   touchmove preventDefault "no bounce" scripts. Use matchMedia, overscroll-behavior and a locked shell. */
```

**Support:** momentum is the default for overflow scrollers since iOS 13 (the property is gone from MDN/BCD); `window.orientation` and `orientationchange` are deprecated.

**Gotchas:**
- A JS height is still right for one case: the [iOS keyboard](#ios-keyboard-size-and-move-the-shell-to-the-visual-viewport-only-while-a-keyboard-is-up), not toolbars.
- Grep dependencies and CSS-in-JS too: component libraries still ship these.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length

## Scroll-snap pagers and carousels, with scrollend

Pagers (onboarding, galleries, swipeable tabs) on CSS scroll snap get native momentum, rubber-banding and accessibility; JS transform carousels fight the finger. Swipe-to-reveal rows → [touch-gestures-input.md](touch-gestures-input.md).

```css
.pager {
  display: grid; grid-auto-flow: column; grid-auto-columns: 100%;
  overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; scrollbar-width: none;
}
.pager > section { scroll-snap-align: start; scroll-snap-stop: always; } /* one page per swipe */
```

```ts
/** Calls back with the settled page; Math.abs because scrollLeft is negative in RTL. */
export function onPageSettled(pager: HTMLElement, onPage: (index: number) => void): void {
  const fire = (): void => onPage(Math.round(Math.abs(pager.scrollLeft) / pager.clientWidth));
  if ('onscrollend' in window) return pager.addEventListener('scrollend', fire);
  let timer: ReturnType<typeof setTimeout> | undefined; // Safari < 26.2
  pager.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(fire, 120); }, { passive: true });
}

export function goToPage(pager: HTMLElement, index: number): void {
  const dir = getComputedStyle(pager).direction === 'rtl' ? -1 : 1;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  pager.scrollTo({ left: dir * index * pager.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
}
```

**Support:** snap type/align: Chrome 69, Safari 11, Firefox 68; `scroll-snap-stop`: Chrome 75, Safari 15, Firefox 103; `scrollend`: Chrome 114, Firefox 109, Safari 26.2. Chromium only: `scrollsnapchange`/`scrollsnapchanging` (129+), `::scroll-marker`/`::scroll-button` (135+), `scroll-initial-target` (133+).

**Gotchas:**
- `mandatory` with items taller than the scrollport traps users; use `proximity` for vertical lists.
- Hidden scrollbars need prev/next buttons on `(pointer: fine)`; tab-view pagers keep real tab buttons.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll_snap · https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollend_event

## Desktop scrollbars: stable gutter, thin themed bars, hidden on strips

Layouts that jump 15px when a list overflows, or fat grey scrollbars in a dark app, are desktop web tells.

```css
.app-scroll { scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) transparent; }
.chips, .pager { scrollbar-width: none; } /* still scrollable by touch, trackpad, keyboard */
```

**Support:** `scrollbar-gutter`: Chrome 94, Firefox 97, Safari 18.2. `scrollbar-width`: Chrome 121, Firefox 64, Safari 18.2. `scrollbar-color`: Chrome 121, Firefox 64, Safari 26.2.

**Gotchas:**
- In Chromium, `scrollbar-width`/`scrollbar-color` disable that element's `::-webkit-scrollbar` styles.
- Gutters do nothing with overlay scrollbars (phones, macOS default): harmless.
- Hidden scrollbars need another affordance on `(pointer: fine)` (arrows, edge fades).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-gutter

## No sideways wobble: overflow-x: clip and min-width: 0

A page that pans a few pixels sideways under the thumb is an instant web tell. Clip stray overflow without a scroll container and let flex/grid children shrink.

```css
.page { overflow-x: clip; }       /* not a scroll container: sticky keeps working */
.row > * { min-width: 0; }        /* flex/grid items default to min-width: auto */
.message-text { overflow-wrap: anywhere; }
img, video { max-width: 100%; height: auto; }
.full-bleed { width: 100%; }      /* not 100vw: on desktop it includes the scrollbar */
```

```ts
// DevTools: what sticks out horizontally?
const vw = document.documentElement.clientWidth;
console.log(Array.from(document.querySelectorAll('body *')).filter((el) => el.getBoundingClientRect().right > vw));
```

**Support:** `overflow: clip`: Chrome 90, Safari 16, Firefox 81.

**Gotchas:**
- `overflow-x: hidden` creates a scroll container: it breaks descendant `position: sticky` and can still be scrolled from code.
- On html/body, `clip` propagates to the viewport as `hidden`.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow

## Sticky section headers with scroll-padding and a stuck state

Native grouped lists (contacts, settings, day separators) pin headers and add a separator only while pinned. Sticky headers inside the pane's scroller, `scroll-padding` so focus and anchor targets land below them, and a scroll-state query for the stuck style.

```css
.app-scroll { scroll-padding-top: var(--section-header-h, 40px); }
.section-header { position: sticky; top: 0; z-index: 1; container-type: scroll-state; }
.section-header > .bar { background: var(--surface-page); transition: box-shadow .2s; }
@container scroll-state(stuck: top) {
  .section-header > .bar { box-shadow: 0 1px 0 var(--border); } /* queries style descendants, not the container */
}
```

**Support:** sticky: universal. `scroll-padding`: Chrome 69, Firefox 68, Safari 14.1. `scroll-state()`: Chromium 133+ only; elsewhere no shadow (fine as enhancement).

**Gotchas:**
- Sticky silently fails if an ancestor between it and the scroller has `overflow: hidden`/`auto` (use `clip`).
- Give the bar an opaque background. Cross-engine stuck style: `IntersectionObserver` on a 1px sentinel above the header.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Conditional_rules/Container_scroll-state_queries

## Orientation changes: respond, don't lock

Reflow on rotation, compact layouts for landscape phones, re-measure after sizes settle. Lock only for fullscreen media or games ([device-apis.md](device-apis.md)).

```css
@media (orientation: landscape) and (max-height: 500px) { /* landscape phone: hide secondary chrome */
  .app-header .subtitle { display: none; }
  .app-footer { padding-block: 4px; }
}
```

```ts
/** Re-measure in a ResizeObserver on the measured element: sizes settle after orientation events. */
export const onOrientation = (cb: (landscape: boolean) => void): void =>
  matchMedia('(orientation: landscape)').addEventListener('change', (e) => cb(e.matches));
```

**Support:** orientation media query: universal. `screen.orientation` `change` (replaces deprecated `orientationchange`): Chrome 38, Firefox 43, Safari 16.4. Manifest `orientation` → [install-and-identity.md](install-and-identity.md#orientation).

**Gotchas:**
- WCAG 1.3.4 forbids restricting orientation unless essential; tablets, foldables and desktop windows resize freely.
- Left/right safe-area insets swap with landscape direction.
- Landscape phones aren't tablets: gate split views on height as well as width.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/orientation · https://www.w3.org/WAI/WCAG22/Understanding/orientation.html

## Container queries for components that adapt to their pane

Components follow the width of their pane (sidebar, detail, Stage Manager window), like native size classes; screen breakpoints break once split views exist.

```css
.pane { container: pane / inline-size; }
@container pane (width >= 36rem) { .message { grid-template-columns: 3rem minmax(0, 1fr) auto; } }
@container pane (width < 36rem)  { .message .meta { display: none; } }
.card-title { font-size: clamp(1rem, 3.5cqi, 1.375rem); }
```

**Support:** size queries, `cq*` units: Chrome 105, Safari 16, Firefox 110. Style queries for custom properties: Chrome 111, Safari 18, Firefox 151.

**Gotchas:**
- `inline-size` containment can't size from children: shrink-to-fit containers collapse. Use panes and grid cells with definite widths; `size` also needs a height.
- A container can't query itself. In Safari the root can't be a style-query container.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container

## Large screens: list-detail split view by width, not device

From ~768px show list and detail side by side, selection in the URL; below, push detail full-screen with a back button. A stretched phone layout on an iPad or desktop window is a strong web tell.

```css
.layout { height: 100%; display: grid; grid-template-columns: minmax(0, 1fr); }
@media (width >= 768px) {
  .layout { grid-template-columns: clamp(260px, 30%, 360px) minmax(0, 1fr); }
  .detail-empty { display: grid; place-items: center; } /* never a blank right pane */
}
.reading { max-inline-size: 72ch; margin-inline: auto; }
```

```ts
const wide = matchMedia('(width >= 768px)');
/** Same URL in both layouts: split view replaces the entry, stacked pushes a screen that Back pops. */
export const openThread = (id: string, navigate: (url: string, replace: boolean) => void): void =>
  navigate(`/t/${encodeURIComponent(id)}`, wide.matches);
```

**Support:** universal; range syntax: Chrome 104, Safari 16.4, Firefox 102.

**Gotchas:**
- iPadOS Safari sends a Mac UA and Split View / Stage Manager windows can be any width: decide by width (and pointer), never UA.
- Route = selection, so rotating or resizing keeps state; back buttons only when stacked. Adaptive tab bar / rail → [navigation-ui-patterns.md](navigation-ui-patterns.md).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using

## Foldables: Viewport Segments API (dual-pane across the hinge)

Native foldable apps put list and detail on separate halves and never draw text across the hinge. Use the segment media features, `env(viewport-segment-*)` and `window.viewport.segments`.

```css
@media (horizontal-viewport-segments: 2) {
  .layout {
    display: grid;
    grid-template-columns: env(viewport-segment-width 0 0)
      calc(env(viewport-segment-left 1 0) - env(viewport-segment-right 0 0)) env(viewport-segment-width 1 0);
  }
  .list { grid-column: 1; } .detail { grid-column: 3; } /* column 2 is the hinge */
}
/* (vertical-viewport-segments: 2): laptop posture, same idea with rows and segment height/top/bottom */
```

```ts
type ViewportLike = { readonly segments: ReadonlyArray<DOMRectReadOnly> | null };
const win: Window & { readonly viewport?: ViewportLike } = window; // not in lib.dom; no cast

/** Segment rectangles while the window spans a fold; [] on single screens and other engines. */
export function segments(): ReadonlyArray<DOMRectReadOnly> {
  const s = win.viewport?.segments;
  return s && s.length > 1 ? s : [];
}
```

**Support:** Chrome/Edge 138+ (Android, desktop), Samsung 30, WebView 138. No Safari, no Firefox. Experimental.

**Gotchas:**
- Single screens: features false, `env()` undefined. Write the one-segment layout first.
- Segments change on fold, unfold and rotate: re-read on `resize` or the media query's `change`. DevTools emulates dual screens.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Viewport_segments_API/Using

## Device Posture API (folded vs continuous)

Half-folded (`folded`, book or laptop posture) vs flat (`continuous`) enables tabletop modes: video on top, controls below.

```css
@media (device-posture: folded) and (orientation: landscape) {
  .player { display: grid; grid-template-rows: 1fr 1fr; } /* top: video, bottom: controls */
}
```

```ts
export const onPosture = (cb: (folded: boolean) => void): void => // never fires where unsupported
  matchMedia('(device-posture: folded)').addEventListener('change', (e) => cb(e.matches));
```

**Support:** Chrome/Edge 132+ (desktop, Android), Samsung 16.2; Safari iOS 27 behind a flag; no Firefox. Experimental. JS twin: `navigator.devicePosture.type`.

**Gotchas:**
- Non-foldables always report `continuous`. DevTools can't emulate half-folded. Pair with [segments](#foldables-viewport-segments-api-dual-pane-across-the-hinge) to find the fold.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API

## iOS home-screen status bar: default/black vs black-translucent

In an installed iOS app, `default`/`black` start the web view *below* an opaque status bar; `black-translucent` draws *under* it (white status text, top safe-area padding needed). Translucent looks native but since iOS 26 can bring sizing gaps and a top blur; opaque is predictable. The tag itself: [install-and-identity.md](install-and-identity.md#apple-meta-tags).

```html
<meta name="apple-mobile-web-app-status-bar-style" content="default"> <!-- predictable: inset-top = 0 -->
<!-- or content="black-translucent" (needs viewport-fit=cover) plus: -->
<style>
  .app-header { padding-top: var(--safe-top); }
  html { height: 100%; } body { height: var(--app-height, 100%); } /* not visualViewport/dvh by default */
</style>
```

**Support:** iOS/iPadOS home-screen apps only; Safari tabs and other browsers ignore it. Since iOS 26, Home Screen sites open as web apps by default ("Open as Web App" can be turned off).

**Gotchas:**
- Read at install time: after a change, users must remove and re-add the app.
- Field reports, iOS 26–27.0 (unverified against Apple docs): with `black-translucent` the standalone viewport can be a status bar (~59–60pt) short, leaving a band, and a Liquid Glass edge blur covers ~110px at the top. Several teams moved to `default`/`black`.
- Field-tested: `black-translucent` stays gap-free with a CSS `100%` chain and `visualViewport` used only while a keyboard is up.
- White status text is unreadable over light headers. From Safari 26, `theme-color` applies only to installed apps.

**Sources:** https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html · https://www.heise.de/en/news/iOS-26-and-iPadOS-26-Changed-web-app-behaviour-on-the-home-screen-10749652.html

## Safari 26+ toolbar tinting and full-screen dims come from edge-hugging fixed/sticky elements

Safari 26 tabs ignore `theme-color`: they tint the top and bottom bars from a fixed or sticky element at the viewport edge (falling back to the html/body background), and dims reach the bars only as `position: fixed; inset: 0`. Mismatched bands, or a scrim that leaves the bars bright, scream "website".

```css
html, body { background-color: var(--surface-page); }                          /* fallback sample */
.app-header { position: sticky; top: 0; background-color: var(--surface-bar); } /* opaque, full width */
.scrim { position: fixed; inset: 0; background-color: rgb(0 0 0 / 0.4); }       /* dims Safari's bars too */
/* not: absolute or 100vh scrims, gradients/background-image as the bar colour */
```

**Support:** Safari 26+ tabs on iOS/iPadOS (top bar on macOS too), with `viewport-fit=cover`. Installed web apps use `theme-color`. Not applicable to Chromium or Firefox.

**Gotchas:**
- Undocumented. Community reverse-engineering on iOS 26.5/27.0 (unverified): the topmost fixed/sticky layer is sampled ~4px in at the edge centre and must be ≥ ~90% wide, > 10px deep, opacity ≥ 0.1, with its *own* `background-color`. Empty full-width `pointer-events: none` overlays block it; a top toast retints while visible.
- A locked shell's header is in flow: `position: sticky; top: 0` on it is harmless and may let Safari sample it; otherwise match the html/body background to the header (unverified which wins).
- Re-test every iOS release.

**Sources:** https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ · https://benfrain.com/ios26-safari-theme-color-tab-tinting-with-fixed-position-elements/

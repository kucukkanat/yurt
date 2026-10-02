# Install, manifest and app identity

What makes the OS treat a site as an app: manifest, icons, colours, install UX, "am I installed?" detection, OS entry points (shortcuts, share, files, links) and store packaging.
Support is as of Oct 2026 (MDN browser-compat-data 8.1.4: Chrome 154, Safari 27, Firefox 157, plus vendor docs; Safari 27-specific changes not reviewed). TS snippets compile under `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` with the declarations in [Typing](#typing-the-non-standard-install-apis).

## Checklist

- [ ] **must** — Link one complete manifest from every page → [Baseline manifest](#baseline-manifest)
- [ ] **must** — Set an explicit, path-qualified `id` before launch; never change it → [Manifest id](#manifest-id)
- [ ] **must** — Point `start_url`/`scope` at where the app lives → [start_url and scope](#start_url-and-scope)
- [ ] **must** — Declare `display: standalone`, richer modes in `display_override` → [Display](#display-mode-and-display_override)
- [ ] **must** — Offer install per browser path; never promise one the browser won't offer → [Install paths](#install-paths-per-browser)
- [ ] **must** — Capture `beforeinstallprompt` for your own Install button → [Install button](#custom-install-button-beforeinstallprompt)
- [ ] **must** — Suggest installing once, after value, never inside the app → [Install promotion](#install-promotion-ux)
- [ ] **must** — Detect iOS/iPadOS correctly and show current Add to Home Screen steps → [iOS steps](#ios-and-ipados-detection-and-add-to-home-screen-steps)
- [ ] **must** — Ship the Apple meta tags plus `mobile-web-app-capable` → [Apple meta tags](#apple-meta-tags)
- [ ] **must** — Ship one opaque 180x180 `apple-touch-icon` → [apple-touch-icon](#apple-touch-icon)
- [ ] **must** — Generate every icon from one SVG, maskable as a separate file → [Icons](#icons-from-one-svg-maskable-done-right)
- [ ] **must** — Set `background_color`/`theme_color` to the page surface → [Colours](#background_color-and-theme_color)
- [ ] **must** — Detect the installed app (display-mode + `navigator.standalone`) and watch changes → [Detect](#detect-the-installed-app)
- [ ] **should** — Draw the desktop title bar with Window Controls Overlay → [WCO](#window-controls-overlay)
- [ ] **should** — Ship iOS launch screens → [Launch screens](#ios-launch-screens-apple-touch-startup-image)
- [ ] **should** — Set `meta theme-color` per scheme, synced with the in-app theme → [theme-color](#meta-theme-color-per-scheme-and-theme)
- [ ] **should** — Badge the app icon with the unread count → [Badging](#app-icon-badge-badging-api)
- [ ] **should** — Add description + form-factor screenshots → [Richer install](#richer-install-dialog-description-and-screenshots)
- [ ] **should** — Add app shortcuts → [Shortcuts](#app-shortcuts)
- [ ] **should** — Appear in the system share sheet → [Share target](#share-target)
- [ ] **should** — Reuse the open window on launch → [launch_handler](#single-instance-launches-launch_handler)
- [ ] **should** — Plan updates: versioned icon URLs, fixed id, migration → [Updates](#manifest-updates-and-identity-migration)
- [ ] **should** — Usually omit `orientation` → [Orientation](#orientation)
- [ ] **should** — Support macOS Safari Add to Dock → [macOS web apps](#macos-safari-web-apps-add-to-dock)
- [ ] **should** — Type the non-standard install APIs as optional → [Typing](#typing-the-non-standard-install-apis)
- [ ] **nice** — Title the installed window with `application-title` → [Window title](#installed-window-title-application-title)
- [ ] **nice** — Register desktop file handlers → [File handlers](#file-handlers)
- [ ] **nice** — Own a `web+` scheme → [Protocol handlers](#protocol-handlers)
- [ ] **nice** — Span several origins → [scope_extensions](#scope_extensions-several-origins)
- [ ] **nice** — Localize name, description, icons, shortcuts → [Localized](#localized-manifest-members)
- [ ] **nice** — Declare related apps, detect installs → [Related apps](#related-applications)
- [ ] **nice** — Publish to Google Play as a TWA → [Google Play](#google-play-trusted-web-activity)
- [ ] **nice** — Publish to the Microsoft Store → [Microsoft Store](#microsoft-store-msix)
- [ ] **nice** — Feature-detect `navigator.install()` / `<install>` → [Web Install](#web-install-api-and-the-install-element)
- [ ] **nice** — Skip niche and legacy members → [Skip](#manifest-members-to-skip)

## Baseline manifest

The manifest turns a bookmark into an app (OS name and icon, own window, coloured splash and system bars, Chromium's install offer); a missing member means a tab launch, a white flash or a letter icon.

```json
{
  "id": "/myapp/",
  "name": "My App",
  "short_name": "MyApp",
  "description": "One sentence; Chromium shows it in the install dialog.",
  "lang": "en",
  "dir": "ltr",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#121212",
  "theme_color": "#121212",
  "categories": ["productivity"],
  "icons": [
    { "src": "pwa-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "pwa-512x512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "maskable-icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Link it from every page: `<link rel="manifest" href="manifest.webmanifest">`.

> With Vite/React: pass the same object to `VitePWA({ manifest })`; it emits the file and the link.

**Support:** Chromium desktop 39+ · Chrome Android 39+ · Safari macOS 17+ (Add to Dock) · Safari iOS 11.3+ (read when added to the Home Screen) · Firefox Android 79+ partial; Firefox desktop ignores it. `description`: Chromium 88+ only. `background_color`: not used by Safari. `categories`/`lang`/`dir`: metadata (stores read `categories`).

**Gotchas:**
- `short_name` ≤ 12 chars (labels truncate); give every icon a `type`.
- Relative URLs resolve against the manifest URL, except `id` ([Manifest id](#manifest-id)).
- Fetched without credentials: behind cookie auth add `crossorigin="use-credentials"`; CSP needs `manifest-src`; serve `application/manifest+json`.
- Never rename or move the manifest after launch: Chrome keys updates to its URL.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable

## Manifest id

`id` is the permanent identity, resolved against the **origin** of `start_url` (fragment dropped; absent, `start_url` is the identity). Fix it once and you can move `start_url` or the manifest without duplicate installs.

```ts
// manifest: { "id": "/myapp/", "start_url": "./", "scope": "./" }
/** Mirror of the W3C "process the id member" steps, for a unit test. */
export function resolvedId(id: string | undefined, startUrl: URL): string {
  const start = new URL(startUrl.href);
  start.hash = '';
  if (!id) return start.href;
  let u: URL;
  try {
    u = new URL(id, startUrl.origin);
  } catch {
    return start.href;
  }
  if (u.origin !== startUrl.origin) return start.href;
  u.hash = '';
  return u.href;
}
// resolvedId('./', new URL('https://me.github.io/myapp/')) === 'https://me.github.io/' (origin root!)
```

**Support:** Chromium desktop 96+ · Chrome Android 96+ · Safari macOS 17+ · Safari iOS 16.4+ (home-screen apps) · Firefox parses, ignores.

**Gotchas:**
- `./`, `/`, `foo`, `../foo` resolve against the origin: on a shared origin (GitHub Pages project sites) `"./"` collides with every app there. Use the full path (`"/repo/"`). Field-tested: `"./"` on a subpath deploy silently became the origin root.
- Set `id` before adding analytics parameters to `start_url`.
- A changed id is a new app; Chromium desktop can migrate ([Updates](#manifest-updates-and-identity-migration)). DevTools > Application > Manifest shows the computed App Id ([platform-quirks-testing.md](platform-quirks-testing.md#debug-installability-with-devtools-chromeinspect-and-real-phones-lighthouse-no-longer-has-a-pwa-category)).

**Sources:** https://w3c.github.io/manifest/#id-member · https://developer.chrome.com/docs/capabilities/pwa-manifest-id

## start_url and scope

`start_url` is what the icon opens; `scope` is what counts as the app. Leaving scope brings back browser UI (URL toolbar, or an in-app Safari sheet on iOS), the strongest website tell.

```json
{ "start_url": "./?source=pwa", "scope": "./" }
```

**Support:** Chromium desktop (scope 53+) · Chrome Android · Safari macOS 17+ (scope respected from 17.2) · Safari iOS 11.3+ home-screen apps · Firefox Android 79+.

**Gotchas:**
- `start_url` must be inside scope and work offline: precache it ([offline-push-storage.md](offline-push-storage.md#precache-the-app-shell-with-workbox-injectmanifest-vs-generatesw)).
- Scope `/app` also matches `/apple`: keep the trailing slash.
- Cross-origin OAuth/payment pages open in an in-app sheet: test the round trip standalone on iOS.
- Open other sites with `target="_blank" rel="noopener"` (real browser, not an in-app sheet).
- Without a manifest, iOS uses the current page URL as the start URL.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope · https://webkit.org/blog/14787/

## Display mode and display_override

`display` picks the window (fallback `fullscreen > standalone > minimal-ui > browser`); `display_override` is tried first, for `window-controls-overlay` and `tabbed`. `standalone` is the biggest single step toward native.

```json
{ "display_override": ["window-controls-overlay", "standalone"], "display": "standalone" }
```

```css
@media (display-mode: standalone), (display-mode: window-controls-overlay) {
  .open-in-app-banner { display: none; }
}
```

**Support:** `standalone`: Chromium desktop · Chrome Android · Safari macOS 17+ · Safari iOS 11.3+ home-screen apps · Firefox Android. `fullscreen`/`minimal-ui`: Chromium and Firefox Android only. `display_override`: Chromium 89+ only. `window-controls-overlay`: Chromium desktop 105+. `tabbed`: ChromeOS only (126+).

**Gotchas:**
- Always set `display`: Safari and Firefox read only that. iOS supports only `standalone`.
- Firefox desktop never matches `display-mode: standalone`; its Windows taskbar apps match `minimal-ui` (142+).
- A user's tab/window choice overrides the manifest; changing `display` later doesn't move existing installs.
- Adapting UI per mode: [navigation-ui-patterns.md](navigation-ui-patterns.md#adapt-to-display-mode-installed-vs-browser-tab).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display_override

## Window Controls Overlay

An installed desktop window hands its title bar to the page, keeping only min/max/close as an overlay, so search or the current view sits in the title row like Slack or VS Code instead of under a thick browser-style bar.

```css
/* env() falls back when the overlay is off or collapsed */
.titlebar {
  position: fixed;
  left: env(titlebar-area-x, 0);
  top: env(titlebar-area-y, 0);
  width: env(titlebar-area-width, 100%);
  height: env(titlebar-area-height, 44px);
  -webkit-app-region: drag; /* Chromium */
  window-drag: move;        /* standard name, Chromium 152+ */
}
.titlebar :is(a, button, input, select, [role="button"]) { -webkit-app-region: no-drag; window-drag: none; }
main { padding-top: env(titlebar-area-height, 44px); }
```

```ts
declare function layoutTitlebar(visible: boolean, rect: DOMRect): void;
const wco = navigator.windowControlsOverlay;
if (wco) {
  let frame = 0;
  const relayout = () => {
    cancelAnimationFrame(frame); // fires on every resize: coalesce per frame
    frame = requestAnimationFrame(() => layoutTitlebar(wco.visible, wco.getTitlebarAreaRect()));
  };
  wco.addEventListener('geometrychange', relayout);
  relayout();
}
```

**Support:** Chromium desktop 105+ (Windows, macOS, Linux, ChromeOS), installed windows only; `env(titlebar-area-*)` 93+; `window-drag` 152+ · Chrome Android, Safari, Firefox: no.

**Gotchas:**
- Users can collapse the overlay: keep `env()` fallbacks, handle `geometrychange`.
- Drag regions swallow clicks: mark every interactive child `no-drag`. Unprefixed `app-region` isn't in BCD.
- Test without installing: DevTools > Application > Manifest can emulate WCO.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Window_Controls_Overlay_API

## Installed window title (application-title)

Chromium shows this tag in an installed window's title bar instead of `document.title`, so the window reads "App — Document" rather than repeating the tab title and unread count.

```ts
// <meta name="application-title" content="Groceries">
export function setAppTitle(text: string): void {
  let m = document.querySelector<HTMLMetaElement>('meta[name="application-title"]');
  if (!m) {
    m = document.createElement('meta');
    m.name = 'application-title';
    document.head.append(m);
  }
  m.content = text;
}
```

**Support:** Chromium desktop 134+ installed windows (BCD lists Chrome Android 134, no visible effect known) · Safari, Firefox: no (harmless).

**Gotchas:**
- Empty `content` shows just the app name. Nonstandard (Edge explainer): keep `document.title` meaningful ([navigation-ui-patterns.md](navigation-ui-patterns.md#window-and-tab-title-carry-context-and-unread-count)).

**Sources:** https://blogs.windows.com/msedgedev/2025/02/05/control-your-installed-web-application-title/

## Install paths per browser

Each browser decides differently whether and how to install; know the user's path to show the right button or steps.

```text
Chromium (Chrome, Edge, Samsung, Opera) fires beforeinstallprompt when: HTTPS (or localhost);
  name|short_name, icons incl. 192 AND 512 px, start_url, display(_override) in fullscreen|standalone|
  minimal-ui|window-controls-overlay; prefer_related_applications not true; not installed; the user
  tapped/clicked once and viewed ~30 s. No service worker needed (since Chrome 108 Android / 112 desktop).
Any site, even without a manifest: Chrome desktop/Android menu installs the page as an app;
  Safari macOS 17+ File > Add to Dock; Safari iOS/iPadOS 26+ Add to Home Screen opens as a web app.
Android: real WebAPKs only from Chrome on Google-services devices and Samsung Internet; others make badged shortcuts.
iOS 16.4+: Chrome, Edge, Firefox, Orion can Add to Home Screen (runs on Safari's web-app runtime).
Firefox Android: menu > Add to Home screen. Firefox 143+ Windows: address-bar button pins a taskbar web app.
```

**Support:** `beforeinstallprompt` (44+) / `appinstalled` (64+): Chromium desktop and Chrome Android only · Safari macOS/iOS, Firefox: menu install only.

**Gotchas:**
- The heuristics change: treat them as hints; debug in DevTools > Application > Manifest.
- iOS 26 with "Open as Web App" off creates a plain bookmark (`navigator.standalone` stays false).
- Firefox's Microsoft Store build can't pin web apps. "Run at login" has no web API (a user toggle in browser app settings).

**Sources:** https://web.dev/articles/install-criteria · https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ · https://support.mozilla.org/en-US/kb/web-apps-firefox-windows

## Custom Install button (beforeinstallprompt)

Catch Chromium's offer, suppress its UI and fire it from your own in-context button: it converts better than the omnibox icon or mini-infobar and doesn't read as a browser nag. `appinstalled` fires however the app got installed.

```ts
interface InstallPrompt extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
const isInstallPrompt = (e: Event): e is InstallPrompt =>
  'prompt' in e && typeof e.prompt === 'function' && 'userChoice' in e;
let offer: InstallPrompt | null = null;

/** Call at startup, before the UI mounts: the event can fire very early. */
export function watchInstall(setInstallable: (v: boolean) => void): void {
  addEventListener('beforeinstallprompt', (e) => {
    if (!isInstallPrompt(e)) return;
    e.preventDefault(); // no mini-infobar
    offer = e;
    setInstallable(true);
  });
  addEventListener('appinstalled', () => { offer = null; setInstallable(false); });
}

/** Call synchronously from the click handler: prompt() needs user activation. */
export async function install(setInstallable: (v: boolean) => void): Promise<boolean> {
  const o = offer;
  if (!o) return false;
  offer = null; // each event can prompt() once
  setInstallable(false);
  await o.prompt();
  return (await o.userChoice).outcome === 'accepted';
}
```

> With Vite/React: call `watchInstall` in the entry module before `createRoot`; keep only the boolean in the store (the event isn't serialisable).

**Support:** Chromium desktop and Chrome Android (Samsung, Opera) · Safari, Firefox: no; show steps ([Install promotion](#install-promotion-ux)).

**Gotchas:**
- Don't `await` before `prompt()`, or activation is lost and Chrome rejects.
- After a dismissal, wait for a new `beforeinstallprompt` before reshowing the button.
- Android fires `appinstalled` on accept, seconds before the WebAPK lands. Hide the button in the installed app.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt

## Install promotion UX

One non-blocking hint, once per device, only when installing helps, plus a permanent entry in Settings. Native apps never nag you to install them.

```ts
export type InstallPath = 'installed' | 'prompt' | 'ios-share-sheet' | 'mac-safari-dock' | 'browser-menu';
/** Pure: which install UI Settings shows. */
export const installPath = (s: { installed: boolean; hasPrompt: boolean; ios: boolean; macSafari: boolean }): InstallPath =>
  s.installed ? 'installed' : s.hasPrompt ? 'prompt' : s.ios ? 'ios-share-sheet' : s.macSafari ? 'mac-safari-dock' : 'browser-menu';

/** After value, never in the app, phones/tablets only (desktop has the omnibox icon), once per device. */
export function maybeSuggestInstall(
  s: { onboarded: boolean; installed: boolean; hintShown: boolean }, markShown: () => void, showHint: () => void,
): void {
  if (!s.onboarded || s.installed || s.hintShown || !matchMedia('(pointer: coarse)').matches) return;
  markShown(); // persist BEFORE showing, so a reload can't repeat it
  showHint();
}
```

**Support:** universal; the prompt button is Chromium only, steps cover Safari and Firefox.

**Gotchas:**
- Persist the flag durably (not `sessionStorage`); never block a flow.
- iOS home-screen and macOS Dock apps don't share localStorage/IndexedDB with Safari. Field-tested: a hint after onboarding means the installed copy starts without the identity made in the tab. Suggest installing before local state exists, or hand off (typed code or passkey sign-in, QR pairing, export/import): [offline-push-storage.md](offline-push-storage.md#ios-home-screen-apps-have-their-own-storage-onboard-inside-the-app).
- Prefer typed codes or passkeys to magic links: a tapped link opens Safari, not the home-screen app.

**Sources:** https://web.dev/articles/promote-install

## iOS and iPadOS: detection and Add to Home Screen steps

Safari has no install API, so Apple devices get steps. iPadOS claims to be a Mac; detect it by touch points or iPad users get the wrong steps.

```ts
/** iPadOS 13+ reports "Macintosh"; touch points tell it from a Mac. */
export const isIos = (ua: string, touchPoints: number): boolean =>
  /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
export const isMacSafari = (ua: string, touchPoints: number): boolean =>
  /Macintosh/.test(ua) && touchPoints <= 1 && /Version\/\d+.*Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);
// isIos(navigator.userAgent, navigator.maxTouchPoints)
```

```html
<!-- iOS 26. iOS 16.4–18: Share > Add to Home Screen > Add. Other iOS browsers: Share in the toolbar > Add to Home Screen. -->
<ol data-testid="install-ios">
  <li>Tap <b>•••</b> or <b>Share</b>.</li>
  <li>Choose <b>Add to Home Screen</b> (scroll if needed).</li>
  <li>Keep <b>Open as Web App</b> on, then tap <b>Add</b>.</li>
</ol>
```

**Support:** Safari iOS 11.3+: home-screen web app with a manifest or the capable meta tag; every site by default from iOS/iPadOS 26. Third-party iOS browsers from 16.4.

**Gotchas:**
- "Add to Home Screen" can hide under Edit Actions in the share sheet. Each icon has its own storage; name and icon freeze when added.
- Don't use `navigator.platform` (deprecated). UA checks only pick instructions, never gate features.

**Sources:** https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios · https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/

## Apple meta tags

The `apple-*` tags still set the iOS home-screen title and status-bar style; `mobile-web-app-capable` is the standard twin that silences Chrome's warning. `black-translucent` paints the app under the status bar.

```html
<!-- viewport rules (never disable zoom): viewport-keyboard-safe-areas.md -->
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="MyApp">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

**Support:** Safari iOS home-screen apps (status bar: `default` | `black` | `black-translucent`; no effect in a tab) · Chromium reads `mobile-web-app-capable` · Safari macOS, Firefox: ignored.

**Gotchas:**
- From iOS 26 the capable tag no longer decides web-app mode, but keep it: field reports say startup images don't show without it (unverified by Apple).
- `black-translucent` means light status-bar text over your content: check light themes, pad with `env(safe-area-inset-top)` ([viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#safe-area-tokens-envsafe-area-inset--with-fallbacks-and-max)).
- The home-screen label comes from `apple-mobile-web-app-title`, then the manifest name. Viewport baseline: [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#viewport-meta-baseline-for-app-like-pages).

**Sources:** https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html · https://github.com/vercel/next.js/issues/74524

## apple-touch-icon

The iOS/iPadOS home-screen icon, which beats manifest icons. Transparent or missing, it renders as a black tile or a page thumbnail.

```html
<!-- 180x180 PNG, square, opaque (flatten onto the brand colour), corners not pre-rounded -->
<link rel="apple-touch-icon" href="apple-touch-icon-180x180.png">
```

**Support:** Safari iOS/iPadOS · Safari macOS 17+ Dock apps. Without it, Safari iOS 15.4+/macOS 17+ use manifest icons with purpose `any`.

**Gotchas:**
- Alpha becomes black; iOS applies its own mask; dark/tinted styles (iOS 18+) are derived automatically.
- Icons never update after adding (remove and re-add). Keep content in the central ~80%.

**Sources:** https://realfavicongenerator.net/blog/apple-touch-icon-turns-black

## iOS launch screens (apple-touch-startup-image)

iOS builds no splash from the manifest, so a home-screen app opens blank unless a launch image matches the device exactly. Generate them in the page colour.

```ts
// pwa-assets.config.ts (@vite-pwa/assets-generator 1.x/2.x)
import { combinePresetAndAppleSplashScreens, defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: combinePresetAndAppleSplashScreens(
    minimal2023Preset,
    {
      padding: 0.3,
      resizeOptions: { background: '#ffffff', fit: 'contain' },
      darkResizeOptions: { background: '#121212', fit: 'contain' }, // adds prefers-color-scheme: dark links
      linkMediaOptions: { log: true, addMediaScreen: true, basePath: '/myapp/', xhtml: false },
    },
    ['iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone Air', 'iPhone 16e', 'iPad Air 11"', 'iPad Pro 12.9"'],
  ),
  images: ['public/icon.svg'],
});
// Emits one <link rel="apple-touch-startup-image" media="screen and (device-width: …) and (device-height: …)
//   and (-webkit-device-pixel-ratio: …) and (orientation: …)"> per image. CLI: npx pwa-asset-generator logo.svg ./public/splash --splash-only --background "#121212" --dark-mode --index ./index.html
```

> With Vite/React: `VitePWA({ pwaAssets: { config: true } })` runs it at build and injects the links (vite-plugin-pwa 1.x peers with generator 1.x). Its types clash with `exactOptionalPropertyTypes`: typecheck build configs without that flag.

**Support:** Safari iOS/iPadOS home-screen apps only · ignored elsewhere (Android builds its splash from name, `background_color` and icon).

**Gotchas:**
- New device sizes launch blank until you regenerate (generator tables cover iPhone 17/Air as of Oct 2026).
- Reportedly needs `apple-mobile-web-app-capable`; dark variants reportedly follow the appearance at the time the icon was added (unverified).
- Exclude the dozens of PNGs from service-worker precache.

**Sources:** https://vite-pwa-org.netlify.app/assets-generator/ · https://github.com/elegantapp/pwa-asset-generator

## Icons from one SVG, maskable done right

Generate `favicon.ico` (48), an SVG favicon, PNG 64/192/512 (`any`), a separate 512 maskable and a 180 apple-touch-icon from one source. Android crops icons to its shape; a non-maskable one shrinks onto a white disc.

```html
<link rel="icon" href="favicon.ico" sizes="48x48">
<link rel="icon" href="icon.svg" sizes="any" type="image/svg+xml">
<!-- manifest: separate files, never "any maskable":
  { "src": "maskable-icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  optional: { "src": "monochrome-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "monochrome" } -->
```

> With Vite/React: `VitePWA({ pwaAssets: { image: 'public/icon.svg', preset: 'minimal-2023', overrideManifestIcons: true, htmlPreset: '2023' } })` emits exactly this set (`pwa-*.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`) and fills the manifest icons.

**Support:** manifest icons: Chromium · Chrome Android · Safari (fallback, purpose `any`) · Firefox Android. `maskable`: Chrome Android (WebAPK adaptive icons), ChromeOS. `monochrome`: specified, no documented visible use (future-proofing).

**Gotchas:**
- One `"any maskable"` file is either over-padded or clipped: ship two files.
- Maskable: opaque full-bleed background, logo inside the central circle (80% diameter). Preview at maskable.app or DevTools' Manifest pane.
- The generator's maskable/apple backgrounds default to white: set your brand colour in the preset.
- Ship PNGs (SVG manifest icons aren't reliably used for WebAPKs). Desktop Chrome updates an icon only when its URL changes.

**Sources:** https://web.dev/articles/maskable-icon

## background_color and theme_color

`background_color` fills the splash and pre-CSS window; `theme_color` tints the Android status bar, task switcher and desktop title bars. Both = the page surface: no launch flash, bars that look like the app.

```html
<!-- manifest: "background_color": "#121212", "theme_color": "#121212" -->
<!-- inline in <head>, before the CSS bundle, so first paint matches the splash -->
<style>html, body { background: #121212; }</style> <!-- both, so overscroll shows it too -->
```

**Support:** `background_color`: Chromium desktop · Chrome Android (splash) · Firefox Android; Safari: no. `theme_color`: Chromium desktop · Chrome Android · Safari macOS 17+ (web-app title bar) · Safari iOS 15+ · Firefox Android.

**Gotchas:**
- The manifest can't vary by scheme (`user_preferences.color_scheme` never shipped): use the default theme, override with [meta theme-color](#meta-theme-color-per-scheme-and-theme).
- Android 12+ shows the icon in a circle on `background_color`: check contrast.
- Changes reach installed apps only on the next manifest update.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Customize_your_app_colors

## meta theme-color per scheme and theme

`<meta name="theme-color">` overrides the manifest per page, at runtime, per OS scheme via `media`. Bars that follow the app's theme look native; a dark bar over a light app looks broken.

```ts
// <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
// <meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)">
/** With an in-app theme toggle: call after every change; one tag, set to the real surface. */
export function syncThemeColor(): void {
  const color = getComputedStyle(document.body).backgroundColor;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = color;
  document.head.append(meta);
}
```

**Support:** Chromium desktop 73+: installed apps only · Chrome Android: browser UI too (with system dark mode only when installed or a TWA) · Safari 15+; from Safari 26 (macOS and iOS) installed web apps only · Firefox: ignored.

**Gotchas:**
- `media` follows only the OS scheme; an in-app toggle needs the sync. Whole dark-mode strategy: [navigation-ui-patterns.md](navigation-ui-patterns.md#dark-mode-follow-the-system-allow-a-manual-override-keep-theme-color-in-sync-no-flash).
- Update it when a full-screen sheet or dark header opens, as native apps do.
- Safari 26+ tabs tint from edge-hugging fixed elements: [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#safari-26-toolbar-tinting-and-full-screen-dims-come-from-edge-hugging-fixedsticky-elements).

**Sources:** https://github.com/mdn/browser-compat-data (html.elements.meta.name.theme-color) · https://webkit.org/blog/17333/webkit-features-in-safari-26-0/

## Detect the installed app

Combine display-mode with iOS's `navigator.standalone` and watch for changes (installing can move a running page into a window). Wrong answers put install nags inside the app.

```ts
// Add '(display-mode: fullscreen)' only if your manifest uses it: Chromium matches it for F11 too.
const APP_MODES = '(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)';

export const isInstalledLaunch = (): boolean =>
  matchMedia(APP_MODES).matches || navigator.standalone === true; // iOS/iPadOS home-screen app

export function watchDisplayMode(cb: (installed: boolean) => void): () => void {
  const mq = matchMedia(APP_MODES);
  const h = () => cb(isInstalledLaunch());
  mq.addEventListener('change', h);
  return () => mq.removeEventListener('change', h);
}
```

**Support:** `display-mode`: Chromium 42+ · Chrome Android 42+ · Safari macOS 13+ · Safari iOS 12.2+ (partial, below) · Firefox 47+ (desktop never `standalone`; Windows taskbar apps `minimal-ui` from 142). `navigator.standalone`: Safari iOS/iPadOS only.

**Gotchas:**
- WebKit bug 264218 (BCD): an iOS home-screen app with `display: standalone` matches `fullscreen`, not `standalone`. `navigator.standalone` is the reliable iOS signal.
- Field-tested: testing only `display-mode: standalone` misses iOS, `minimal-ui` and WCO windows.
- A tab can't know the app is installed elsewhere; Android can ask ([Related apps](#related-applications)).

**Sources:** https://github.com/mdn/browser-compat-data (css.at-rules.media.display-mode)

## App icon badge (Badging API)

`setAppBadge(n)` / `clearAppBadge()` badge the installed app's icon (Dock, taskbar, home screen) from the page or worker: one of the clearest "real app" signals.

```ts
export function setBadge(count: number): void {
  if (!('setAppBadge' in navigator)) return; // Firefox, Chrome Android
  const done = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  done.catch(() => { /* not installed or no permission: expected */ });
}
// setAppBadge() with no argument = dot. In the worker: self.navigator.setAppBadge(count).
```

**Support:** Chromium desktop 81+ Windows/macOS (ChromeOS 91+, not Linux) · Chrome Android: no (notification dots instead) · Safari macOS 17+ Dock apps · Safari iOS 16.4+: home-screen app only, after notification permission; tab: no · Firefox: no.

**Gotchas:**
- Outside an installed app calls reject or no-op: swallow, never toast. lib.dom types them as always present, so use `in`, not `?.`.
- iOS needs notification permission first ([offline-push-storage.md](offline-push-storage.md#notification-permission-ux-ask-at-the-right-moment-cover-every-state)); Declarative Web Push can set it from the payload ([offline-push-storage.md](offline-push-storage.md#declarative-web-push-safari-184-notifications-without-waking-a-worker)).
- `setAppBadge(0)` clears. Clear on read (also from the worker on `notificationclick`); don't badge non-actionable counts.
- Tabs: favicon/title badges instead ([navigation-ui-patterns.md](navigation-ui-patterns.md#favicon-and-app-icon-badges-reflect-live-state)); not both in an installed app.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Display_badge_on_app_icon

## Richer install dialog (description and screenshots)

With `description` and a screenshot for the current form factor, Chromium shows a store-style install sheet instead of the small prompt, so installing feels like getting an app.

```json
{
  "description": "Shared lists and notes that work offline.",
  "screenshots": [
    { "src": "shots/phone.png", "sizes": "1080x1920", "type": "image/png", "form_factor": "narrow", "label": "A shopping list" },
    { "src": "shots/desktop.png", "sizes": "1920x1080", "type": "image/png", "form_factor": "wide", "label": "Lists with the sidebar open" }
  ]
}
```

**Support:** Chromium desktop 108+ (only `wide` from 109) · Chrome Android 94+ · Safari, Firefox: ignored. Stores and PWABuilder read screenshots too.

**Gotchas:**
- 320–3840 px per side, long side ≤ 2.3x short, one aspect ratio per form factor, PNG/JPEG, up to 8 shown; description cut at ~324 characters.
- `label` is the alt text. Exclude screenshots from precache.

**Sources:** https://web.dev/patterns/web-apps/richer-install-ui

## App shortcuts

`shortcuts` adds actions to the icon's context menu: Android long-press, Windows jump list, macOS Dock and File menu, ChromeOS shelf: a native-app hallmark.

```json
{
  "shortcuts": [
    { "name": "New message", "short_name": "New", "url": "./?action=compose",
      "icons": [{ "src": "shortcut-compose-96.png", "sizes": "96x96", "type": "image/png" }] },
    { "name": "Mentions", "url": "./?action=mentions" }
  ]
}
```

On boot, read `action`, route, then `history.replaceState` without it so a reload doesn't repeat it.

**Support:** Chromium desktop 96+ (Windows only in 85–95) · Chrome Android 84+ · Safari macOS 17.4+ (Dock and File menu; users can bind keys in System Settings) · Safari iOS, Firefox: no.

**Gotchas:**
- URLs in scope; most important first (Android shows ~4); 96x96 PNG icons.
- Changes land on the next manifest update; localize with `shortcuts_localized` ([Localized](#localized-manifest-members)).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts · https://webkit.org/blog/15063/webkit-features-in-safari-17-4/

## Share target

`share_target` puts the installed app in the OS share sheet: text/URLs by GET, files by POST multipart caught in the service worker. "Share to MyApp" is integration no website has.

```json
{
  "share_target": {
    "action": "./share-target", "method": "POST", "enctype": "multipart/form-data",
    "params": { "title": "title", "text": "text", "url": "url",
                "files": [{ "name": "files", "accept": ["image/*", "video/*", "application/pdf"] }] }
  }
}
```

```ts
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;
const text = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

self.addEventListener('fetch', (event) => {
  const share = new URL('./share-target', self.registration.scope).pathname;
  if (event.request.method !== 'POST' || new URL(event.request.url).pathname !== share) return;
  event.respondWith((async () => {
    const form = await event.request.formData(); // untrusted: validate type and size before use
    const inbox = await caches.open('share-inbox');
    await inbox.put('meta', Response.json({ title: text(form.get('title')), text: text(form.get('text')), url: text(form.get('url')) }));
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    await Promise.all(files.map((f, i) => inbox.put(`file-${i}`, new Response(f, { headers: { 'content-type': f.type } }))));
    return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
  })());
});
export {};
```

**Support:** Chrome Android 76+ installed (Samsung 12+) · Chromium desktop 89+ (BCD): ChromeOS, and the Windows Share dialog per Microsoft docs; macOS/Linux unverified · Safari: no · Firefox: parses, no effect.

**Gotchas:**
- Installed apps only. POST needs an active worker before the first share; text-only GET needs none.
- Sources often put the URL in `text`: extract it. Validate every field and file.
- On cold start the page collects the stash after the redirect; add [launch_handler](#single-instance-launches-launch_handler) so shares land in the open window.
- Sharing out: [device-apis.md](device-apis.md#web-share-api-navigatorshare--canshare-including-files).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target · https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/integrate-sharesheet-pwa

## File handlers

`file_handlers` registers the installed desktop app for file types (Finder/Explorer "Open with"); files arrive via `launchQueue` as `FileSystemFileHandle`s. Defining desktop-app behaviour.

```ts
// manifest: "file_handlers": [{ "action": "./open", "accept": { "text/markdown": [".md", ".markdown"] } }]
declare function openDocument(name: string, text: string): void;
// Register on every launch, early (before the UI awaits anything).
window.launchQueue?.setConsumer(async ({ files }) => {
  for (const handle of files) {
    const file = await handle.getFile(); // untrusted: check type and size
    openDocument(file.name, await file.text());
  }
});
```

**Support:** Chromium desktop 102+ (Windows, macOS, Linux, ChromeOS), installed apps · Chrome Android, Safari, Firefox: no.

**Gotchas:**
- `action` in scope; specific types, never `*/*`. The OS asks the user on first open; writing back may prompt.
- Files arrive on the page, not in the worker; with `focus-existing`, in the open window. Keep `<input type="file">` for everyone else. Runtime details: [device-apis.md](device-apis.md#file-handling-manifest-file_handlers--launchqueue-files).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/file_handlers

## Protocol handlers

`protocol_handlers` (manifest) or `registerProtocolHandler` (runtime) route `web+myapp:…` or safelisted schemes like `mailto` to the app, the way native apps take invites and deep links.

```ts
// manifest: "protocol_handlers": [{ "protocol": "web+myapp", "url": "./?link=%s" }]
// Runtime (Chromium desktop, Firefox): https, same origin, contains %s
if ('registerProtocolHandler' in navigator) {
  navigator.registerProtocolHandler('web+myapp', new URL('./?link=%s', location.href).href);
}
/** On boot: the decoded 'web+myapp:...' URL, or null. Untrusted input. */
export function incomingLink(): URL | null {
  const raw = new URL(location.href).searchParams.get('link');
  if (!raw || !URL.canParse(raw)) return null;
  const u = new URL(raw);
  return u.protocol === 'web+myapp:' ? u : null;
}
```

**Support:** manifest: Chromium desktop 96+, installed apps. `registerProtocolHandler`: Chromium desktop (https URLs only since 77) · Firefox desktop and Android · Chrome Android, Safari: no.

**Gotchas:**
- Custom schemes are `web+` plus lowercase ASCII letters unless safelisted (`mailto`, `magnet`, `matrix`, …). The user approves on first use.
- Plain https links into scope are usually better: link capturing plus [launch_handler](#single-instance-launches-launch_handler).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/protocol_handlers

## Single-instance launches (launch_handler)

`client_mode` (`focus-existing`, `navigate-existing`, `navigate-new`, `auto`) decides whether a launch reuses the window. Native chat and mail apps have one window that a link focuses and routes, not a copy that reloads.

```ts
// manifest: "launch_handler": { "client_mode": ["focus-existing", "auto"] }
declare function routeTo(url: URL): void;
window.launchQueue?.setConsumer(({ targetURL }) => {
  if (!targetURL) return;
  const url = new URL(targetURL);
  if (url.origin === location.origin) routeTo(url); // route in place, no reload
});
```

**Support:** `launch_handler`: Chromium desktop 110+ · Chrome Android 110+ per BCD · Safari, Firefox: no. `launchQueue.targetURL`: Chromium desktop 110+ (BCD lists no Android). Link capturing: Chrome 139+ on Windows/macOS/Linux opens in-scope https links in the installed app by default (per-app opt-out; ChromeOS later). Safari macOS 15+ web apps open in-scope links clicked in other apps.

**Gotchas:**
- `focus-existing` doesn't navigate: consume `targetURL` or the click looks ignored. `navigate-existing` reloads and loses state.
- Test clicking your link from email or chat with the app installed.
- Notification clicks: [offline-push-storage.md](offline-push-storage.md#notificationclick-focus-the-open-window-and-route-in-place-or-open-one). Runtime details: [device-apis.md](device-apis.md#launch-handler-single-instance-app-windows--launchqueue).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/launch_handler · https://developer.chrome.com/docs/capabilities/pwa-navigation-management

## scope_extensions (several origins)

Extends scope to origins that opt in via `/.well-known/web-app-origin-association`, so `help.example.com` or a locale domain stays in the app window instead of showing browser UI.

```json
{ "id": "/app/", "scope": "/app/", "scope_extensions": [{ "type": "origin", "origin": "https://help.example.com" }] }
```

The other origin serves `https://help.example.com/.well-known/web-app-origin-association`: `{ "https://example.com/app/": { "scope": "/" } }`.

**Support:** Chromium desktop 138+ · Chrome Android 138+ (Samsung 30+) · Safari, Firefox: no.

**Gotchas:**
- Keyed by the resolved `id`: a wrong id silently breaks it.
- JSON over HTTPS at the origin root (impossible on shared hosts such as GitHub Pages project sites). The same file carries `allow_migration`.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope_extensions

## Localized manifest members

`name_localized`, `short_name_localized`, `description_localized`, `icons_localized` and `shortcuts_localized` map BCP 47 tags to values, so launcher labels match the user's language.

```json
{
  "name": "My App", "lang": "en", "dir": "ltr", "description": "Shared lists and notes.",
  "description_localized": { "de": "Gemeinsame Listen und Notizen.", "fr": "Listes et notes partagées." },
  "short_name_localized": { "ja": { "value": "MyApp", "lang": "en" } }
}
```

**Support:** Chromium desktop 148+ · Chrome Android, Safari, Firefox: no (base members used).

**Gotchas:**
- Most specific tag wins (`fr-CA` falls back to `fr`); values are strings or `{ value, lang, dir }`. Keep base members in your default language.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Localize_an_app_manifest

## Related applications

Declare store apps (or the PWA), ask whether one is installed, and swap "Install" for "Open app" like native smart banners.

```ts
// manifest: "related_applications": [{ "platform": "webapp", "url": "https://example.com/app/manifest.webmanifest" },
//                                    { "platform": "play", "id": "com.example.app" }]
export async function hasInstalledRelatedApp(): Promise<boolean> {
  if (typeof navigator.getInstalledRelatedApps !== 'function') return false;
  const apps: unknown = await navigator.getInstalledRelatedApps();
  return Array.isArray(apps) && apps.length > 0; // validate the shape before trusting it
}
```

**Support:** `getInstalledRelatedApps`: Chrome Android 84+ (PWAs; Android apps via Digital Asset Links) · Chromium desktop 85+: Windows UWP apps only, empty elsewhere · Safari: no (Smart App Banners for App Store apps) · Firefox: no. `related_applications`: Chrome Android, Edge, Samsung.

**Gotchas:**
- `prefer_related_applications: true` makes the PWA uninstallable in Chromium.
- Self-detection works best on Android; don't build desktop logic on it.

**Sources:** https://developer.chrome.com/docs/capabilities/get-installed-related-apps

## Manifest updates and identity migration

Installed apps update from the manifest on the browser's schedule; name/icon changes need review; iOS never updates. Stale icons, duplicates after a URL change and surprise dialogs feel broken.

```json
{
  "id": "/",
  "icons": [{ "src": "icons/pwa-512x512.v2.png", "sizes": "512x512", "type": "image/png" }],
  "migrate_from": [{ "id": "https://www.example.com/social/", "behavior": "suggest" }]
}
```

Version icon filenames when artwork changes. To move origin (the manifest above is on `https://social.example.com/`), the old origin confirms in `https://www.example.com/.well-known/web-app-origin-association`: `{ "https://social.example.com/": { "allow_migration": true } }`.

**Support:** Chromium desktop 144+: non-sensitive members update silently, name/icons wait for user review, icons count as changed only when their URL changes, no daily throttle · Chrome Android: WebAPK re-minted after launch-time checks, confirmation on significant name/icon changes · Safari iOS: frozen at Add to Home Screen · `migrate_from`/`migrate_to`: Chromium desktop 149+ per BCD (Chrome's blog says 150), same-site origins only.

**Gotchas:**
- Never rename the manifest or change `id`. `migrate_from` requires an `id`.
- Permissions don't migrate (re-grant notifications). `"force"` applies only the URL change; name/icon changes follow as a normal review.
- Same-origin id fixes need no `.well-known`; the explainer allows a silent migration (unverified in Chrome).
- Older Chrome docs: a 404ing manifest pauses update checks ~30 days (pre-144; unverified now). Inspect with `chrome://web-app-internals`.

**Sources:** https://developer.chrome.com/blog/improvements-to-web-app-updates · https://developer.chrome.com/blog/seamless-pwa-origin-migration · https://github.com/WICG/manifest-incubations/blob/gh-pages/pwa-migration-explainer.md

## Orientation

Sets an installed Android app's default orientation. A lock that fights the rotation setting or flips upside down feels broken; most apps should omit it.

```json
{ "orientation": "portrait" }
```

**Support:** Chrome Android 39+ · Firefox Android 79+ · desktop browsers, Safari macOS/iOS: ignored. Android 16 ignores locks on screens ≥ 600 dp for apps targeting API 36 (whether WebAPKs do: unverified).

**Gotchas:**
- Chromium maps (source-checked): omitted → `USER` (sensor, respects rotation lock); `portrait` → `SENSOR_PORTRAIT` (can flip upside down); `any` → `FULL_USER` (respects the lock, else all four orientations, including upside-down portrait).
- Design for both orientations on tablets regardless ([viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#orientation-changes-respond-dont-lock)). Runtime `screen.orientation.lock()`: [device-apis.md](device-apis.md#screen-orientation-read-always-lock-only-in-fullscreen-or-installed-apps).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/orientation · https://github.com/chromium/chromium/blob/main/content/public/android/java/src/org/chromium/content/browser/ScreenOrientationProviderImpl.java

## macOS Safari web apps (Add to Dock)

Safari 17+ (Sonoma+) turns any site into a Dock app via File > Add to Dock: own window, Dock icon, Cmd-Tab, notifications, badges.

```html
<!-- Settings > App when isMacSafari() and not installed -->
<p data-testid="install-mac-safari">In Safari, choose <b>File › Add to Dock…</b>, then <b>Add</b>.</p>
```

**Support:** Safari macOS 17+: reads name, icons (or apple-touch-icon), start_url, scope, display, theme_color (title bar), shortcuts (17.4+); Badging and Web Push work; from Safari 18, in-scope links clicked in other apps open in the web app. Detect with `display-mode: standalone`.

**Gotchas:**
- Creation copies the site's cookies (user stays signed in) but not localStorage/IndexedDB, and nothing syncs afterwards: client-side identity starts empty, as on iOS ([Install promotion](#install-promotion-ux)).
- No tabs; out-of-scope links open the default browser; without a manifest, scope is the host. Use `standalone` (`minimal-ui`/`fullscreen` unsupported).

**Sources:** https://developer.apple.com/videos/play/wwdc2023/10120/ · https://webkit.org/blog/15865/webkit-features-in-safari-18-0/

## Google Play (Trusted Web Activity)

A tiny Android wrapper renders the PWA full screen in Chrome; Digital Asset Links prove origin ownership. Store discovery, reviews, restore-safe installs.

```sh
npx @bubblewrap/cli init --manifest https://example.com/app/manifest.webmanifest
npx @bubblewrap/cli build   # -> app-release-bundle.aab (+ signed APK)
# then serve https://example.com/.well-known/assetlinks.json (origin ROOT):
# [{ "relation": ["delegate_permission/common.handle_all_urls"],
#    "target": { "namespace": "android_app", "package_name": "com.example.app",
#                "sha256_cert_fingerprints": ["<Play App Signing key SHA-256>"] } }]
```

**Support:** Android with a TWA-capable browser (Chrome; others with Custom Tabs TWA support). `@bubblewrap/cli` 1.25; PWABuilder generates the same plus Windows and iOS packages.

**Gotchas:**
- With Play App Signing use the Play-managed key's fingerprint, not your upload key, or the URL bar appears.
- `assetlinks.json` at the origin root: a GitHub Pages project site needs a custom domain.
- Digital goods follow Play billing policy. App Store WKWebView wrappers risk minimum-functionality rejection.

**Sources:** https://github.com/GoogleChromeLabs/bubblewrap · https://docs.pwabuilder.com

## Microsoft Store (MSIX)

PWABuilder packages the PWA as an MSIX for Partner Center, no code changes; it then shows in Store and Start search.

```text
1. Partner Center > Apps and games > New product > MSIX or PWA app; copy Package ID, Publisher ID, Publisher display name
2. pwabuilder.com > your URL > Package for stores > Windows > paste the IDs > download (.msixbundle + .classic.appxbundle)
3. Submit in Partner Center
```

**Support:** Windows 10/11. Registration is free for individuals and, since May 2026, companies.

**Gotchas:**
- Store installs capture in-scope links (opt out in `edge://apps`).
- Edge's `widgets` member is niche; `edge_side_panel` is deprecated (July 2026).

**Sources:** https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/microsoft-store · https://blogs.windows.com/windowsdeveloper/2026/05/07/publish-to-microsoft-store-as-a-company-now-with-free-registration-and-faster-onboarding/

## Web Install API and the install element

`navigator.install()` and a browser-rendered `<install>` button replace the `beforeinstallprompt` dance with an Install button that works whenever the browser can install.

```ts
// <install manifest="https://app.example.com/manifest.webmanifest"><a href="https://app.example.com/">Open the app</a></install>
/** Call from a click; fall back to beforeinstallprompt or steps on 'unsupported'. */
export async function installViaWebInstall(): Promise<'installed' | 'cancelled' | 'unsupported'> {
  if (typeof navigator.install !== 'function') return 'unsupported';
  try {
    await navigator.install();
    return 'installed';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    throw e; // NotAllowedError (no activation), DataError (manifest/id problem)
  }
}
```

**Support:** Chromium 154 behind `#web-app-installation-api` (origin trial 143–150); Intent to Ship (Sept 2026) targets desktop ~Chrome 156, Android later · Safari, Firefox: no (positions pending).

**Gotchas:**
- The shape changed during trials (the 148–153 `<install>` trial used `installurl`/`manifestid`): feature-detect, keep fallbacks.
- Needs a manifest `id`. `<install>` fires `installresult` (`success` | `aborted` | `invalid_data`). Permissions-Policy `web-app-installation` gates cross-origin use.

**Sources:** https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/WebInstall/explainer.md · https://github.com/WICG/install-element/blob/main/explainer-manifest-url.md

## Typing the non-standard install APIs

lib.dom (TypeScript 6.0) lacks `beforeinstallprompt`, `navigator.standalone`, `windowControlsOverlay`, `launchQueue`, `getInstalledRelatedApps` and `install`. Declare them optional so every call site feature-detects.

```ts
// pwa-globals.d.ts
export {};
declare global {
  interface LaunchParams { readonly targetURL?: string; readonly files: readonly FileSystemFileHandle[] }
  interface LaunchQueue { setConsumer(consumer: (params: LaunchParams) => void): void }
  interface WindowControlsOverlay extends EventTarget { readonly visible: boolean; getTitlebarAreaRect(): DOMRect }
  interface Window { readonly launchQueue?: LaunchQueue } // Chromium desktop
  interface Navigator {
    readonly standalone?: boolean; // iOS/iPadOS Safari only
    readonly windowControlsOverlay?: WindowControlsOverlay; // Chromium desktop
    getInstalledRelatedApps?(): Promise<unknown>; // validate the result
    install?(): Promise<unknown>; // Web Install API (flagged)
  }
}
```

**Support:** typing only.

**Gotchas:**
- Don't add `beforeinstallprompt` to `WindowEventMap`: it would claim the event on Safari and Firefox. Narrow at runtime ([Install button](#custom-install-button-beforeinstallprompt)).
- Launch params and related-app results are external input: validate.
- When lib.dom ships one of these, delete your declaration (conflicting modifiers fail to compile).

**Sources:** https://github.com/microsoft/TypeScript/blob/main/src/lib/dom.generated.d.ts

## Manifest members to skip

Generators emit platform-locked, deprecated or nonstandard members. Unknown members are ignored, so the cost is wasted effort and false expectations.

```text
note_taking { new_note_url }          ChromeOS only (95+): fine for note apps, invisible elsewhere
"tabbed" display + tab_strip          ChromeOS only (126+); desktop flags removed
edge_side_panel                       Edge sidebar, deprecated July 2026
url_handlers                          removed from Chromium: use scope_extensions + launch_handler
handle_links                          incubation; Chrome 139+ captures links by default anyway
serviceworker                         nonstandard: register the worker in JS
iarc_rating_id, categories, screenshots[].platform   store/catalog metadata only
user_preferences.color_scheme         proposal, not shipped
```

**Support:** as listed (BCD 8.1.4, Edge docs July 2026).

**Gotchas:**
- A generator emitting a member proves nothing: check BCD for your target platforms.

**Sources:** https://github.com/mdn/browser-compat-data (manifests.webapp)

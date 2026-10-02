<!-- verified 2026-10-02: 3 corrections -->
# Platform quirks and testing

What differs per platform (iOS/iPadOS, Android Chrome, Samsung Internet, desktop Chromium, macOS Safari, Firefox) and how to verify native feel. Each platform summary lists its quirks in one line each and links to the file that owns the fix; testing and verification live here in full.
Support as of Oct 2026 (MDN browser-compat-data: Chrome 154, Safari/iOS 27, Firefox 157, Samsung Internet 30). TS compiles under `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

## Checklist

- [ ] **must** — Detect capabilities, never browser brands; treat every iOS browser as WebKit → [Capabilities](#every-ios-browser-is-webkit-detect-capabilities-not-brands)
- [ ] **must** — Detect iPadOS (it reports `Macintosh`) with `maxTouchPoints` → [Capabilities](#every-ios-browser-is-webkit-detect-capabilities-not-brands)
- [ ] **must** — Walk the iOS/iPadOS quirk list before shipping → [iOS](#ios-and-ipados-safari-and-home-screen-apps)
- [ ] **must** — Walk the Android Chrome quirk list (WebAPK, edge-to-edge, back) → [Android](#android-chrome-webapk)
- [ ] **must** — Keep platform decisions in pure functions with injected inputs, unit-tested → [Pure functions](#keep-platform-decisions-in-pure-unit-tested-functions)
- [ ] **must** — Run E2E against the production build (manifest, icons, worker, offline, a11y) → [E2E](#e2e-against-the-production-build)
- [ ] **must** — Run desktop and phone Playwright projects, with real CDP touch for gestures → [Playwright](#playwright-desktop-and-phone-projects-and-real-touch)
- [ ] **must** — Know what emulation can't show, and cover it with unit tests plus devices → [Emulation limits](#what-emulation-cannot-show)
- [ ] **must** — Debug installability in DevTools' Application panel, not Lighthouse → [DevTools](#debug-installability-with-devtools-not-lighthouse)
- [ ] **must** — Debug real Android phones over `chrome://inspect` with port forwarding → [Android debugging](#real-android-phones-chromeinspect-and-chromewebapks)
- [ ] **must** — Use the iOS Simulator and Safari Web Inspector, including Home Screen apps → [iOS debugging](#ios-simulator-and-safari-web-inspector)
- [ ] **must** — Run a fixed real-device checklist before each release → [Device checklist](#real-device-release-checklist)
- [ ] **should** — Walk the Samsung Internet quirk list and test on a Samsung device → [Samsung Internet](#samsung-internet)
- [ ] **should** — Walk the desktop Chromium quirk list (WCO, launch_handler, shortcuts) → [Desktop Chromium](#desktop-chrome-and-edge-installed-apps)
- [ ] **should** — Offer File → Add to Dock on macOS Safari → [macOS Safari](#macos-safari-web-apps-add-to-dock)
- [ ] **should** — Handle Firefox: no install prompt, Windows taskbar web apps, Android shortcuts → [Firefox](#firefox-desktop-web-apps-and-firefox-android)
- [ ] **should** — Test the oldest iOS you support as well as the newest → [iOS debugging](#ios-simulator-and-safari-web-inspector)
- [ ] **should** — Reproduce real platform shapes (a missing method) in E2E, not fake globals → [Pure functions](#keep-platform-decisions-in-pure-unit-tested-functions)
- [ ] **nice** — Simulate freeze with CDP `Page.setWebLifecycleState` → [Emulation limits](#what-emulation-cannot-show)

## Every iOS browser is WebKit: detect capabilities, not brands

On iOS and iPadOS, Chrome, Edge, Firefox, Orion and Safari all render with the system WebKit, so web features ship with iOS updates, not browser updates, and Safari's version equals the iOS version (Safari 26 is iOS 26). "It works in Chrome, so it works in Chrome on iPhone" is wrong: Chrome on iOS has no `beforeinstallprompt`, no Vibration and no Chromium-only APIs. Detect capabilities; UA tokens (`CriOS`, `FxiOS`, `EdgiOS`) say nothing about the engine.

```ts
export const caps = () => ({
  installPrompt: 'onbeforeinstallprompt' in window,
  push: 'PushManager' in window && 'serviceWorker' in navigator,
  notifications: 'Notification' in window, // false in an iOS Safari tab
  vibrate: 'vibrate' in navigator,
  badge: 'setAppBadge' in navigator,
  wakeLock: 'wakeLock' in navigator,
  share: 'share' in navigator,
});

// iPadOS 13+ reports a Mac user agent: check touch points too (pure, so unit-testable)
export const isIos = (ua: string, touchPoints: number): boolean =>
  /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
// isIos(navigator.userAgent, navigator.maxTouchPoints)
```

**Support:** iOS/iPadOS: every browser uses WebKit. In the EU, from iOS 17.4, Apple allows alternative engines (BrowserEngineKit), and MDN notes such browsers apply their own storage policies; whether any major browser ships a non-WebKit engine there today is (unverified), so treat iOS as WebKit everywhere. Chromium desktop, Chrome Android, Safari macOS and Firefox: not applicable.

**Gotchas:**
- EU DMA history: the iOS 17.4 betas turned EU Home Screen web apps into plain bookmarks; Apple reversed this before release (March 2024), and EU web apps still run standalone.
- New features reach users only when they update iOS: check how many of your users run older iOS versions.
- Safari Technology Preview on the Mac is not iOS; desktop WebKit in Playwright is not iOS Safari either.
- Use UA checks only for wording of hints (which menu to point at), never to gate features.

**Sources:** https://github.com/mdn/browser-compat-data/blob/main/browsers/safari_ios.json, https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria

## iOS and iPadOS (Safari and Home Screen apps)

The platform with the most quirks. A Home Screen web app (iOS 16.4+ can install from Safari, Chrome, Edge, Firefox and Orion via Share → Add to Home Screen) behaves differently from a Safari tab, and much of what makes an app feel native exists only there.

```ts
declare global { interface Navigator { readonly standalone?: boolean } } // iOS only, non-standard
// In an installed iOS app with display: standalone, (display-mode: standalone) is FALSE and fullscreen is TRUE
export const iosInstalled = (): boolean =>
  navigator.standalone === true || matchMedia('(display-mode: fullscreen)').matches;
```

Quirk list (fix lives in the linked file):
- No `beforeinstallprompt`: explain Share → Add to Home Screen yourself → [install-and-identity.md](install-and-identity.md#ios-and-ipados-detection-and-add-to-home-screen-steps)
- From Safari 26, every site added to the Home Screen opens as a web app by default ("Open as Web App" toggle, per WebKit's Safari 26 notes); what Safari 27 changed here is (unverified) → [install-and-identity.md](install-and-identity.md#install-paths-per-browser)
- `(display-mode: standalone)` is false in an installed app with `display: standalone`; `(display-mode: fullscreen)` is true (WebKit bug 264218); `minimal-ui` is never true. Combine with `navigator.standalone` → [install-and-identity.md](install-and-identity.md#detect-the-installed-app)
- A Home Screen app has its own cookies and storage, separate from Safari; deleting the icon deletes its data; users land logged out on first launch → [offline-push-storage.md](offline-push-storage.md#ios-home-screen-apps-have-their-own-storage-onboard-inside-the-app)
- No link capturing: links from mail or chat open Safari, not the app. Prefer typed one-time codes or passkeys to magic links → [offline-push-storage.md](offline-push-storage.md#ios-home-screen-apps-have-their-own-storage-onboard-inside-the-app)
- With tracking prevention, Safari deletes script-written storage after 7 days of Safari use without interaction; Home Screen apps keep their own day count → [offline-push-storage.md](offline-push-storage.md#survive-safaris-7-day-eviction-of-script-written-storage)
- Push, Notification and Badging exist only in Home Screen apps (16.4+), never in a tab (`window.Notification` is undefined), and only from a gesture → [offline-push-storage.md](offline-push-storage.md#web-push-subscription-vapid-user-gesture-uservisibleonly)
- Declarative Web Push (`window.pushManager`, Safari 18.4) shows notifications without a service worker → [offline-push-storage.md](offline-push-storage.md#declarative-web-push-safari-184-notifications-without-waking-a-worker)
- A Safari-tab worker registration may lack `getNotifications()`: feature-check every optional method → [offline-push-storage.md](offline-push-storage.md#show-notifications-through-the-worker-registration-with-a-page-fallback)
- Badging needs notification permission on iOS → [install-and-identity.md](install-and-identity.md#app-icon-badge-badging-api)
- Status bar via `apple-mobile-web-app-status-bar-style`; `black-translucent` draws under it, so pad with safe areas → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#ios-home-screen-status-bar-defaultblack-vs-black-translucent)
- From Safari 26, `theme-color` is used only by installed web apps; Safari tints its toolbars from edge-hugging page elements → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#safari-26-toolbar-tinting-and-full-screen-dims-come-from-edge-hugging-fixedsticky-elements)
- Home Screen icon comes from `apple-touch-icon` (manifest icons only without it, `purpose` any); transparent pixels turn black; don't pre-round → [install-and-identity.md](install-and-identity.md#apple-touch-icon)
- No splash from the manifest: ship `apple-touch-startup-image` per device or users see a blank launch → [install-and-identity.md](install-and-identity.md#ios-launch-screens-apple-touch-startup-image)
- The keyboard pans the visual viewport instead of resizing; `interactive-widget` is ignored → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#ios-keyboard-size-and-move-the-shell-to-the-visual-viewport-only-while-a-keyboard-is-up)
- An installed app's visual viewport can be short by the status bar: use CSS `100%` when no keyboard is up → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#dynamic-viewport-units-svh--lvh--dvh-and-the-100vh-bug)
- `position: fixed` follows the layout viewport, which iOS doesn't shrink for the keyboard → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#positionfixed--sticky-with-the-ios-keyboard-and-the-ios-26-regressions)
- Fields under 16px zoom on focus; never "fix" it with `maximum-scale` → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#stop-ios-focus-zoom-16px-form-fields-on-coarse-pointers-only)
- `overscroll-behavior` is partial in Safari: a non-scrolling root can still rubber-band; lock the shell → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#overscroll-behavior-no-page-rubber-band-no-accidental-pull-to-refresh-no-scroll-chaining)
- Standalone apps have no reload button: offer an in-app refresh and update toast → [offline-push-storage.md](offline-push-storage.md#update-flow-waiting-worker-prompt-skip_waiting-message-reload-once)
- Sticky `:hover` after taps, gray tap flash, long-press callout and label selection → [touch-gestures-input.md](touch-gestures-input.md)
- `contextmenu` is not reliably fired for a touch long-press: build long-press from pointer events and a timer → [touch-gestures-input.md](touch-gestures-input.md)
- No Vibration API; the `<input type=checkbox switch>` haptic trick is undocumented → [touch-gestures-input.md](touch-gestures-input.md)
- Audio needs a gesture to unlock; an `AudioContext` can be suspended or interrupted after backgrounding; `navigator.audioSession` (16.4+) picks the session type → [touch-gestures-input.md](touch-gestures-input.md)
- Video needs `playsinline` or it jumps to the native player → [device-apis.md](device-apis.md)
- Edge swipes are Safari's history back/forward and can't be cancelled; whether standalone apps offer swipe-back is (unverified), so always render an in-app back button → [navigation-ui-patterns.md](navigation-ui-patterns.md)
- No `CloseWatcher` (Technology Preview only); Navigation API from Safari 26.2 → [navigation-ui-patterns.md](navigation-ui-patterns.md)
- Fullscreen API on iPad only (16.4+, with an overlay button you can't hide); iPhone fullscreens only `<video>`; no orientation lock → [device-apis.md](device-apis.md)
- Screen Wake Lock is broken in Home Screen apps from 16.4 to 18.3, fixed in 18.4 (WebKit bug 254545) → [device-apis.md](device-apis.md)
- Camera/mic permission in Home Screen apps has historically been asked again per launch; whether current iOS still does is (unverified) → [device-apis.md](device-apis.md)
- `window.open` does nothing when `target` is unset or `_blank` (BCD); out-of-scope and cross-origin OAuth navigations open an in-app Safari sheet or Safari → [install-and-identity.md](install-and-identity.md#start_url-and-scope)
- iOS web apps can't be share targets: offer paste, upload and drag-and-drop → [install-and-identity.md](install-and-identity.md#share-target)
- JavaScript freezes soon after backgrounding; sockets die (sometimes still `OPEN`); only push runs in the background → [offline-push-storage.md](offline-push-storage.md#resume-from-background-reconnect-resync-refresh)
- The icon and name appear to be snapshotted when the app is added, so users may need to re-add to see a new icon (unverified)

**Support:** Safari/iOS 27 is current. Home Screen install from third-party iOS browsers: iOS 16.4+. Web Push in Home Screen apps: iOS 16.4+ (not in WKWebView or SFSafariViewController).

**Gotchas:**
- Safe-area insets are 0 in desktop browsers and Playwright: everything in this list needs a device or the Simulator.
- iPadOS with a trackpad has both coarse and fine pointers: decide UI with media queries and listen for `change`.

**Sources:** https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json, https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/, https://webkit.org/blog/17333/webkit-features-in-safari-26-0/

## Android Chrome (WebAPK)

Chrome on devices with Google Mobile Services (GMS) mints a WebAPK when the app is installed: a real launcher, switcher and Settings entry with intent filters for share target and shortcuts. Every other Android browser, and Chrome without GMS, adds a browser-badged shortcut instead.

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="theme-color" content="#161614">
```

Quirk list:
- Installability: `name`/`short_name`, 192px and 512px icons, `start_url`, `display` (or `display_override`), HTTPS; a service worker is no longer required → [install-and-identity.md](install-and-identity.md#install-paths-per-browser)
- Set manifest `id` from day one: changing it creates a different app → [install-and-identity.md](install-and-identity.md#manifest-id)
- WebAPK updates are checked on launch, at most daily, when key members change; icon, name and shortcut changes arrive then → [install-and-identity.md](install-and-identity.md#manifest-updates-and-identity-migration)
- `beforeinstallprompt` exists: capture it and show your own button; `preventDefault()` hides the mini-infobar → [install-and-identity.md](install-and-identity.md#custom-install-button-beforeinstallprompt)
- The richer install dialog with `description` and `screenshots` → [install-and-identity.md](install-and-identity.md#richer-install-dialog-description-and-screenshots)
- Launchers crop icons: ship a separate `maskable` icon, never `"any maskable"` on one file → [install-and-identity.md](install-and-identity.md#icons-from-one-svg-maskable-done-right)
- Splash is built from `name`, `background_color` and an icon → [install-and-identity.md](install-and-identity.md#background_color-and-theme_color)
- `theme-color` tints the status bar; I found no web API that colors the navigation bar on its own (unverified) → [install-and-identity.md](install-and-identity.md#meta-theme-color-per-scheme-and-theme)
- From Chrome 135, `viewport-fit=cover` goes edge-to-edge: the bottom inset is non-zero on many phones → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#android-edge-to-edge-safe-area-max-inset--for-stable-bottom-bars)
- `interactive-widget=resizes-content` makes the keyboard resize the layout (Chrome Android 108); VirtualKeyboard is the opt-in alternative → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#know-the-three-keyboard-resize-behaviors-per-platform)
- Pull-to-refresh on the root: stop it with `overscroll-behavior` → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#overscroll-behavior-no-page-rubber-band-no-accidental-pull-to-refresh-no-scroll-chaining)
- System back calls `history.back()` and exits the app on the first entry: close sheets first with `CloseWatcher`/`<dialog>` → [navigation-ui-patterns.md](navigation-ui-patterns.md)
- Gesture navigation (Android 10+) takes back swipes from both screen edges before the page sees them → [touch-gestures-input.md](touch-gestures-input.md)
- Vibration works after a user gesture → [touch-gestures-input.md](touch-gestures-input.md)
- Long-press shortcuts (Chrome Android 84) → [install-and-identity.md](install-and-identity.md#app-shortcuts); share target (Chrome Android 76) → [install-and-identity.md](install-and-identity.md#share-target)
- Screen Orientation lock works, in fullscreen or an installed app → [device-apis.md](device-apis.md)
- `clients.openWindow()` may open inside an existing standalone app (Chrome 51+) → [offline-push-storage.md](offline-push-storage.md#notificationclick-focus-the-open-window-and-route-in-place-or-open-one)
- No Badging API: Android shows notification dots instead → [install-and-identity.md](install-and-identity.md#app-icon-badge-badging-api)
- Out-of-scope navigations show a Custom-Tab-style bar → [install-and-identity.md](install-and-identity.md#start_url-and-scope)
- Play Store: wrap as a Trusted Web Activity and prove ownership with `/.well-known/assetlinks.json` → [install-and-identity.md](install-and-identity.md#google-play-trusted-web-activity)
- Background Sync and Periodic Background Sync (installed only) exist here → [offline-push-storage.md](offline-push-storage.md#periodic-background-sync-chromium-installed-apps-only)

**Support:** Chrome Android 154 is current. WebAPK: Chrome on GMS devices. `beforeinstallprompt`: Chrome 44+ (`onbeforeinstallprompt` from 61). `appinstalled`: Chrome Android 57.

**Gotchas:**
- Firefox, Edge and Opera on Android create badged shortcuts, not WebAPKs (MDN).
- A Pixel descriptor in Playwright is not a WebAPK and not Samsung Internet.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable, https://developer.chrome.com/blog/webapk-update-frequency, https://github.com/mdn/browser-compat-data/blob/main/html/elements/meta.json

## Samsung Internet

Samsung Internet (v30, May 2026) is Chromium-based but lags Chrome's engine. It mints WebAPKs on Samsung devices, supports `beforeinstallprompt` and push, and adds its own features (a dark mode, content blockers, "Add page to"). It has a large share of Android users, and its quirks can undo careful polish.

```html
<meta name="color-scheme" content="light dark">
```

```css
@media (prefers-color-scheme: dark) { :root { --surface-page: #161614; } }
/* (hover: hover) misreports on some Samsung devices: always pair it with a fine pointer */
@media (hover: hover) and (pointer: fine) { .row:hover .actions { opacity: 1; } }
```

**Support:** WebAPK on Samsung devices (MDN). `beforeinstallprompt` 5.0+ (`onbeforeinstallprompt` from 8.0). `theme-color` 6.2. Notifications only through the service worker. Current version 30.0 (BCD).

**Gotchas:**
- Its dark mode may restyle pages that don't declare dark support (current behavior unverified): ship a real dark theme and declare `color-scheme` → [navigation-ui-patterns.md](navigation-ui-patterns.md).
- `(hover: hover)` may match on some Samsung devices (crbug 41445959) → [touch-gestures-input.md](touch-gestures-input.md).
- Check its Chromium version before using new Chromium APIs, and feature-detect.
- Test on a real Samsung device with Samsung Internet at least once per release.

**Sources:** https://github.com/mdn/browser-compat-data/blob/main/browsers/samsunginternet_android.json, https://github.com/mdn/browser-compat-data/blob/main/api/BeforeInstallPromptEvent.json

## Desktop Chrome and Edge installed apps

Chromium desktop installs any manifest app into its own window, and offers the most OS integration: a custom title bar, file and protocol handlers, single-instance launches, badges and shortcuts. Installed apps share the browser profile's storage with its tabs.

```ts
// Cmd on Apple platforms, Ctrl elsewhere; Cmd/Ctrl+K is not taken by browsers
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
const onKey = (e: KeyboardEvent): void => {
  if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openQuickSwitcher(); }
};
addEventListener('keydown', onKey);
declare function openQuickSwitcher(): void;
```

Quirk list:
- Window Controls Overlay replaces the tall title bar; buttons sit right on Windows and left on macOS; users can toggle it off → [install-and-identity.md](install-and-identity.md#window-controls-overlay)
- `launch_handler` `focus-existing` does not navigate: consume `launchQueue` yourself → [install-and-identity.md](install-and-identity.md#single-instance-launches-launch_handler)
- `file_handlers` (Chrome 102) and `protocol_handlers` (Chrome 96) are desktop-only → [install-and-identity.md](install-and-identity.md#file-handlers), [install-and-identity.md](install-and-identity.md#protocol-handlers)
- `tabbed` display mode: Chrome 126 per BCD, ChromeOS-first; check each OS → [install-and-identity.md](install-and-identity.md#display-mode-and-display_override)
- Badging on Windows and macOS (Chrome 81), ChromeOS 91; not Linux → [install-and-identity.md](install-and-identity.md#app-icon-badge-badging-api)
- `scope_extensions` (Chrome 138) and `migrate_from` (Chrome 149) → [install-and-identity.md](install-and-identity.md#scope_extensions-several-origins), [install-and-identity.md](install-and-identity.md#manifest-updates-and-identity-migration)
- `navigator.install()` is behind `#web-app-installation-api` in Chrome 154: don't ship on it → [install-and-identity.md](install-and-identity.md#web-install-api-and-the-install-element)
- Link capturing is a user setting; out-of-scope links show an origin bar or open a tab → [install-and-identity.md](install-and-identity.md#start_url-and-scope)
- Run-on-login is a user toggle in the browser's app settings; there is no web API for it (UI location unverified)
- `theme-color` is used only in installed apps; `theme_color` also colors the WCO controls area → [install-and-identity.md](install-and-identity.md#background_color-and-theme_color)
- Browser-reserved shortcuts can't be overridden in tabs and some still go to the browser in app windows: avoid Cmd/Ctrl+W, Q, N, T, Tab, Shift+T, L and R → [touch-gestures-input.md](touch-gestures-input.md)
- Keyboard Lock (`navigator.keyboard.lock`, Chrome 68) works only in JS-initiated fullscreen; for games and remote desktops only → [device-apis.md](device-apis.md)
- The browser remembers each app window's size and position; design for windows down to about 320px wide → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#large-screens-list-detail-split-view-by-width-not-device)

**Support:** Chrome/Edge desktop on Windows, macOS, Linux and ChromeOS. Not applicable to Safari or Firefox, which have their own models (below).

**Gotchas:**
- Users can pop a tab out into an app window and back: listen for `change` on the `display-mode` queries.
- Alt combos on Windows can open menus, and Option on macOS types characters. Use `e.code` for physical-position shortcuts and `e.key` for letters, and show shortcuts with platform glyphs.
- Firefox lets `resizeTo`/`moveTo` work only on windows created by `window.open`.

**Sources:** https://github.com/mdn/browser-compat-data/blob/main/manifests/webapp/launch_handler.json, https://github.com/mdn/browser-compat-data/blob/main/api/WindowControlsOverlay.json, https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock

## macOS Safari web apps (Add to Dock)

Since macOS 14 Sonoma and Safari 17, any site can be added to the Dock (File → Add to Dock). It gets its own window, storage, notifications and badge, and Safari honors manifest `display`, `scope`, `start_url`, `theme_color`, `icons` and `id`. Safari never prompts, so a hint at the right moment makes it discoverable.

```ts
// Hint heuristic only: never gate features on it. maxTouchPoints rules out iPads reporting Macintosh.
export const isMacSafari = (ua: string, touchPoints: number): boolean =>
  /Macintosh/.test(ua) && touchPoints === 0 && /Version\/\d+.*Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
```

Quirk list:
- Install steps and hint copy → [install-and-identity.md](install-and-identity.md#macos-safari-web-apps-add-to-dock)
- Storage is separate from Safari; per WebKit, Safari copies the site's cookies into the new web app when it is created (unverified here), and nothing is shared afterwards → [offline-push-storage.md](offline-push-storage.md#ios-home-screen-apps-have-their-own-storage-onboard-inside-the-app)
- Shortcuts from Safari 17.4; Badging from 17; Push since Safari 16 on Ventura (tabs too) → [install-and-identity.md](install-and-identity.md#app-shortcuts)
- `(display-mode: minimal-ui)` is never true; in a browser window `browser` is always true, even in macOS Full Screen or with the Fullscreen API → [install-and-identity.md](install-and-identity.md#detect-the-installed-app)
- Web apps have no tabs, and out-of-scope links open in the default browser → [install-and-identity.md](install-and-identity.md#start_url-and-scope)

**Support:** Safari 17+ on macOS 14+. Safari 26/27 on current macOS.

**Gotchas:**
- Chrome and Edge on macOS also put "Safari" in their UA: exclude their tokens as above.
- Feature-detect real capabilities; the UA check only chooses which instructions to show.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable, https://github.com/mdn/browser-compat-data/blob/main/manifests/webapp/display.json, https://github.com/mdn/browser-compat-data/blob/main/manifests/webapp/shortcuts.json

## Firefox: desktop web apps and Firefox Android

Firefox desktop doesn't install manifest PWAs. Its "Web apps" feature (Taskbar Tabs in the source) pins a simplified, site-styled window to the taskbar, reading the manifest for icon and start URL; it deliberately still looks like a browser. Firefox Android installs manifest apps as badged home-screen shortcuts that honor `display: standalone`. Detect both so Firefox users don't see an install button that can't work.

```ts
// No beforeinstallprompt anywhere in Firefox: show menu instructions instead
const firefoxTaskbarApp = (): boolean => matchMedia('(display-mode: minimal-ui)').matches; // Windows, Firefox 142+
// Android: menu → Add to Home screen / Install; (display-mode: standalone) works from Firefox Android 116
```

Quirk list:
- No `beforeinstallprompt`, no `share_target` (Android parses it, with no effect), no WebAPK → [install-and-identity.md](install-and-identity.md#install-paths-per-browser)
- Desktop `(display-mode: standalone)` is never true; `minimal-ui` is true for apps pinned to the Windows taskbar from Firefox 142; in Firefox's Full Screen UI `(display-mode: fullscreen)` is true with tabs still shown → [install-and-identity.md](install-and-identity.md#detect-the-installed-app)
- No `theme-color` support → [install-and-identity.md](install-and-identity.md#meta-theme-color-per-scheme-and-theme)
- `Notification.requestPermission()` outside a gesture is denied (Firefox 72+) → [offline-push-storage.md](offline-push-storage.md#notification-permission-ux-ask-at-the-right-moment-cover-every-state)
- `navigator.storage.persist()` shows a prompt: ask after meaningful engagement → [offline-push-storage.md](offline-push-storage.md#request-persistent-storage-and-show-usage)
- Firefox desktop needs the browser running to receive push → [offline-push-storage.md](offline-push-storage.md#web-push-subscription-vapid-user-gesture-uservisibleonly)
- `navigator.share` is behind a flag on desktop; Firefox Android has it (79) → [device-apis.md](device-apis.md)
- Android: `navigator.vibrate` exists and returns `true` but never vibrates; desktop removed it in 129 → [touch-gestures-input.md](touch-gestures-input.md)
- Android: `interactive-widget` from Firefox Android 133 → [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#know-the-three-keyboard-resize-behaviors-per-platform)
- `CloseWatcher` from 149, Navigation API from 147 → [navigation-ui-patterns.md](navigation-ui-patterns.md)
- Screen Orientation `lock()` works from Firefox 144 → [device-apis.md](device-apis.md)
- No Badging API, no Window Controls Overlay, no `launch_handler`, `file_handlers` or `protocol_handlers` manifest members

**Support:** Taskbar web apps: Windows (on by default), Linux (off by default, behind `browser.taskbarTabs.enabled`), not macOS (Firefox source docs). BCD dates the `minimal-ui` behavior to Firefox 142; the release that first enabled the feature by default (142 or 143) is (unverified). Firefox Android: `display` standalone 47, `display-mode` 116.

**Gotchas:**
- Taskbar web apps share the profile, extensions and cookies with the browser, are tied to the container they were created in, and are not restored with the session.
- MDN still says Firefox doesn't install PWAs via the manifest, which is consistent with this.

**Sources:** https://raw.githubusercontent.com/mozilla-firefox/firefox/main/browser/components/taskbartabs/docs/index.md, https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json, https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable

## Keep platform decisions in pure, unit-tested functions

Keyboards, safe areas, visibility and iOS standalone mode can't be reproduced in CI. Put every decision that depends on device state (keyboard viewport math, gesture thresholds, which install path to show, whether the worker can notify, standalone and iPadOS detection) in pure functions with injected inputs, and wire them to events in thin glue code. Then the exact edge cases (pinch zoom, a hardware keyboard bar, a missing API) are tested on every commit.

```ts
import { expect, test } from 'vitest';
import { isIos } from './platform';
import { viewportVars } from './viewport';
import { notifiesThroughWorker } from './sw-logic';

test('iOS keyboard up: fit and follow the pan', () => {
  expect(viewportVars(844, { height: 500, scale: 1, pageTop: 120 }))
    .toEqual({ '--app-height': '500px', '--app-top': '120px', '--safe-bottom': '0px' });
});
test('a toolbar change is not a keyboard', () => {
  expect(viewportVars(844, { height: 790, scale: 1, pageTop: 0 })['--app-height']).toBeNull();
});
test('a pinch-zoomed page is not moved', () => {
  expect(viewportVars(844, { height: 250, scale: 2, pageTop: 300 })['--app-top']).toBe('0px');
});
test('a Safari-tab registration cannot notify', () => {
  expect(notifiesThroughWorker({ showNotification: () => undefined })).toBe(false);
});
test('iPadOS reports a Mac', () => {
  expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
});
```

**Support:** Any unit runner (Vitest, Jest). For gesture math, property tests (fast-check with a fixed seed) catch threshold edge cases reproducibly.

**Gotchas:**
- Don't "test" platform behavior by faking `document.hidden` or `matchMedia` globally: that tests the fake. Keep the untestable branch to one line with a coverage-ignore and a reason.
- The glue that stays untested must be tiny, and covered by the device checklist. A service worker should only wire a tested decision module to events.
- Exception: reproduce a real platform shape in E2E when it caused a bug, for example delete `getNotifications` from the registration prototype in `addInitScript` to mimic a Safari tab.
- The `viewportVars` and `notifiesThroughWorker` helpers are defined in [viewport-keyboard-safe-areas.md](viewport-keyboard-safe-areas.md#ios-keyboard-size-and-move-the-shell-to-the-visual-viewport-only-while-a-keyboard-is-up) and [offline-push-storage.md](offline-push-storage.md#test-the-worker-pure-decision-module-plus-e2e-against-the-production-build).

**Sources:** https://vitest.dev/api/, https://fast-check.dev/docs/configuration/user-definable-values/

## E2E against the production build

The service worker and manifest exist only in the built app, so E2E must run against the production build served the way it ships (`vite preview` or any static server, with the real base path). Assert the install surface and an offline start, and run axe and an HTML validator on every screen. An installed app that won't start offline, has a 404 icon or ships a regressed worker is broken for every installed user at once, and dev-server tests never see it.

```ts
import { expect, test } from '@playwright/test';
// playwright.config.ts → webServer: { command: 'vite build && vite preview --port 4173 --strictPort', reuseExistingServer: false }

test('is installable', async ({ page }) => {
  await page.goto('./');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const res = await page.request.get(new URL(href ?? '', page.url()).href);
  expect(await res.json()).toMatchObject({
    display: 'standalone',
    icons: expect.arrayContaining([expect.objectContaining({ sizes: '512x512', purpose: 'maskable' })]),
  });
});

test('starts offline', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // the worker controls the page only after a reload (unless it calls clients.claim())
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('main')).toBeVisible();
});
```

**Support:** Playwright Chromium projects support service workers, offline (`context.setOffline`) and permissions. Notifications need `context.grantPermissions(['notifications'])`. Firefox and WebKit projects run too, but they are desktop engines.

**Gotchas:**
- `reuseExistingServer: false` so you never test a stale build.
- Fetch every manifest icon and assert a 200 and the right size.
- Assert notifications through `registration.getNotifications()`, and test the path where that method is missing (Safari tabs).
- axe's `meta-viewport` rule fails `maximum-scale` or `user-scalable=no`: run it on every screen, phone project included.
- Keep unit/integration and E2E as separate commands.

**Sources:** https://playwright.dev/docs/test-webserver, https://playwright.dev/docs/service-workers, https://playwright.dev/docs/api/class-browsercontext#browser-context-set-offline

## Playwright: desktop and phone projects, and real touch

Run a desktop project and a phone project (`isMobile`, `hasTouch`, viewport, `deviceScaleFactor`, coarse pointer) so CI catches hover-only UI, coarse-pointer layouts and touch gestures. Drive gestures with CDP `Input.dispatchTouchEvent` so the browser itself decides scroll vs swipe vs long-press; synthetic `dispatchEvent` touches skip that.

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ }, // isMobile + hasTouch
  ],
});
```

```ts
import type { Page } from '@playwright/test';

// A real finger: touchStart → touchMove → touchEnd through the browser's input pipeline (Chromium only)
export async function swipe(page: Page, x: number, y: number, dx: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
```

**Support:** `isMobile` (Chromium only; not supported in Firefox) honors the meta viewport and enables touch events. `hasTouch`, `deviceScaleFactor`, `colorScheme`, `reducedMotion`, `forcedColors`, `contrast`, `offline` and `permissions` are context options. `serviceWorkers: 'allow'` (default) or `'block'`. CDP sessions are Chromium-only.

**Gotchas:**
- If service-worker notifications must actually show, use the full Chromium build (`channel: 'chromium'`, the new headless) rather than the headless shell.
- Add intermediate `touchMove` steps for gestures that measure velocity.
- Never press a button that calls `navigator.share` in headless: it brings headless Chromium down on macOS. Test the `canShare` guard and fallback instead.
- See [What emulation cannot show](#what-emulation-cannot-show) before trusting a green phone run.

**Sources:** https://playwright.dev/docs/emulation, https://playwright.dev/docs/api/class-cdpsession, https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchTouchEvent

## What emulation cannot show

Device Mode and Playwright emulate a viewport, a pointer type and touch; they don't emulate the operating system around the page. Knowing the gaps tells you which checks need unit tests on pure functions and which need devices.

```ts
import type { Page } from '@playwright/test';

// Chromium only, experimental: freeze a page to exercise freeze/resume handlers (visibility doesn't change)
export async function freeze(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await cdp.detach();
}
```

**Support:** Applies to Chrome DevTools Device Mode and Playwright on every engine.

**Gotchas:**
- No on-screen keyboard and no visualViewport panning: cover keyboard math with unit tests and devices.
- `env(safe-area-inset-*)` is 0: notch, home indicator and gesture pill bugs only show on devices.
- `display-mode` can't be emulated with `emulateMedia`, and Device Mode doesn't emulate mobile install, standalone display or the splash.
- Headless pages are always visible: the "app went to the background" path can't be E2E-tested.
- Playwright's WebKit project is desktop WebKit, not iOS Safari; the Pixel descriptor is not Samsung Internet or a WebAPK.
- Edge swipes starting under about 24px pass in emulation but belong to the OS on real phones.
- No real push delivery, no system share sheet, no haptics, no camera or microphone hardware.

**Sources:** https://playwright.dev/docs/emulation, https://developer.chrome.com/docs/devtools/device-mode, https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-setWebLifecycleState

## Debug installability with DevTools, not Lighthouse

Chrome DevTools' Application panel is the reference for the manifest, installability, the service worker, storage and background services. Lighthouse 12 removed the PWA category, so there is no PWA score to chase any more. Most "doesn't feel native" bugs (wrong icons, an uninstallable manifest, a stale worker, a quota problem) are invisible until you look here.

```text
Application > Manifest        Installability errors, Identity, Presentation, Icons
                              ("Show only the minimum safe area for maskable icons"), Shortcuts, Screenshots,
                              protocol handler test
Application > Service workers Update on reload, Bypass for network, Offline, Push / Sync / Periodic sync test events
Application > Storage         Usage, Clear site data, simulate a custom storage quota
Background services           Record Push, Notifications, Background sync / fetch
```

**Support:** Chrome and Edge DevTools on every desktop OS. Lighthouse 12.0 (2024) removed the PWA category after Chrome's installability criteria changed.

**Gotchas:**
- Device Mode doesn't emulate mobile install (the install button stays the desktop one), safe areas, the keyboard or standalone display.
- `chrome://web-app-internals` shows desktop installed-app state in recent Chrome (unverified).
- Instead of the old Lighthouse badge, use the Manifest pane, your own E2E assertions or PWABuilder's report.

**Sources:** https://developer.chrome.com/docs/devtools/progressive-web-apps, https://github.com/GoogleChrome/lighthouse/blob/main/changelog.md

## Real Android phones: chrome://inspect and chrome://webapks

Remote debugging connects a real Android phone to desktop DevTools. Port forwarding lets the phone load your local production build as `localhost`, which is a secure context, so the service worker and install work without HTTPS certificates.

```text
1. Phone: Settings > Developer options > USB debugging ON, connect by USB
2. Desktop Chrome: chrome://inspect/#devices > Port forwarding: 4173 → localhost:4173
3. Phone Chrome: open http://localhost:4173/ → inspect it from the desktop
4. Phone Chrome: chrome://webapks lists minted WebAPKs and their update state
```

**Support:** Chrome Android with desktop Chrome or Edge. Samsung Internet supports remote debugging too (enable it in its own settings; exact steps unverified).

**Gotchas:**
- A LAN IP (`http://192.168.x.y`) is not a secure context: use port forwarding, a tunnel, or a locally trusted certificate installed on the device.
- Test a Google Mobile Services phone (WebAPK) and a Samsung phone with Samsung Internet; they install differently.

**Sources:** https://developer.chrome.com/docs/devtools/remote-debugging, https://developer.chrome.com/docs/devtools/remote-debugging/local-server

## iOS Simulator and Safari Web Inspector

The Xcode iOS Simulator and real iPhones and iPads, inspected with Safari's Web Inspector, reach what emulation can't: the keyboard, safe areas, standalone mode, the splash and edge gestures. Web Inspector also lists Home Screen web apps, not just Safari tabs.

```sh
# Simulator (macOS + Xcode): localhost is a secure context, so service worker and install work
xcrun simctl openurl booted http://localhost:4173/
# Then Safari > Develop > <Simulator or iPhone> > the page (Home Screen apps are listed too)
# Real device: Settings > Apps > Safari > Advanced > Web Inspector ON; connect by cable or network
```

**Support:** Simulator: macOS with Xcode. Web Inspector covers iOS Safari tabs and Home Screen apps from a Mac. Web Push in the Simulator is (unverified): use a real device for push.

**Gotchas:**
- The Simulator doesn't reproduce every real-device behavior (performance, some permissions, possibly push).
- Test the oldest iOS you support as well as the newest (Safari/iOS 27 now): features follow the iOS version.
- A real device on the LAN needs HTTPS: a tunnel or a locally trusted certificate.
- On older iOS the Web Inspector toggle lives under Settings > Safari > Advanced.

**Sources:** https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios, https://developer.apple.com/documentation/xcode/running-your-app-in-simulator-or-on-a-device

## Real-device release checklist

Native feel is judged on exactly what CI can't run. Keep a fixed checklist in the repository, run it before each release on a device matrix, and record which items each release actually ran.

```md
Devices: iPhone, iPad, Pixel (GMS, WebAPK), Samsung phone + Samsung Internet,
Windows Chrome/Edge app, macOS Safari Dock app, Firefox (Windows taskbar app, Android)

- [ ] Install from each browser: icon, name, splash, first paint without a white flash
- [ ] Status bar, notch, home indicator, gesture pill: light and dark, portrait and landscape
- [ ] Focus the composer: no zoom, sits on the keyboard, no gap, fixed overlays follow
- [ ] Background for 5+ minutes, reopen: reconnects, catches up, no stale "connected"
- [ ] Push with the app closed; tap opens the right screen in the existing window; badge count
- [ ] Long-press, swipes, Android back closes sheets first, edge swipes vs the system
- [ ] Links leaving scope and the OAuth return; share in and out; offline cold start; update toast → reload
- [ ] VoiceOver and TalkBack pass; pinch zoom still works
```

**Support:** Every platform; this is the only place iOS standalone, real keyboards, push and system gestures get verified.

**Gotchas:**
- First launch of an installed iOS or macOS Safari app has empty storage: check onboarding there, not in the tab.
- Repeat camera/microphone permission flows in an installed iOS app, and design copy that survives a second prompt.
- Change one thing per run of a failing item, and turn every device-found bug into a pure-function unit test when you can.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable, https://developer.chrome.com/docs/devtools/progressive-web-apps

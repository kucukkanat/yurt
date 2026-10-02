# manifest.webmanifest: field-by-field notes

Companion to `manifest.webmanifest` (JSON has no comments, so the explanations live here). Copy the JSON, change every
value that names your app, delete the optional members you don't use, and serve the file as
`application/manifest+json` from a URL that never changes. Support data: MDN browser-compat-data 8.1.4 (2026-10-01),
web.dev, WebKit and Chrome release notes.

## Identity (required)

| Field | What to put | Notes |
|---|---|---|
| `id` | The app's path on its origin, e.g. `"/myapp/"` | The permanent identity. Resolved against the **origin** of `start_url`, not the manifest URL, so `"./"` means the origin root and collides with every other app on a shared host (GitHub Pages project sites). Changing it later creates a second app and orphans installs. Chrome/Edge 96+, Safari 16.4+. |
| `name` | Full name | Install dialog, window title, app switcher. |
| `short_name` | 12 characters or fewer | Home-screen label; longer names get truncated. |
| `description` | One or two sentences | Chromium's rich install dialog shows about 7 lines (~324 characters). |
| `lang`, `dir` | `"en"`, `"ltr"` | Metadata; keep the base members in your default language. `*_localized` variants (`name_localized`, …) exist in Chrome/Edge 148+ desktop only. |
| `start_url` | `"./"` (inside `scope`) | What the icon opens. Resolves against the manifest URL. Precache it so launch works offline. Add analytics parameters (`./?source=pwa`) only after `id` is set, or the identity changes with them. |
| `scope` | `"./"` | Which URLs count as "the app". Navigating outside it brings back browser UI (URL bar on Android/desktop, an in-app Safari sheet on iOS). Trailing slash matters: `/app` also matches `/apple`. Must sit inside the service worker's scope, or the installed app launches uncontrolled (no offline, no notification routing). |
| `categories` | e.g. `["productivity"]` | Store and catalog metadata only. |

## Window

| Field | What to put | Notes |
|---|---|---|
| `display` | `"standalone"` | Always set it: Safari and Firefox read only `display`. iOS supports `standalone` and `browser` only (no `minimal-ui`/`fullscreen`). iOS Web Push needs a non-browser display. |
| `display_override` | `["window-controls-overlay", "standalone"]` | Chromium 89+ only; tried in order before `display`. `window-controls-overlay` (Chrome/Edge 105+ desktop) gives the title bar to the page: keep it **only** if your top bar uses the WCO rules in `native.css` (`.app-header` padding from `env(titlebar-area-*)`, `app-region: drag`), otherwise drop it. Users can toggle the overlay off, so the layout must work both ways. `tabbed` is ChromeOS-only. |
| `orientation` | (omitted) | Usually leave it out: Android then follows the sensor and the user's rotation lock. `"any"` allows upside-down portrait on phones; `"portrait"` locks phones (Android 16 ignores locks on screens ≥600dp). iOS and desktop ignore it. WCAG 1.3.4 forbids locking unless essential. |

## Colours

| Field | What to put | Notes |
|---|---|---|
| `background_color` | Your page background (default theme) | Splash screen and the window before CSS loads. Must equal the CSS page surface or launch flashes. Android 12+ shows the icon in a circle on it: check contrast. |
| `theme_color` | Same colour | Android status bar, task switcher, installed desktop title bar, iOS installed app (Safari 15+; from Safari 26 only installed apps). The manifest can't vary by colour scheme (`user_preferences` is unshipped): runtime `<meta name="theme-color">` (head.html) overrides it per scheme. |

## Icons

| Entry | Notes |
|---|---|
| 64, 192, 512 PNG, `purpose: "any"` | Chromium's install criteria need 192 **and** 512. Give every icon a `type`. Use PNG (SVG manifest icons aren't reliably used for Android WebAPKs). |
| 512 PNG, `purpose: "maskable"` | Separate file, opaque full-bleed background, artwork inside the central circle of 80% diameter. Never one file as `"any maskable"` (too padded or clipped). Preview at maskable.app. Used by Chrome Android (adaptive icons) and ChromeOS. |
| 512 PNG, `purpose: "monochrome"` | Optional future-proofing: alpha channel used as a mask; no documented visible use in current browsers. |
| iOS | Uses `apple-touch-icon` (head.html) first; without it, manifest icons with purpose `any` (iOS 15.4+). |

When artwork changes, change the icon **file names** (`pwa-512x512.v2.png`): Chrome desktop no longer compares
bitmaps. Name and icon changes ask the user to confirm on Chrome; iOS never updates a home-screen icon.

## Richer install dialog

`screenshots`: Chromium shows an app-store-style sheet when there is a `description` and at least one screenshot for
the current form factor. Chrome Android and Chrome/Edge desktop; desktop shows only `"wide"`. Rules: 320 to 3840 px per
side, long side at most 2.3x the short side, same aspect ratio within a form factor, PNG or JPEG, up to 8 shown,
`label` is the alt text. Exclude screenshots from the service worker precache.

## OS integration (delete what you don't use)

| Field | Notes |
|---|---|
| `shortcuts` | Icon long-press / right-click / Dock menu quick actions: Chrome Android 84+, Chrome/Edge desktop 96+, Samsung 14+, Safari macOS 17.4+. Not iOS or Firefox. URLs must be in scope. Launchers show about 4: most important first. 96x96 PNG icons for Android. On boot, read the query (`?action=new`), route, then `history.replaceState` to clean the URL. |
| `share_target` | Appear in the OS share sheet. The template uses **GET** with `action: "./"`: the browser replaces the action URL's query with `?title=…&text=…&url=…`, so check `URLSearchParams` for those keys on boot (many sources put the URL in `text`). No service worker needed. For files, use `"method": "POST", "enctype": "multipart/form-data"`, a `"files": [{ "name": "files", "accept": ["image/*"] }]` param and a service-worker route that reads `request.formData()`, stores the files (Cache or IndexedDB) and answers `Response.redirect(…, 303)`. Chrome Android 76+, Samsung 12+; desktop mainly ChromeOS. Not Safari or Firefox. Installed apps only. Treat shared data as untrusted input. |
| `launch_handler` | `{"client_mode": ["focus-existing", "auto"]}`: icon, shortcut, captured-link and file launches reuse the open window instead of spawning a second copy. `focus-existing` does **not** navigate: consume `launchQueue.targetURL` (install.ts `consumeLaunches`) or the click looks ignored. Chrome/Edge 110+, Samsung 21+. Chrome desktop 139+ also captures clicks on in-scope links into the installed app by default; test what happens when a user clicks your link in mail or chat. |
| `handle_links` | `"preferred"`: incubation; harmless elsewhere. `launch_handler` is the shipped control and Chrome captures links by default anyway. |

## Optional handlers (delete unless you need them)

| Field | Notes |
|---|---|
| `protocol_handlers` | Own a `web+myapp:` scheme (invites, deep links). The link arrives as `?link=web%2Bmyapp%3A…`: parse and validate it. Chrome/Edge 96+ desktop. Runtime alternative that also works in Firefox: `navigator.registerProtocolHandler('web+myapp', new URL('./?link=%s', location.href).href)`. Not Safari. Custom schemes need the `web+` prefix and lowercase letters. Plain https links into your scope plus `launch_handler` usually serve better. |
| `file_handlers` | "Open with My App" for file types on desktop. Files arrive as `FileSystemFileHandle`s through `launchQueue` (call `setConsumer` early on every launch). The `action` must be in scope; the first open asks the user to allow the association. Chrome/Edge 102+ desktop. Not Android, Safari or Firefox. |

## Members to skip

`prefer_related_applications: true` (makes the PWA uninstallable in Chromium), `serviceworker` (register in JS),
`url_handlers` (removed), `edge_side_panel` (deprecated July 2026), `note_taking` and `tab_strip` (ChromeOS only),
`iarc_rating_id` (store metadata). `related_applications` only if you ship a native app too. `scope_extensions`
(Chrome/Edge 138+) only for one app across several origins, with `/.well-known/web-app-origin-association` on each.

## Serving and testing

- Link it from every page: `<link rel="manifest" href="manifest.webmanifest">` (head.html).
- Never rename or move the file, and keep `id` fixed forever. If it 404s, Chrome may stop checking for updates for
  about 30 days.
- Relative URLs (`start_url`, `scope`, icons, shortcuts) resolve against the manifest URL; `id` resolves against the
  origin.
- Chromium promotes install when: HTTPS (or localhost), name or short_name, 192 and 512 icons, start_url, a
  standalone-like display, no `prefer_related_applications`, not already installed, and some engagement. A service
  worker is no longer required (Chrome 108 Android, 112 desktop). Safari has no requirements (Add to Home Screen, Add
  to Dock).
- Check DevTools > Application > Manifest (computed App Id, installability, WCO emulation) and
  `chrome://web-app-internals`. Lighthouse no longer has a PWA category.

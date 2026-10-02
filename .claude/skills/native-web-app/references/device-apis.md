<!-- verified 2026-10-02: 25 corrections -->
# Device and OS integration APIs

The runtime capability catalogue: what a web app can ask of the OS (share sheet, clipboard, passkeys, media controls,
wake lock, sensors, files, hardware) and how to ask so it works on the first tap, the way native buttons do.
Support is as of Oct 2026 (MDN browser-compat-data 8.1.4: Chrome 154, Safari 27, Firefox 157). Many of these APIs are
missing from TS's `lib.dom`; snippets declare the minimal shape they use with `const w: Window & { api?: Shape } = window`
instead of lying casts, and keep the feature detection.

## Checklist

- [ ] **must** — Call every gated API synchronously from the tap; fetch data before it → [User activation](#user-activation-transient-vs-sticky)
- [ ] **must** — Ask for permissions in context, from a tap, after your own explainer → [Permission UX](#permission-ux-ask-in-context-never-on-load)
- [ ] **must** — Read permission state with the Permissions API to pick the right UI → [Permissions API](#permissions-api-query-state-and-watch-for-changes)
- [ ] **must** — Use the system share sheet with a copy-link fallback → [Web Share](#web-share-navigatorshare-and-canshare-including-files)
- [ ] **must** — Copy with the async Clipboard API; take pasted files from the paste event → [Clipboard](#async-clipboard-api-and-the-paste-event)
- [ ] **must** — Use `<input type=file accept capture>` for photos and the camera → [File input](#input-typefile-accept-capture-for-camera-photos-and-files)
- [ ] **must** — Offer passkeys in autofill, upgrade password users automatically → [Passkeys](#passkeys-conditional-mediation-getclientcapabilities-automatic-upgrade)
- [ ] **must** — Mark code fields `autocomplete="one-time-code"`, add WebOTP on Android → [One-time codes](#one-time-codes-one-time-code-autofill-and-webotp)
- [ ] **must** — Set Media Session metadata and handlers (and call actions) → [Media Session](#media-session-lock-screen-controls-and-call-actions)
- [ ] **should** — Set the Audio Session type so UI sounds don't stop the user's music → [Audio Session](#audio-session-api-mix-duck-or-own-the-audio)
- [ ] **should** — Hold a screen wake lock only during the activity; re-acquire on return → [Wake Lock](#screen-wake-lock-re-acquire-on-visibilitychange)
- [ ] **should** — Offer Picture-in-Picture for video and call video → [PiP](#picture-in-picture-for-video-including-call-video)
- [ ] **should** — Use fullscreen for immersive viewers only; know the iPhone limit → [Fullscreen](#fullscreen-api-and-the-iphone-limits)
- [ ] **should** — Accept dropped files and folders; never let a missed drop navigate away → [Drag and drop](#drag-and-drop-files-in-with-folder-support)
- [ ] **should** — Save back to files with File System Access, download as fallback → [File System Access](#file-system-access-pickers-with-fallbacks)
- [ ] **should** — Start the right camera, mirror selfies, `playsinline`, stop tracks → [Camera](#camera-via-getusermedia-facingmode-playsinline-mirroring-torch)
- [ ] **should** — Ask for location from an explicit action, coarse first → [Geolocation](#geolocation-and-the-geolocation-element)
- [ ] **should** — Route `launchQueue` targets in the existing window → [launchQueue](#handling-launches-launchqueue-for-urls)
- [ ] **should** — Offer wallet checkout with Payment Request → [Payments](#payment-request-api-apple-pay-and-google-pay)
- [ ] **should** — Add dictation and read-aloud where they help → [Web Speech](#web-speech-dictation-and-text-to-speech)
- [ ] **should** — Share screens with CaptureController and contentHint (desktop) → [Screen capture](#screen-capture-getdisplaymedia-with-capturecontroller-and-contenthint)
- [ ] **should** — Adapt to Save-Data; don't build on battery level → [Network Information](#network-information-save-data-and-battery-status-dont)
- [ ] **nice** — Pop call controls or a mini player into Document PiP → [Document PiP](#document-picture-in-picture-always-on-top-html)
- [ ] **nice** — Read orientation everywhere; lock only in fullscreen games → [Orientation](#screen-orientation-read-always-lock-only-in-fullscreen)
- [ ] **nice** — Gate motion sensors behind requestPermission from a tap → [Motion sensors](#deviceorientation-devicemotion-and-generic-sensors)
- [ ] **nice** — Open files from the OS through `launchQueue` files → [File Handling](#opening-files-from-the-os-launchqueue-files)
- [ ] **nice** — Register a `web+` protocol handler at runtime → [Protocol handlers](#protocol-handlers-at-runtime-registerprotocolhandler)
- [ ] **nice** — Use FedCM / Digital Credentials for browser-drawn sign-in sheets → [FedCM](#fedcm-login-status-and-digital-credentials)
- [ ] **nice** — Invite through the OS contact picker (Chrome Android) → [Contact Picker](#contact-picker-api)
- [ ] **nice** — Scan QR codes with BarcodeDetector, WASM as fallback → [Barcode](#barcode-detection-api)
- [ ] **nice** — Add a system eyedropper to colour pickers → [EyeDropper](#eyedropper-api)
- [ ] **nice** — Offer opt-in auto-away with Idle Detection → [Idle Detection](#idle-detection-api)
- [ ] **nice** — Place windows on the other monitor → [Window Management](#window-management-api-multi-screen)
- [ ] **nice** — Read NFC tags on Android → [Web NFC](#web-nfc-ndefreader)
- [ ] **nice** — Talk to devices via Bluetooth/USB/Serial/HID choosers → [Hardware](#hardware-web-bluetooth-webusb-web-serial-webhid)
- [ ] **nice** — Shed load under CPU pressure → [Compute Pressure](#compute-pressure-api)
- [ ] **nice** — List installed fonts in design tools → [Local fonts](#local-font-access)
- [ ] **nice** — Capture keys in fullscreen games; label shortcuts per layout → [Keyboard](#keyboard-lock-and-keyboard-map)
- [ ] **nice** — Request storage access inside your embedded iframe → [Storage Access](#storage-access-api-embedded-iframes)

## Owned elsewhere

These overlap this domain; they are written in full in their owner file.

- Badging API (`setAppBadge`) → see [install-and-identity.md#app-icon-badge-badging-api](install-and-identity.md#app-icon-badge-badging-api)
- Share target (`share_target`) → see [install-and-identity.md#share-target](install-and-identity.md#share-target)
- Manifest `launch_handler`, `file_handlers`, `protocol_handlers` → see [install-and-identity.md#single-instance-launches-launch_handler](install-and-identity.md#single-instance-launches-launch_handler), [#file-handlers](install-and-identity.md#file-handlers), [#protocol-handlers](install-and-identity.md#protocol-handlers)
- Manifest `orientation` → see [install-and-identity.md#orientation](install-and-identity.md#orientation)
- Notifications through the service worker, actions, tag, click routing → see [offline-push-storage.md#show-notifications-through-the-worker-registration-with-a-page-fallback](offline-push-storage.md#show-notifications-through-the-worker-registration-with-a-page-fallback) and [#notificationclick](offline-push-storage.md#notificationclick-focus-the-open-window-and-route-in-place-or-open-one)
- Page Visibility, pagehide/pageshow, bfcache → see [offline-push-storage.md#page-lifecycle-save-on-hidden-not-on-unload](offline-push-storage.md#page-lifecycle-save-on-hidden-not-on-unload)
- Web Locks + BroadcastChannel leader election → see [offline-push-storage.md#multi-tab-coordination-web-locks-plus-broadcastchannel](offline-push-storage.md#multi-tab-coordination-web-locks-plus-broadcastchannel)
- online/offline events and `navigator.onLine` → see [offline-push-storage.md#onlineoffline-detection-beyond-navigatoronline](offline-push-storage.md#onlineoffline-detection-beyond-navigatoronline)
- OPFS → see [offline-push-storage.md#origin-private-file-system-opfs-for-large-or-binary-data-and-sqlite](offline-push-storage.md#origin-private-file-system-opfs-for-large-or-binary-data-and-sqlite)
- CloseWatcher, `<dialog closedby>`, the Navigation API → see [navigation-ui-patterns.md](navigation-ui-patterns.md)
- Haptics (`navigator.vibrate`, the iOS switch trick) and unlocking audio in the first gesture → see [touch-gestures-input.md](touch-gestures-input.md)

## User activation (transient vs sticky)

Many native-feeling APIs only work during *transient activation*: a short window after a trusted `keydown`, `mousedown`,
`pointerdown` (mouse), `pointerup` (touch/pen) or `touchend`. Some consume it; others need only *sticky* activation
(the user has interacted once). Missing activation is the top cause of "the share/copy/fullscreen button does nothing on
iPhone"; design every tap flow around it.

```ts
declare const url: string, prefetched: { blob: Blob | null };
document.querySelector('#share')?.addEventListener('click', () => {
  void navigator.share({ url }); // the gated call comes first, synchronously
  // `await fetch()` and THEN share -> NotAllowedError (Safari especially). Fetch before the tap instead.
});
document.querySelector('#copy-image')?.addEventListener('click', () => {
  if (prefetched.blob) void navigator.clipboard.write([new ClipboardItem({ [prefetched.blob.type]: prefetched.blob })]);
});
export const mayAutoplay = (): boolean => navigator.userActivation?.hasBeenActive === true; // sticky
```

**Support:** gating applies in every browser. `navigator.userActivation`: Chrome 72, Safari 16.4 (macOS and iOS), Firefox
120. Transient activation is required by (MDN list) `navigator.share`, clipboard read/write, `requestFullscreen`,
`requestPictureInPicture`, `documentPictureInPicture.requestWindow`, `show*FilePicker`, `input.showPicker`,
`PaymentRequest.show`, `window.open` popups, `getDisplayMedia`, `EyeDropper.open`, `contacts.select`, `requestStorageAccess`,
`getScreenDetails`, `queryLocalFonts`, `keyboard.lock`, USB/HID/Serial `request*`, `IdleDetector.requestPermission`,
`Clients.openWindow`, `WindowClient.focus`. Sticky activation: `navigator.vibrate`, media/WebAudio autoplay,
`beforeunload` prompts, `VirtualKeyboard.show`.

**Gotchas:**
- On touch, `pointerdown`/`touchstart` do NOT grant activation; only `pointerup`/`touchend` do. A long-press timer firing
  while the finger is down has no activation, so copy/share from it fails: act from the menu item's `click`.
- Safari is strictest: any `await` (network, IndexedDB, crypto) before the gated call can lose activation. Prepare data
  before the tap, or pass a Promise into `ClipboardItem`.
- `window.open` and some others consume activation, so one tap can't chain two consuming calls.
- Esc `keydown` does not grant activation.
- Playwright clicks are trusted, so tests pass where real taps fail; review the order of awaits in code.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/User_activation · https://developer.mozilla.org/en-US/docs/Web/API/UserActivation

## Permission UX: ask in context, never on load

Show your own explainer where the feature lives, trigger the browser prompt only from the user's tap on it, and on
denial show how to re-enable instead of re-prompting. Prompts on load read as spam; Chrome auto-quiets sites with low
accept rates and users block them for good. Chrome also ships browser-drawn permission elements (`<geolocation>`,
`<usermedia>`) that own the prompt and let users recover from an earlier "Block".

```ts
declare const card: HTMLElement, turnOn: HTMLButtonElement, enabledState: () => HTMLElement, howToEnable: () => HTMLElement;
// 1. Render the explainer where the feature lives ("Get a ping when someone mentions you"), not on load.
// 2. Only the tap on "Turn on" triggers the prompt.
turnOn.addEventListener('click', async () => {
  if (!('Notification' in window)) return; // e.g. an iOS Safari tab
  const result = await Notification.requestPermission();
  card.replaceWith(result === 'granted' ? enabledState() : howToEnable()); // 3. denied -> settings steps, never re-prompt
  localStorage.setItem('notif-asked', String(Date.now())); // remember "Not now"; don't nag
});
```

```html
<!-- Capability elements: progressive enhancement; other browsers render the fallback children -->
<geolocation><button type="button">Use my location</button></geolocation>
<usermedia><button type="button">Turn on camera</button></usermedia>
```

**Support:** the pattern is universal. `Notification.requestPermission` requires a user gesture in Firefox 72+ and
Safari. `<geolocation>`: Chrome/Edge 144 (desktop, Android). `<usermedia>`: Chrome/Edge 151 (desktop, Android). Safari
and Firefox have neither.

**Gotchas:**
- Never chain prompts (camera, mic, notifications) in one flow: mic when joining a call, camera when turning video on,
  notifications after the first meaningful interaction.
- On iOS a "Don't Allow" is effectively permanent until the user changes Settings; the explainer matters most there.
- Read state with the Permissions API first and skip the card when already `granted`.
- Capability elements enforce styling (contrast ≥ 3:1, minimum font size, clamped opacity/line-height); at most 3
  `<geolocation>` elements per page.
- Field-tested: call `Notification.requestPermission` only from a user action.

**Sources:** https://web.dev/articles/permissions-best-practices · https://developer.chrome.com/blog/geolocation-html-element · https://developer.chrome.com/blog/usermedia-html-element

## Permissions API: query state and watch for changes

`navigator.permissions.query({ name })` returns a `PermissionStatus` (`granted` / `denied` / `prompt`) with a `change`
event, so a "Notifications: On / Off / Blocked (how to fix)" row stays accurate when the user flips it in browser or OS
settings, without triggering a prompt.

```ts
/** Names differ per browser ('clipboard-read' is Chromium-only); unknown names throw TypeError. */
export async function permission(name: string): Promise<PermissionState | 'unsupported'> {
  if (!('permissions' in navigator)) return 'unsupported';
  try {
    // lib.dom's PermissionName is a short list; the runtime accepts any string and throws on unknown ones
    const status = await navigator.permissions.query({ name } as PermissionDescriptor);
    return status.state;
  } catch {
    return 'unsupported';
  }
}
/** Re-render when the user changes it in settings. Returns an unsubscribe function. */
export async function watchPermission(name: PermissionName, onChange: (s: PermissionState) => void): Promise<() => void> {
  const status = await navigator.permissions?.query({ name }).catch(() => null);
  if (!status) return () => {};
  const emit = () => onChange(status.state);
  emit();
  status.addEventListener('change', emit);
  return () => status.removeEventListener('change', emit);
}
// Chromium needs the extra field for push: query({ name: 'push', userVisibleOnly: true })
```

**Support:** `query()`: Chrome 43, Safari 16 (macOS, iOS), Firefox 46; Android WebView has no Permissions API. Names:
`geolocation` (all); `notifications` (Safari 16.4; Firefox treats it as `push`); `camera`/`microphone` (Chrome 64,
Safari 16, Firefox 132); `screen-wake-lock` (Chrome 84, Safari 16.4, Firefox 126); `push` (Safari 17); `persistent-storage`,
`storage-access`; `clipboard-read`/`clipboard-write`, `local-fonts`, `window-management`, `idle-detection`,
`accelerometer` and others are Chromium-only.

**Gotchas:**
- Always try/catch: an unsupported name throws `TypeError` instead of returning `prompt`.
- `prompt` = you may ask (after explaining). `denied` = show per-browser re-enable steps; never loop prompts.
- Field-tested: `Notification.permission` can lag behind browser settings; read it live via `permissions.query`.
- In an iOS Safari tab `Notification` is undefined; check before querying.
- Some browsers return `prompt` for camera/mic after a one-time "Allow this time".

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query · https://github.com/mdn/browser-compat-data

## Web Share: navigator.share and canShare, including files

Opens the OS share sheet (AirDrop, Messages, WhatsApp, Nearby Share) with `title`, `text`, `url` and `files`. Resolves
when shared; rejects with `AbortError` when dismissed. It replaces home-made "copy link / tweet this" rows, one of the
most obvious web tells on phones.

```ts
declare const toast: (msg: string) => void, copyLink: () => void;
/** System share sheet, or the fallback where there is none. Call straight from the click: no await before it. */
export async function share(data: ShareData, fallback: () => void): Promise<void> {
  if (typeof navigator.share !== 'function' || (navigator.canShare && !navigator.canShare(data))) return fallback();
  try {
    await navigator.share(data);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return; // user closed the sheet
    toast(`Couldn't share: ${e instanceof Error ? e.message : String(e)}`); // NotAllowedError, InvalidStateError, DataError
  }
}
// Files: build the File BEFORE the tap. Chrome allows only image/video/audio/PDF/text types.
const file = new File([new Blob(['hi'])], 'note.txt', { type: 'text/plain' });
document.querySelector('#share-note')?.addEventListener('click', () => void share({ files: [file], title: 'Note' }, copyLink));
```

**Support:** Safari 12.1 macOS / iOS 12.2 (files from 14), tab and home-screen app. Chrome Android 61 (files 76).
Chrome desktop: Windows and ChromeOS since 89, macOS since 128; not Linux. Firefox Android 79 (no files); Firefox
desktop only behind a flag. Android WebView: no. Secure context; iframes need `allow="web-share"`.

**Gotchas:**
- Needs transient activation, which share consumes: no await before it.
- `AbortError` (cancelled) stays silent; anything else gets a message.
- Field-tested: never press Share in headless tests (it has crashed headless Chromium on macOS); test the fallback and
  error mapping instead.
- A second tap while the sheet is open gives `InvalidStateError`.
- Many targets ignore `title`; with both `text` and `url` some concatenate or drop one, so put the link in `url` only.
- `canShare({ files })` is false for disallowed types: check before offering "Share image".
- Desktop sheets are small and OS-dependent; offer "Copy link" alongside.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share · https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare

## Async Clipboard API and the paste event

`navigator.clipboard.writeText/write/readText/read` with `ClipboardItem` for several MIME types; `ClipboardItem.supports()`
checks a type. Pasting uses the plain `paste` event and `clipboardData.files`. One-tap "Copy link" with confirmation,
copying images and pasting screenshots into a composer are native staples.

```ts
declare const toast: (msg: string) => void, attach: (files: File[]) => void, composer: HTMLTextAreaElement;
/** Inside the click; report a refusal instead of swallowing it. */
export const copyText = (text: string): Promise<void> =>
  navigator.clipboard.writeText(text).then(() => toast('Copied'), (e: unknown) => toast(`Couldn't copy: ${String(e)}`));
/** Data still loading: pass a Promise so Safari keeps the gesture (awaiting before write() loses it). */
export function copyImage(url: string): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !ClipboardItem.supports?.('image/png')) return copyText(url);
  const png = fetch(url).then((r) => r.blob()); // must already be image/png; convert other types via canvas first
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
export const copyRich = (html: string, plain: string): Promise<void> =>
  navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([plain], { type: 'text/plain' }),
  })]);
// Paste: no permission and no prompt in any browser.
composer.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) { e.preventDefault(); attach(files); }
});
```

**Support:** `writeText`: Chrome 66, Safari 13.1 / iOS 13.4, Firefox 63. `write` + `ClipboardItem`: Chrome 76 (Android
84), Safari 13.1, Firefox 127. `ClipboardItem.supports`: Chrome 121, Safari 18.4, Firefox 127. `readText`/`read`: Chrome
(permission prompt), Safari (system "Paste" callout the user must tap), Firefox 125 (paste callout unless same-origin
content). `clipboardchange` event: Chrome 144 only.

**Gotchas:**
- Writes need transient activation in Safari and Firefox, and in Chrome unless `clipboard-write` is granted.
- Chrome and Firefox accept only ONE `ClipboardItem` per write; only `image/png` is reliably writable for images.
- "Document is not focused" (`NotAllowedError`) when DevTools or another frame has focus.
- Avoid `read()`: the Safari/Firefox paste callouts feel alien; use the `paste` event / Ctrl/Cmd+V.
- `clipboard-read`/`clipboard-write` permission names exist only in Chromium.
- Copying from a touch long-press timer fails (no activation yet).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API · https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem/supports_static

## input type=file accept capture for camera, photos and files

A plain file input gives the native picker: on iOS a sheet with Photo Library / Take Photo / Choose File, on Android
camera plus files. `capture="environment"` or `"user"` opens the camera directly. For "attach a photo" it beats any
custom camera UI: familiar, no camera permission prompt, full resolution.

```html
<!-- Library, camera or files -->
<label class="attach"><input type="file" accept="image/*,video/*" multiple hidden data-testid="attach">Attach</label>
<!-- "Scan document": straight to the rear camera (phones; desktops ignore capture) -->
<input type="file" accept="image/*" capture="environment">
<!-- Selfie -->
<input type="file" accept="image/*" capture="user">
```

```ts
declare const input: HTMLInputElement, attach: (files: File[]) => void;
input.addEventListener('change', () => attach([...(input.files ?? [])]));
input.addEventListener('cancel', () => { /* picker dismissed */ });
```

**Support:** `accept`/`multiple`: universal. `capture`: Chrome Android 25, iOS Safari 10+ (tab and home-screen app),
Firefox Android 79, Android WebView; desktop browsers ignore it. `cancel` event: Chrome 113, Safari 16.4, Firefox 91.
`webkitdirectory` (folder pick): desktop browsers, iOS 18.4+, Chrome Android 132+, Firefox Android 142+.

**Gotchas:**
- `capture` removes the library/files options: use it only for explicit "take photo" buttons.
- iOS usually transcodes HEIC to JPEG on upload, but check `file.type` and convert when needed.
- Camera photos are huge: downscale with `createImageBitmap` + (Offscreen)Canvas, and strip EXIF GPS.
- Opening the picker may fire `blur`/`visibilitychange` on mobile; don't treat that as leaving.
- A programmatic `input.click()` must happen inside the tap. `change` doesn't fire on cancel; listen to `cancel`.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture · https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/cancel_event

## Drag and drop files (in) with folder support

`dragover`/`dragleave`/`drop` on a drop zone using `DataTransfer.types`, `files` and `items`; `webkitGetAsEntry()` walks
folders. Dropping files from Finder or Explorer is basic desktop-app behaviour; a browser that navigates to `file://`
when you miss the zone is a jarring tell.

```ts
declare const zone: HTMLElement, attach: (files: File[]) => void, toast: (msg: string) => void;
zone.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return; // ignore text/link drags
  e.preventDefault(); // makes it a drop target
  e.dataTransfer.dropEffect = 'copy';
  zone.dataset.dragging = 'true';
});
zone.addEventListener('dragleave', (e) => { if (e.target === zone) delete zone.dataset.dragging; }); // children fire it too
zone.addEventListener('drop', (e) => {
  e.preventDefault();
  delete zone.dataset.dragging;
  // Read synchronously: the DataTransfer is emptied once the handler returns.
  const entries = [...(e.dataTransfer?.items ?? [])].map((i) => i.webkitGetAsEntry()).filter((x) => x !== null);
  const files = [...(e.dataTransfer?.files ?? [])];
  if (entries.some((x) => x.isDirectory)) toast('Folders aren’t supported yet'); // or walk createReader()
  if (files.length) attach(files);
});
// A file dropped beside the zone must not navigate the app away to file://
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
```

**Support:** desktop: universal. iPadOS Safari accepts drops from Files and Photos; phones: very limited.
`webkitGetAsEntry`: Chrome 13, Safari 11.1, Firefox 50 (Android 141). `DataTransferItem.getAsFileSystemHandle`
(writable handles): Chromium 86 desktop, Chrome Android 132.

**Gotchas:**
- React only when `types` includes `'Files'`; clear the dragging state only when the target is the zone itself
  (framework `onDragLeave` flickers over children).
- During `dragover`, `files` is empty (protected mode); only `types` is readable.
- Call `webkitGetAsEntry`/`getAsFileSystemHandle` synchronously in the drop handler.
- Dragging files OUT to the desktop needs the Chromium-only `DownloadURL` data type.
- Show a visible, labelled drop overlay.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop · https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry

## File System Access pickers with fallbacks

Native open/save dialogs returning file handles you can write back to ("Save" instead of "Download copy"). Fallback:
`<input type=file>` plus `<a download>`. Real Save / Save As and no `file(3).json` download spam make a web editor feel
like a desktop app. (OPFS, the private file system available everywhere, is in
[offline-push-storage.md](offline-push-storage.md#origin-private-file-system-opfs-for-large-or-binary-data-and-sqlite).)

```ts
// Full types: npm i -D @types/wicg-file-system-access. Minimal local shapes:
type Picker = {
  showOpenFilePicker?: (o?: { types?: { description?: string; accept: Record<string, string[]> }[]; multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (o?: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
};
const w: Window & Picker = window;
const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'; // picker cancelled
export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: name });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return;
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}
// Open: w.showOpenFilePicker?.({ types: [{ description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.webp'] } }] })
// Else: <input type=file>, listen to 'change' and 'cancel', input.click() inside the same tap.
```

**Support:** `showOpenFilePicker`/`showSaveFilePicker`/`showDirectoryPicker`: Chrome/Edge desktop 86, Chrome Android 132.
Safari and Firefox: none. `FileSystemFileHandle.createWritable`: Chrome 86, Firefox 111, Safari
26 (for OPFS handles).

**Gotchas:**
- Cancel throws `AbortError`: a no-op. Pickers need transient activation.
- Handles stored in IndexedDB survive reloads but need `queryPermission`/`requestPermission({ mode: 'readwrite' })`
  again (Chromium only).
- The `browser-fs-access` library wraps both paths.
- Safari's download fallback saves to Downloads with no dialog.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker · https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable

## Passkeys: conditional mediation, getClientCapabilities, automatic upgrade

Passkeys sign in through the OS credential manager (Face ID, Touch ID, Windows Hello, Google Password Manager).
Conditional mediation lists passkeys in the username field's autofill; conditional create silently adds a passkey right
after a password sign-in. Biometric one-tap sign-in from the autofill bar is how native apps sign in.

```html
<input name="username" autocomplete="username webauthn" autofocus>
<input name="password" type="password" autocomplete="current-password">
```

```ts
// Validate server JSON with your schema library before trusting its shape.
declare const loginOptions: () => Promise<PublicKeyCredentialRequestOptionsJSON>,
  registerOptions: () => Promise<PublicKeyCredentialCreationOptionsJSON>,
  postJson: (url: string, body: unknown) => Promise<unknown>;
let autofill = new AbortController();
export async function passkeyAutofill(): Promise<void> { // on load of the sign-in screen
  const caps = (await PublicKeyCredential.getClientCapabilities?.()) ?? {};
  if (!caps['conditionalGet']) return;
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(await loginOptions());
  try {
    const cred = await navigator.credentials.get({ publicKey, mediation: 'conditional', signal: autofill.signal });
    if (cred instanceof PublicKeyCredential) await postJson('/webauthn/login', cred.toJSON());
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return; // cancelled
    throw e;
  }
}
export async function passkeyButton(): Promise<void> { // explicit button: abort the pending autofill first
  autofill.abort();
  autofill = new AbortController();
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(await loginOptions());
  const cred = await navigator.credentials.get({ publicKey, signal: autofill.signal });
  if (cred instanceof PublicKeyCredential) await postJson('/webauthn/login', cred.toJSON());
}
export async function upgradeToPasskey(): Promise<void> { // right after a successful password sign-in
  const caps = (await PublicKeyCredential.getClientCapabilities?.()) ?? {};
  if (!caps['conditionalCreate']) return;
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(await registerOptions());
  const options: CredentialCreationOptions & { mediation: 'conditional' } = { publicKey, mediation: 'conditional' };
  const cred = await navigator.credentials.create(options).catch(() => null);
  if (cred instanceof PublicKeyCredential) await postJson('/webauthn/register', cred.toJSON());
}
```

**Support:** WebAuthn: all modern browsers. Conditional get: Chrome 108, Safari 16, Firefox 119 (Android WebView: partial,
reports unavailable). `getClientCapabilities`: Chrome 133, Safari 17.4, Firefox 135. `parse*OptionsFromJSON`: Chrome 129, Safari 18.4,
Firefox 119. `signalUnknownCredential`: Chrome 132, Safari 26. Conditional create: Safari 18 (iOS 18 / macOS 15),
Chrome 136 desktop; Chrome Android later per Chrome's docs. iOS: same in tab and home-screen app.

**Gotchas:**
- Start conditional get on load and keep it pending; `webauthn` must be the last `autocomplete` token.
- Abort it before a modal passkey call or the calls collide.
- `NotAllowedError` = cancelled or timed out: stay silent.
- The rpId is a registrable domain: apps on a shared host (e.g. `*.github.io` project pages) should move to their own
  domain before shipping passkeys.
- When the server says a credential is unknown, call `PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })`
  so the OS manager removes it. Use the base64url `id`, not `rawId`.
- Providers may silently decline conditional create; Chrome allows it only shortly after a password-manager sign-in.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential/getClientCapabilities_static · https://developer.chrome.com/docs/identity/webauthn-conditional-create

## One-time codes: one-time-code autofill and WebOTP

Mark the code field `autocomplete="one-time-code"`. With a domain-bound SMS, iOS/macOS offer the code from Messages
(and Mail) above the keyboard, and Android Chrome's WebOTP API reads it with consent. Making users switch apps and
retype the code is a web tell.

```html
<input name="otp" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6">
<!-- SMS body; the last line binds it to your origin (both platforms):
Your code is 123456

@app.example.com #123456 -->
```

```ts
declare const form: HTMLFormElement, input: HTMLInputElement;
if ('OTPCredential' in window) { // Android WebOTP; harmless elsewhere
  const ac = new AbortController();
  form.addEventListener('submit', () => ac.abort(), { once: true });
  const options: CredentialRequestOptions & { otp: { transport: string[] } } = { otp: { transport: ['sms'] }, signal: ac.signal };
  navigator.credentials.get(options).then(
    (c) => { if (c && 'code' in c && typeof c.code === 'string') { input.value = c.code; form.requestSubmit(); } },
    () => {}, // aborted or declined: the user types it
  );
}
```

**Support:** `one-time-code`: Safari iOS 12+ and macOS (domain-bound codes iOS 14+), Chrome/Android autofill. WebOTP
(`OTPCredential`): Chrome Android 84; Chrome desktop 93 (cross-device from a signed-in Android phone). Safari, Firefox:
no WebOTP.

**Gotchas:**
- One real input. Six separate boxes break autofill.
- `inputmode="numeric"`, not `type=number` (strips leading zeros, adds spinners).
- WebOTP shows a consent sheet and only matches the exact origin in the `@domain` line; for iframes use
  `@top.example #code @embedded.example`.
- Clear and refocus on a wrong code. Prefer passkeys; OTP is the fallback.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/WebOTP_API · https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete

## Media Session: lock-screen controls and call actions

`navigator.mediaSession.metadata` (title, artist, artwork), `setActionHandler` (play, pause, seekto, next/previous; for
calls `togglemicrophone`, `togglecamera`, `hangup`), `setPositionState` for the scrubber, and
`setMicrophoneActive`/`setCameraActive` for call state. Without it the lock screen shows "example.com" and the media keys
do nothing.

```ts
declare const audio: HTMLAudioElement, prev: () => void, next: () => void,
  toggleMic: () => void, toggleCam: () => void, leave: () => void;
type Handler = ((d: MediaSessionActionDetails) => void) | null;
type CallSession = MediaSession & { setMicrophoneActive?: (on: boolean) => Promise<void>; setCameraActive?: (on: boolean) => Promise<void> };
/** Unknown actions throw; TS's MediaSessionAction also lacks the call actions, so widen the action type. */
function setAction(action: string, handler: Handler): void {
  const session: { setActionHandler(a: string, h: Handler): void } = navigator.mediaSession;
  try { session.setActionHandler(action, handler); } catch { /* unsupported action */ }
}
if ('mediaSession' in navigator) {
  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Episode 12', artist: 'Example Radio', album: 'Season 2',
    artwork: [{ src: '/art-96.png', sizes: '96x96', type: 'image/png' }, { src: '/art-512.png', sizes: '512x512', type: 'image/png' }],
  });
  setAction('play', () => void audio.play());
  setAction('pause', () => audio.pause());
  setAction('previoustrack', prev);
  setAction('nexttrack', next);
  setAction('seekto', (d) => { if (d.seekTime !== undefined) audio.currentTime = d.seekTime; });
  audio.addEventListener('timeupdate', () => {
    if (Number.isFinite(audio.duration)) {
      navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: audio.currentTime });
    }
  });
  setAction('togglemicrophone', toggleMic); // calls
  setAction('togglecamera', toggleCam);
  setAction('hangup', leave);
}
export function reportCallState(micOn: boolean, camOn: boolean): void {
  if (!('mediaSession' in navigator)) return;
  const s: CallSession = navigator.mediaSession;
  s.setMicrophoneActive?.(micOn).catch(() => {});
  s.setCameraActive?.(camOn).catch(() => {});
}
```

**Support:** Chrome 73 desktop / 57 Android, Safari 15 (macOS, iOS tab and home-screen app), Firefox 82 (Firefox Android
shows no UI). Android WebView: no. `setMicrophoneActive`/`setCameraActive` and `togglemicrophone`/`togglecamera`:
Chrome 93, Safari 18.4. `hangup`: Chrome 93 only (not Safari). `enterpictureinpicture` action (automatic PiP
on tab switch): Chrome 120.

**Gotchas:**
- Lock-screen controls appear only while a real `<audio>`/`<video>` plays; WebAudio-only playback often gets none.
- `setPositionState` throws on NaN/Infinity duration (live streams): guard it.
- Registering `seekbackward`/`seekforward` changes the iOS buttons (±10 s instead of prev/next).
- Artwork: same-origin or CORS-enabled, several sizes.
- For calls, call `setMicrophoneActive` after every mute change so OS indicators match.
- Clear handlers (`setAction(x, null)`) and `metadata = null` when playback or the call ends.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/MediaSession · https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setMicrophoneActive · https://webkit.org/blog/16574/webkit-features-in-safari-18-4/

## Audio Session API: mix, duck or own the audio

`navigator.audioSession.type` is a page-wide hint for how your audio interacts with other apps: `auto`, `playback`,
`transient`, `transient-solo`, `ambient`, `play-and-record`. The default can make a "message received" pop STOP the
user's music on iPhone; `ambient` mixes like native UI sounds, `play-and-record` gives proper call routing.

```ts
type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';
const nav: Navigator & { audioSession?: { type: AudioSessionType } } = navigator; // not in lib.dom
/** One page-wide setting; set it before the audio starts. */
export function setAudioSession(type: AudioSessionType): void {
  if (nav.audioSession) nav.audioSession.type = type;
}
setAudioSession('ambient'); // UI sounds mix with the user's music
export async function startCall(): Promise<MediaStream> {
  setAudioSession('play-and-record'); // before getUserMedia
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
}
export const endCall = (): void => setAudioSession('ambient');
```

**Support:** `navigator.audioSession.type`: Safari 16.4+ macOS and iOS per MDN BCD (practically iOS 17+). `state` and
`statechange`: not in stable browsers. Chrome and Firefox stable: none (feature-detect, no-op).

**Gotchas:**
- One global per page: switch it around the activity (call / podcast / UI sounds) and restore it afterwards.
- `playback` interrupts other apps and plays through the iPhone silent switch; `ambient` mixes and is expected to respect
  it (verify on device). `transient` ducks others for short prompts.
- WebKit infers `play-and-record` during capture, but set it explicitly first to avoid route glitches (earpiece vs
  speaker, Bluetooth).
- A ringtone the user must hear may need `playback` or `transient`; test with music playing and the silent switch on.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type · https://www.w3.org/TR/audio-session/

## Screen Wake Lock: re-acquire on visibilitychange

`navigator.wakeLock.request('screen')` keeps the display on. The browser releases it whenever the page is hidden, so
request it again on return. Calls, recipes, slides and QR codes on screen shouldn't go dark mid-use; the old
looping-invisible-video hack is obsolete.

```ts
let wanted = false;
let sentinel: WakeLockSentinel | null = null;
async function acquire(): Promise<void> {
  if (!('wakeLock' in navigator) || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; }, { once: true });
  } catch { /* NotAllowedError: battery saver, policy, or hidden — carry on */ }
}
/** Keep the screen on while it matters (call, recipe, slides, QR code). */
export async function keepAwake(on: boolean): Promise<void> {
  wanted = on;
  if (on) await acquire();
  else { await sentinel?.release(); sentinel = null; }
}
document.addEventListener('visibilitychange', () => { if (wanted) void acquire(); });
```

**Support:** Chrome/Edge 84 (desktop, Android), Safari 16.4 (macOS, iOS tab), Firefox 126. iOS home-screen apps: broken
from 16.4 until fixed in iOS 18.4 (WebKit bug 254545). Android WebView 84.

**Gotchas:**
- Hold it only while the activity is on screen; release after. Don't request on load: it drains battery.
- Requests fail when hidden, under battery saver or policy: never surface the error loudly.
- Iframes need `Permissions-Policy: screen-wake-lock`.
- There is no system (CPU) wake lock on the web.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API · https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ · https://bugs.webkit.org/show_bug.cgi?id=254545

## Picture-in-Picture for video, including call video

`video.requestPictureInPicture()` floats a `<video>` (a MediaStream from a call too) in an always-on-top OS window.
Safari also has the legacy `webkitSetPresentationMode('picture-in-picture')`. Keep watching, or keep seeing the other
person, while using other apps.

```ts
type SafariVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (m: string) => boolean;
  webkitSetPresentationMode?: (m: string) => void;
};
/** From a click. Works for WebRTC streams too. */
export async function togglePip(video: SafariVideo): Promise<void> {
  if (document.pictureInPictureElement) return document.exitPictureInPicture();
  if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
    await video.requestPictureInPicture();
    return;
  }
  if (video.webkitSupportsPresentationMode?.('picture-in-picture')) video.webkitSetPresentationMode?.('picture-in-picture');
}
// 'enterpictureinpicture' / 'leavepictureinpicture' on the video: swap the inline area for a placeholder
```

**Support:** Chrome 69 desktop / Chrome Android 105. Safari 13.1 macOS / iOS 13.4 per BCD (iPhone PiP since iOS 14; tab
and home-screen app). Firefox 153 desktop (JS API; the built-in PiP toggle came earlier); Firefox Android: no. Android
WebView: no. Chrome 120+: a
`mediaSession` `enterpictureinpicture` handler enables automatic PiP on tab switch for eligible sites.

**Gotchas:**
- Needs user activation (except automatic PiP) and loaded metadata (`readyState >= 1`).
- Only `<video>`; for arbitrary UI use [Document PiP](#document-picture-in-picture-always-on-top-html).
- Register Media Session `hangup`/`togglemicrophone` so Chrome's PiP window shows call controls.
- Respect `disablepictureinpicture` on decorative videos.
- iOS auto-PiP on home swipe works for playing inline (`playsinline`) videos.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API · https://github.com/mdn/browser-compat-data

## Document Picture-in-Picture: always-on-top HTML

`documentPictureInPicture.requestWindow()` opens an always-on-top mini window you fill with your own DOM: call controls,
a timer, a mini chat, a now-playing card. Floating call windows with real buttons are a native desktop convention
video-only PiP can't do.

```ts
type DocPip = {
  requestWindow(o?: { width?: number; height?: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }): Promise<Window>;
  readonly window: Window | null;
};
const w: Window & { documentPictureInPicture?: DocPip } = window;
/** From a click. */
export async function popOut(node: HTMLElement, home: HTMLElement): Promise<boolean> {
  if (!w.documentPictureInPicture) return false;
  const pip = await w.documentPictureInPicture.requestWindow({ width: 360, height: 220 });
  for (const sheet of [...document.styleSheets]) {
    try {
      const style = pip.document.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      pip.document.head.append(style);
    } catch {
      if (!sheet.href) continue; // cross-origin sheet: link it instead
      pip.document.head.append(Object.assign(pip.document.createElement('link'), { rel: 'stylesheet', href: sheet.href }));
    }
  }
  pip.document.body.append(node); // moves the live node; listeners and state survive
  pip.addEventListener('pagehide', () => home.append(node), { once: true });
  return true;
}
```

**Support:** Chrome/Edge 116 desktop, Firefox 151 desktop. Safari: no. Mobile: no.

**Gotchas:**
- Needs user activation; one PiP window per page.
- The stylesheet copy is one-time: re-copy for theme changes or later-injected CSS (CSS-in-JS); copy `color-scheme` and
  theme attributes too.
- With Vite/React: render into `pip.document.body` with a portal instead of moving framework-owned nodes.
- The window can't navigate and closes with its opener. `disallowReturnToOpener` hides "back to tab". Sizes get clamped.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API/Using · https://github.com/mdn/browser-compat-data

## Fullscreen API and the iPhone limits

`element.requestFullscreen({ navigationUI })` hides browser UI for an element; style it with `:fullscreen` and
`::backdrop`. On iPhone only a `<video>` can go fullscreen, via the non-standard `webkitEnterFullscreen()`. Use it for
immersive viewers (photos, slides, games, video), not ordinary screens.

```ts
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
/** From a click. */
export async function enterFullscreen(el: HTMLElement): Promise<void> {
  if (document.fullscreenEnabled) return el.requestFullscreen({ navigationUI: 'hide' });
  if (el instanceof HTMLVideoElement) {
    const v: IosVideo = el;
    v.webkitEnterFullscreen?.();
  }
}
document.addEventListener('fullscreenchange', () => document.body.classList.toggle('is-fullscreen', document.fullscreenElement !== null));
```

```css
:fullscreen { background: var(--bg); }
::backdrop { background: black; }
```

**Support:** Chrome 71, Firefox 64, Safari 16.4 unprefixed on macOS (webkit-prefixed before). iPadOS: element fullscreen
(unprefixed 16.4) with a forced overlay exit button, and swiping down exits (bad for games). iPhone: no element fullscreen, only `<video>.webkitEnterFullscreen()`.

**Gotchas:**
- Needs user activation. Esc, back or swipe exits: keep state in sync via `fullscreenchange`.
- On iPhone the "fullscreen app" is an installed web app with `display: standalone`/`fullscreen`; ask game and kiosk
  users to install.
- `navigationUI: 'hide'` is honoured by Chrome Android.
- Fullscreen is a prerequisite for Keyboard Lock and orientation lock.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen · https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API

## Screen Orientation: read always, lock only in fullscreen

`screen.orientation.type`/`angle` and a `change` event work everywhere; `screen.orientation.lock()` only where the
platform allows it (mainly Android in fullscreen). Games and players that rotate and stay landscape feel native; locking
an ordinary app is anti-native on tablets, foldables and desktops.

```ts
type OrientationLock = 'any' | 'natural' | 'landscape' | 'portrait' | 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary';
type Lockable = ScreenOrientation & { lock?: (o: OrientationLock) => Promise<void> }; // lock() was dropped from lib.dom
export async function lockLandscape(el: HTMLElement): Promise<boolean> {
  const o: Lockable = screen.orientation;
  if (typeof o.lock !== 'function') return false;
  try {
    if (!document.fullscreenElement) await el.requestFullscreen({ navigationUI: 'hide' });
    await o.lock('landscape');
    return true;
  } catch {
    return false; // NotSupportedError (desktop, iOS) / SecurityError: design for both orientations
  }
}
screen.orientation.addEventListener('change', () => {
  document.documentElement.dataset.orientation = screen.orientation.type;
});
```

**Support:** `lock()`: Chrome Android 38 (fullscreen; also installed-app windows, verify on target devices). Firefox 144+
(desktop and Android). Chrome/Edge desktop always reject with `NotSupportedError`.
Safari/iOS: no lock; `screen.orientation` readable since 16.4.

**Gotchas:**
- iOS can't lock: for games show a "rotate your device" overlay with `@media (orientation: portrait)`.
- `lock()` rejects with `SecurityError` when hidden, `AbortError` if superseded. Call `unlock()` on exit.
- Lay out with orientation/aspect-ratio media queries and container queries rather than locking.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock · https://github.com/mdn/browser-compat-data

## Camera via getUserMedia: facingMode, playsinline, mirroring, torch

`getUserMedia({ video: { facingMode } })` for live camera UIs (scanning, calls, AR); track capabilities add torch and
zoom. A preview that starts on the right camera, mirrors the selfie view and doesn't jump to fullscreen on iPhone feels
like the native camera. Chrome's `<usermedia>` element is a browser-drawn camera/mic button that owns the prompt.

```ts
declare const video: HTMLVideoElement; // <video autoplay playsinline muted> — without playsinline iOS goes fullscreen
let stream: MediaStream | undefined;
export async function startCamera(facing: 'user' | 'environment'): Promise<void> {
  stream?.getTracks().forEach((t) => t.stop()); // release first
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
  });
  video.srcObject = stream;
  video.classList.toggle('mirrored', facing === 'user'); // .mirrored { transform: scaleX(-1) }
}
export async function torch(on: boolean): Promise<boolean> {
  const track = stream?.getVideoTracks()[0];
  if (!track || !('torch' in track.getCapabilities())) return false; // Chrome Android only
  const torchOn: MediaTrackConstraintSet & { torch: boolean } = { torch: on };
  await track.applyConstraints({ advanced: [torchOn] });
  return true;
}
export const stopCamera = (): void => stream?.getTracks().forEach((t) => t.stop()); // camera light off = trust
```

```html
<usermedia id="cam"><button type="button">Turn on camera</button></usermedia>
```

**Support:** `getUserMedia`: all modern browsers (secure context; iOS tab and home-screen app). `facingMode`: mobile
browsers. torch: Chrome Android. `ImageCapture` (full-res `takePhoto`): Chrome 59, Safari 18.4. `getCapabilities`:
Chrome 59, Safari 11, Firefox 132. `<usermedia>`: Chrome/Edge 151 (desktop, Android); others render the fallback.

**Gotchas:**
- Without `playsinline` and `muted`, iOS opens the video fullscreen and blocks autoplay.
- Use `{ ideal }`, not `{ exact }` (`OverconstrainedError` on desktops).
- `enumerateDevices()` labels are empty until permission; listen to `devicechange`.
- Stop tracks when leaving the screen. Ask for the mic and camera only when the user turns them on.
- `<usermedia>`'s event/property names (`stream`?) are still settling; check Chrome's current docs before relying on them.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia · https://developer.chrome.com/blog/usermedia-html-element

## Geolocation and the geolocation element

`navigator.geolocation.getCurrentPosition`/`watchPosition`, optionally fronted by Chrome's `<geolocation>` element, a
browser-drawn "Use location" button that handles the prompt. A clear action at the moment of need with fast coarse
results mirrors native apps; prompting on load is a top web annoyance.

```ts
declare const show: (p: GeolocationPosition) => void, explainDenied: () => void;
// <geolocation><button id="near-me" type="button">Use my location</button></geolocation>
const geo = document.querySelector('geolocation');
if (geo && 'HTMLGeolocationElement' in window) {
  geo.addEventListener('location', () => {
    if ('position' in geo && geo.position instanceof GeolocationPosition) show(geo.position);
    else explainDenied();
  });
} else {
  document.getElementById('near-me')?.addEventListener('click', () =>
    navigator.geolocation.getCurrentPosition(show, (err) => { if (err.code === err.PERMISSION_DENIED) explainDenied(); }, {
      enableHighAccuracy: false, // fast and cheap; ask for GPS accuracy only when needed
      maximumAge: 60_000,
      timeout: 10_000,
    }));
}
```

**Support:** Geolocation API: universal (secure context; iOS tab and home-screen app). `<geolocation>`: Chrome/Edge 144
(desktop, Android); Safari and Firefox render the fallback.

**Gotchas:**
- Ask only on an explicit action; `enableHighAccuracy: true` wakes GPS (slow, battery).
- `watchPosition` effectively stops in background tabs on mobile: no background location on the web.
- On iOS, Settings › Privacy › Location Services › Safari Websites must be on; say so on `PERMISSION_DENIED`.
- The element enforces styling rules and exposes validity state for clickjacking checks.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API · https://developer.chrome.com/blog/geolocation-html-element

## DeviceOrientation, DeviceMotion and Generic Sensors

`deviceorientation`/`devicemotion` events for tilt, compass and shake, gated on iOS by
`DeviceOrientationEvent.requestPermission()` from a tap. Chromium-only Generic Sensor classes (`Accelerometer`,
`Gyroscope`, `AbsoluteOrientationSensor`…) add frequency control. Tilt parallax, compass headings and level tools feel
physical when they work on iOS too.

```ts
type WithPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
/** From a tap. iOS gates motion data behind requestPermission(); others just fire events. */
export async function enableTilt(onTilt: (e: DeviceOrientationEvent) => void): Promise<boolean> {
  const ctor: WithPermission = DeviceOrientationEvent;
  if (typeof ctor.requestPermission === 'function' && (await ctor.requestPermission()) !== 'granted') return false;
  window.addEventListener('deviceorientation', onTilt); // attach in every branch: the method's presence doesn't mean iOS
  return true;
}
// Chromium-only alternative with a sample rate:
// if ('Accelerometer' in window) { const s = new Accelerometer({ frequency: 30 }); s.addEventListener('reading', …); s.start(); }
```

**Support:** events: mobile browsers broadly; desktop only with sensors. `requestPermission`: iOS Safari 13+ (BCD lists
14.5); Chrome/Edge 152 (desktop, Android). Firefox: no `requestPermission`. Generic Sensors: Chrome
67+ (Accelerometer, Gyroscope, Linear/GravitySensor, Absolute/RelativeOrientationSensor); Magnetometer and
AmbientLightSensor behind flags; no Safari or Firefox.

**Gotchas:**
- Never treat "requestPermission exists" as "this is iOS"; always attach the listener after the check.
- iOS keeps a denial until site data is reset.
- Iframes need Permissions-Policy (`accelerometer`, `gyroscope`, `magnetometer`).
- Use `webkitCompassHeading` on iOS for a true compass. Throttle work to `requestAnimationFrame`.
- Respect `prefers-reduced-motion` for parallax. Don't theme from AmbientLightSensor; use `prefers-color-scheme`.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static · https://developer.mozilla.org/en-US/docs/Web/API/Sensor_APIs

## Network Information, Save-Data and Battery Status (don't)

Chromium's `navigator.connection` (`effectiveType`, `saveData`, `downlink`, `rtt`) is an adaptive hint for lighter media.
The Battery Status API exists only in Chromium; avoid it. (Online/offline handling is in
[offline-push-storage.md](offline-push-storage.md#onlineoffline-detection-beyond-navigatoronline).)

```ts
type Conn = { saveData?: boolean; effectiveType?: 'slow-2g' | '2g' | '3g' | '4g' };
const nav: Navigator & { connection?: Conn } = navigator;
/** Chromium-only hint; unknown means "fine". */
export const preferLite = (): boolean =>
  nav.connection?.saveData === true || nav.connection?.effectiveType === 'slow-2g' || nav.connection?.effectiveType === '2g';
```

**Support:** NetworkInformation: Chrome 61 desktop / 38 Android; `saveData` Chrome 65. Safari: none. Firefox: none.
Battery Status (`navigator.getBattery`): Chromium only; removed from Firefox 52 over fingerprinting; never in Safari.

**Gotchas:**
- Don't block features on `effectiveType`; it's a coarse estimate. Servers can read the `Save-Data` header.
- Don't build features on battery level; to save power use Compute Pressure, Page Visibility and user settings.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Network_Information_API · https://developer.mozilla.org/en-US/docs/Web/API/Battery_Status_API

## Handling launches: launchQueue for URLs

With manifest `launch_handler.client_mode: "focus-existing"` (declared per
[install-and-identity.md](install-and-identity.md#single-instance-launches-launch_handler)), opening the installed app
from a link, notification or share focuses the open window instead of spawning a second; `launchQueue.setConsumer`
delivers the target URL, which you must route yourself.

```ts
type LaunchParams = { readonly targetURL?: string; readonly files: readonly FileSystemHandle[] };
const w: Window & { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } } = window;
declare const route: (path: string) => void;
w.launchQueue?.setConsumer((p) => {
  if (!p.targetURL) return;
  const u = new URL(p.targetURL);
  if (u.origin === location.origin) route(u.pathname + u.search + u.hash); // focus-existing: you navigate
});
```

**Support:** `launch_handler`: Chrome/Edge 110 (desktop; BCD also lists Chrome Android). `launchQueue`: Chromium 102 desktop. Safari,
Firefox: no (default behaviour).

**Gotchas:**
- With `focus-existing` the page is NOT navigated: route to `targetURL` or the user sees the old screen.
- `navigate-existing` reloads the existing window (state lost).
- Pair with `notificationclick` → `client.focus()` + `postMessage` for routing on every browser. Installed apps only.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Launch_Handler_API · https://developer.mozilla.org/en-US/docs/Web/API/LaunchQueue

## Opening files from the OS: launchQueue files

With manifest `file_handlers` (see [install-and-identity.md](install-and-identity.md#file-handlers)) the installed app
appears in "Open with"; opened files arrive as `FileSystemFileHandle`s through `launchQueue`, so the app can save back.
Double-clicking a `.md` to open it in your app is the definition of a desktop app.

```ts
type LaunchParams = { readonly targetURL?: string; readonly files: readonly FileSystemHandle[] };
const w: Window & { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } } = window;
declare const openDoc: (f: File, h: FileSystemFileHandle) => void;
w.launchQueue?.setConsumer((p) => {
  for (const h of p.files) if (h instanceof FileSystemFileHandle) void h.getFile().then((f) => openDoc(f, h));
});
// Save back: const out = await handle.createWritable(); await out.write(text); await out.close();
```

**Support:** Chromium desktop 102 (Windows, macOS, Linux, ChromeOS), installed apps. Android, Safari, Firefox: no.

**Gotchas:**
- The OS asks the user the first time a type opens with your app.
- Writing back may prompt for write permission. Keep an `<input type=file>` path for everyone else.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/LaunchQueue · https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/file_handlers

## Protocol handlers at runtime: registerProtocolHandler

Lets the app handle `web+yourapp:` or safelisted schemes (`mailto:`, `magnet:`, `webcal:`, `xmpp:`, `matrix:`…), so such
links anywhere open your app. (The manifest `protocol_handlers` form is in
[install-and-identity.md](install-and-identity.md#protocol-handlers).)

```ts
export function registerLinks(): void {
  if (typeof navigator.registerProtocolHandler !== 'function') return;
  try { navigator.registerProtocolHandler('web+example', `${location.origin}/open?link=%s`); } catch { /* SecurityError */ }
}
// On /open: untrusted input.
const link = new URLSearchParams(location.search).get('link');
const parsed = link !== null && URL.canParse(link) ? new URL(link) : null;
if (parsed?.protocol === 'web+example:') { /* route on parsed.pathname */ }
```

**Support:** `registerProtocolHandler`: Chrome/Edge desktop, Firefox desktop. Safari, Chrome Android: no.

**Gotchas:**
- Custom schemes are `web+` plus lowercase ASCII letters; the URL must be https, same-origin, contain `%s`.
- The user approves it (prompt or settings entry). Validate everything that arrives.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Navigator/registerProtocolHandler

## Payment Request API: Apple Pay and Google Pay

`new PaymentRequest(methods, details).show()` opens the browser's payment sheet: Apple Pay in Safari, Google Pay and
saved cards in Chrome. A Face ID / fingerprint wallet sheet instead of a 16-field card form is the native checkout.

```ts
declare const merchantSession: (validationURL: string) => Promise<unknown>, charge: (d: unknown) => Promise<boolean>;
const methods: PaymentMethodData[] = [
  { supportedMethods: 'https://apple.com/apple-pay', data: { version: 3, merchantIdentifier: 'merchant.com.example',
    merchantCapabilities: ['supports3DS'], supportedNetworks: ['visa', 'masterCard', 'amex'], countryCode: 'US' } },
  { supportedMethods: 'https://google.com/pay', data: { apiVersion: 2, apiVersionMinor: 0 /* …Google Pay request */ } },
];
const details: PaymentDetailsInit = { total: { label: 'Example Pro', amount: { currency: 'USD', value: '9.99' } } };
/** Build and show inside the click: show() needs the gesture and a request shows only once. */
export async function pay(): Promise<void> {
  const req = new PaymentRequest(methods, details);
  req.addEventListener('merchantvalidation', (e) => { // Apple Pay: your server gets a merchant session from Apple
    if ('validationURL' in e && typeof e.validationURL === 'string' && 'complete' in e && typeof e.complete === 'function') {
      e.complete(merchantSession(e.validationURL));
    }
  });
  const res = await req.show();
  await res.complete((await charge(res.details)) ? 'success' : 'fail');
}
export const canPay = async (): Promise<boolean> =>
  'PaymentRequest' in window && (await new PaymentRequest(methods, details).canMakePayment().catch(() => false));
```

**Support:** Chrome 60 desktop / Android 53, Edge, Safari 11.1 / iOS 11.3 (Apple Pay only; tab and home-screen app).
Firefox: behind a flag only.

**Gotchas:**
- Apple Pay needs domain verification, a merchant ID and a server merchant-validation endpoint.
- Render the platform button (`<apple-pay-button>` via Apple's SDK, or `-webkit-appearance: -apple-pay-button`).
- Call `show()` before any await in the click. Keep a card form with `autocomplete="cc-*"` for Firefox.
- Digital goods inside store-packaged apps follow store rules.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Payment_Request_API · https://developer.apple.com/documentation/apple_pay_on_the_web

## FedCM, Login Status and Digital Credentials

`navigator.credentials.get` with identity providers (FedCM) shows the browser's own account chooser for "Sign in with
X" without redirects, popups or third-party cookies. The Digital Credentials API asks the OS wallet for an ID or
driver's licence. Browser-drawn sheets feel native; redirect dances feel like 2010.

```ts
declare const nonce: string, signIn: (token: string) => void;
export async function fedcmSignIn(): Promise<void> {
  if (!('IdentityCredential' in window)) return;
  const options: CredentialRequestOptions & { identity: { providers: { configURL: string; clientId: string; params?: Record<string, string> }[] } } = {
    identity: { providers: [{ configURL: 'https://idp.example/fedcm.json', clientId: 'my-client-id', params: { nonce } }] },
  };
  const cred = await navigator.credentials.get(options).catch(() => null);
  if (cred && 'token' in cred && typeof cred.token === 'string') signIn(cred.token);
}
// Digital Credentials: navigator.credentials.get({ digital: { requests: [{ protocol: 'org-iso-mdoc', data: requestFromServer }] } })
```

**Support:** FedCM: Chrome/Edge 108+; Safari, Firefox: no. Login Status API (`navigator.login`): Chrome 120, Firefox
138. `DigitalCredential`: Chrome/Edge 141, Safari 26. `PasswordCredential`: Chromium only.

**Gotchas:**
- FedCM needs the IdP to implement it; the option shape has evolved (e.g. where `nonce` goes): follow the IdP's docs.
- Digital Credentials protocols differ (Safari is mdoc-centric; Chrome also OpenID4VP): verify the request format.
- Most apps get 90% of the native feel from correct `autocomplete` (`username`, `current-password`, `new-password`).

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/FedCM_API · https://developer.chrome.com/blog/digital-credentials-api-shipped · https://webkit.org/blog/17431/online-identity-verification-with-the-digital-credentials-api/

## Contact Picker API

`navigator.contacts.select(['name', 'email', 'tel', 'address', 'icon'], { multiple })` opens the OS contact picker and
returns only what the user chose. "Invite from contacts" without uploading the address book is how native apps invite.

```ts
type ContactProp = 'name' | 'email' | 'tel' | 'address' | 'icon';
type Contacts = {
  getProperties(): Promise<ContactProp[]>;
  select(p: ContactProp[], o?: { multiple?: boolean }): Promise<Partial<Record<ContactProp, unknown[]>>[]>;
};
const nav: Navigator & { contacts?: Contacts } = navigator;
export const canPickContacts = (): boolean => nav.contacts !== undefined && 'ContactsManager' in window;
/** From a tap. Returns only what the user ticked. */
export async function pickEmails(): Promise<string[]> {
  if (!nav.contacts || !(await nav.contacts.getProperties()).includes('email')) return [];
  const picked = await nav.contacts.select(['name', 'email'], { multiple: true });
  return picked.flatMap((c) => (c.email ?? []).filter((e): e is string => typeof e === 'string'));
}
```

**Support:** Chrome Android 80+, Android WebView. iOS Safari only behind an experimental flag (not shippable). Desktop:
none.

**Gotchas:**
- Needs user activation, a top-level frame, secure context. Ask only for properties you need.
- Hide the button when unsupported; fall back to sharing an invite link or typing an address. Treat values as untrusted.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API

## Web Speech: dictation and text-to-speech

`SpeechRecognition` turns speech into text (webkit-prefixed in Safari); `speechSynthesis` reads text aloud with OS voices.
Voice input and read-aloud with system voices integrate the app with the OS's voice and accessibility features.

```ts
declare const toast: (msg: string) => void;
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
const w: Window & { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec } = window;
const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
/** From a tap; asks for the microphone. Returns a stop function, or null to hide the mic button. */
export function dictate(onText: (t: string, final: boolean) => void): (() => void) | null {
  if (!Recognition) return null; // the OS keyboard still has dictation
  const r = new Recognition();
  r.lang = document.documentElement.lang || navigator.language;
  r.interimResults = true;
  r.continuous = false;
  r.onresult = (e) => {
    const res = Array.from(e.results);
    onText(res.map((x) => x[0]?.transcript ?? '').join(''), res.at(-1)?.isFinal ?? false);
  };
  r.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast(`Dictation: ${e.error}`); };
  r.start();
  return () => r.stop();
}
export function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = document.documentElement.lang || navigator.language;
  speechSynthesis.speak(u); // first call from a gesture on iOS
}
```

**Support:** SpeechRecognition: Chrome 139 unprefixed (webkit-prefixed since 33); `processLocally` for on-device
recognition in Chrome 139 desktop. Safari 14.1 / iOS 14.5 webkit-prefixed. Firefox: no (Nightly only). `speechSynthesis`:
Chrome 33, Safari 7, Firefox 49; not Android WebView.

**Gotchas:**
- Chrome's default recognition streams audio to Google's servers: disclose it, or use on-device processing where
  available (matters for privacy-focused apps).
- Safari needs Siri/Dictation enabled. Voices load asynchronously (`voiceschanged`) and differ per OS.
- Chrome can cut long utterances: speak sentence by sentence.
- On phones the keyboard's dictation key is often better UX than your own mic button.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API · https://github.com/mdn/browser-compat-data

## Screen capture: getDisplayMedia with CaptureController and contentHint

`getDisplayMedia()` lets the user pick a screen, window or tab to share. Chromium extras: `CaptureController.setFocusBehavior`,
`selfBrowserSurface`, `surfaceSwitching`, `systemAudio`. Sharing that keeps the user in the call, excludes the call tab and
keeps text sharp matches native Zoom and Teams.

```ts
declare const stopSharingUi: () => void;
type Controller = { setFocusBehavior(b: 'focus-captured-surface' | 'no-focus-change'): void };
const w: Window & { CaptureController?: new () => Controller } = window;
export const canShareScreen = (): boolean => typeof navigator.mediaDevices?.getDisplayMedia === 'function'; // false on phones
/** From a click. */
export async function shareScreen(): Promise<MediaStream | null> {
  const controller = w.CaptureController ? new w.CaptureController() : undefined;
  const options: DisplayMediaStreamOptions & {
    selfBrowserSurface?: 'exclude' | 'include'; surfaceSwitching?: 'include' | 'exclude';
    systemAudio?: 'include' | 'exclude'; controller?: Controller;
  } = { video: true, audio: true, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include', ...(controller ? { controller } : {}) };
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(options);
    controller?.setFocusBehavior('no-focus-change'); // keep the user in the call; call right away
    const [track] = stream.getVideoTracks();
    if (track) {
      track.contentHint = 'detail';
      track.addEventListener('ended', stopSharingUi, { once: true }); // the browser's own "Stop sharing"
    }
    return stream;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotAllowedError') return null; // picker cancelled
    throw e;
  }
}
```

**Support:** desktop: Chrome 72, Edge 79, Firefox 66, Safari 13. Mobile (Chrome Android, iOS/iPadOS Safari, Firefox
Android): none. `CaptureController`/`setFocusBehavior`: Chrome/Edge 109.

**Gotchas:**
- Hide "Share screen" where the feature check fails (phones). Needs activation; cancel gives `NotAllowedError`.
- Call `setFocusBehavior` right after the promise resolves.
- `contentHint: 'detail'` keeps text sharp; `'motion'` for video.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API · https://developer.mozilla.org/en-US/docs/Web/API/CaptureController

## Barcode Detection API

`BarcodeDetector` finds QR codes and barcodes in images or video frames with the OS's native detectors: instant QR
scanning without shipping a 200 KB decoder. `FaceDetector`/`TextDetector` are experimental-flag only; don't ship them.

```ts
type Detected = { rawValue: string; format: string };
type DetectorCtor = {
  new (o: { formats: string[] }): { detect(s: ImageBitmapSource): Promise<Detected[]> };
  getSupportedFormats(): Promise<string[]>;
};
const w: Window & { BarcodeDetector?: DetectorCtor } = window;
/** Native QR scanning where available; null -> load a WASM decoder (e.g. zxing-wasm) in a worker. */
export async function qrScanner(): Promise<((s: ImageBitmapSource) => Promise<string | undefined>) | null> {
  if (!w.BarcodeDetector) return null;
  if (!(await w.BarcodeDetector.getSupportedFormats()).includes('qr_code')) return null; // e.g. Windows/Linux
  const d = new w.BarcodeDetector({ formats: ['qr_code'] });
  return async (s) => (await d.detect(s))[0]?.rawValue;
}
```

**Support:** Chrome Android 83+, Android WebView. Chrome desktop on macOS and ChromeOS only. Safari: behind a flag only.
Firefox: no.

**Gotchas:**
- Always check `getSupportedFormats()`: the constructor may exist where detection doesn't work.
- Detect at ~10 fps (`requestVideoFrameCallback` or a timer), not every frame.
- On iOS the system Camera already scans QR codes; an `<input capture>` photo plus WASM decode is a simple fallback.
- Validate decoded payloads.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API

## EyeDropper API

`new EyeDropper().open()` lets the user pick any on-screen pixel and returns an sRGB hex: a native design-tool feature.

```ts
type Dropper = new () => { open(o?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> };
const w: Window & { EyeDropper?: Dropper } = window;
/** From a click. Fallback: the OS colour panel (macOS's includes an eyedropper). */
export async function pickColor(fallback: HTMLInputElement /* <input type="color"> */): Promise<string | undefined> {
  if (!w.EyeDropper) { fallback.showPicker(); return undefined; }
  try { return (await new w.EyeDropper().open()).sRGBHex; } catch { return undefined; } // Esc -> AbortError
}
```

**Support:** Chrome/Edge 95+ desktop (ChromeOS from 120; Linux X11 only, not Wayland). Mobile, Safari, Firefox: none. `input.showPicker()`: Chrome 99, Safari 16,
Firefox 101.

**Gotchas:**
- Needs user activation. Returns sRGB even on wide-gamut displays.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper_API

## Idle Detection API

`IdleDetector` reports `userState` (`active`/`idle`) and `screenState` (`locked`/`unlocked`) after a threshold of at
least 60 s, with permission. Automatic "away" when the user walks off or locks the screen is how desktop chat apps
behave.

```ts
type Idle = EventTarget & {
  userState: 'active' | 'idle' | null; screenState: 'locked' | 'unlocked' | null;
  start(o: { threshold: number; signal?: AbortSignal }): Promise<void>;
};
const w: Window & { IdleDetector?: { new (): Idle; requestPermission(): Promise<'granted' | 'denied'> } } = window;
declare const setPresence: (p: 'online' | 'away') => void;
/** Opt-in "auto-away" from a settings toggle (a tap). Stop with the AbortSignal. */
export async function autoAway(signal: AbortSignal): Promise<boolean> {
  if (!w.IdleDetector || (await w.IdleDetector.requestPermission()) !== 'granted') return false;
  const d = new w.IdleDetector();
  d.addEventListener('change', () => setPresence(d.userState === 'idle' || d.screenState === 'locked' ? 'away' : 'online'), { signal });
  await d.start({ threshold: 60_000, signal }); // minimum 60 s
  return true;
}
```

**Support:** Chrome/Edge 94+ (desktop, Android). Safari and Firefox: no (both oppose it on privacy grounds).

**Gotchas:**
- `requestPermission` needs activation: make it an explicit opt-in.
- Never send raw idle timelines to a server.
- Fallback everywhere: Page Visibility plus a "no input for N minutes" timer.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Idle_Detection_API

## Window Management API: multi-screen

`window.getScreenDetails()` lists connected screens with positions and labels; `screen.isExtended` says whether there are
several. Presenter view on the laptop with slides on the projector is native desktop behaviour.

```ts
type ScreenDetailed = Screen & { availLeft: number; availTop: number; label: string };
type ScreenDetails = EventTarget & { screens: ScreenDetailed[]; currentScreen: ScreenDetailed };
const w: Window & { getScreenDetails?: () => Promise<ScreenDetails> } = window;
const scr: Screen & { isExtended?: boolean } = screen;
/** From a click: presenter view on the other monitor (asks for 'window-management'). */
export async function openOnOtherScreen(url: string): Promise<void> {
  if (!w.getScreenDetails || !scr.isExtended) return void window.open(url, 'presenter', 'popup');
  const d = await w.getScreenDetails();
  const other = d.screens.find((s) => s !== d.currentScreen);
  if (!other) return void window.open(url, 'presenter', 'popup');
  window.open(url, 'presenter', `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`);
}
// or: slides.requestFullscreen({ screen: other })  (Chromium)
```

**Support:** Chromium 100+ desktop. Safari and Firefox: no.

**Gotchas:**
- Permission prompt (formerly `window-placement`, now `window-management`) plus activation for popups; the prompt after
  `await getScreenDetails()` can consume the activation, so the popup may be blocked on first use.
- `screen.isExtended` needs no permission: check it first and don't prompt single-screen users.
- Listen to `screenschange` for hot-plugged monitors.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API

## Web NFC: NDEFReader

Read and write NDEF NFC tags (URLs, text, MIME records) from Chrome on Android: tap-a-tag check-ins, inventory and
pairing like a native Android app.

```ts
declare const toast: (msg: string) => void;
type NdefRecord = { recordType: string; data?: DataView };
type Reader = EventTarget & {
  scan(o?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((e: Event & { message: { records: NdefRecord[] } }) => void) | null;
  onreadingerror: (() => void) | null;
};
const w: Window & { NDEFReader?: new () => Reader } = window;
/** From a tap, Chrome Android only. */
export async function scanTag(onUrl: (url: string) => void): Promise<boolean> {
  if (!w.NDEFReader) return false;
  const reader = new w.NDEFReader();
  const ac = new AbortController();
  reader.onreading = (e) => {
    for (const r of e.message.records) if (r.recordType === 'url' && r.data) onUrl(new TextDecoder().decode(r.data));
    ac.abort(); // one read, then stop scanning
  };
  reader.onreadingerror = () => toast('Couldn’t read that tag');
  await reader.scan({ signal: ac.signal });
  return true;
}
```

**Support:** Chrome Android 89+. iOS (no Web NFC at all), desktop, Firefox: none.

**Gotchas:**
- Top-level frame, visible page, activation for the first scan, `nfc` permission. Scanning pauses when hidden.
- NDEF only: no payment cards or low-level tag access. Validate URLs read from tags.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Web_NFC_API

## Hardware: Web Bluetooth, WebUSB, Web Serial, WebHID

Device access through browser choosers: `navigator.bluetooth.requestDevice`, `navigator.usb.requestDevice`,
`navigator.serial.requestPort`, `navigator.hid.requestDevice`, plus `getDevices()`/`getPorts()` for granted devices.
Configure wearables, microcontrollers, printers or controllers without a native helper.

```ts
type Port = { open(o: { baudRate: number }): Promise<void>; readable: ReadableStream<Uint8Array> | null };
const nav: Navigator & { serial?: { requestPort(o?: { filters?: { usbVendorId?: number }[] }): Promise<Port> } } = navigator;
/** From a click: the browser shows its device chooser. Same shape for usb / hid / bluetooth .requestDevice(). */
export async function connectBoard(): Promise<ReadableStreamDefaultReader<Uint8Array> | null> {
  if (!nav.serial) return null;
  const port = await nav.serial.requestPort({ filters: [{ usbVendorId: 0x2341 }] });
  await port.open({ baudRate: 115_200 });
  return port.readable?.getReader() ?? null;
}
```

**Support:** Web Bluetooth: Chrome 70 desktop (Linux behind a flag) and Android 56. WebUSB: Chrome 61 desktop and Android.
Web Serial: Chrome 89 desktop, Chrome Android 148 (138–147: Bluetooth RFCOMM only), Firefox 151 desktop
(gated by a site-permission add-on prompt). WebHID: Chromium 89 desktop.
Safari: none of them.

**Gotchas:**
- Every request needs activation and shows a chooser. Handle `disconnect`. Iframes need Permissions-Policy.
- Chromium-centric: progressive enhancement with a clear "use Chrome or Edge on desktop" message; avoid for consumer
  features that must work on iPhone. Validate all bytes from devices.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API · https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API

## Compute Pressure API

`PressureObserver` reports CPU pressure (`nominal`, `fair`, `serious`, `critical`) so the app can shed load, the way
native call apps lower resolution or effects when the laptop heats up.

```ts
type PressureRecord = { state: 'nominal' | 'fair' | 'serious' | 'critical'; source: string; time: number };
type Observer = { observe(source: 'cpu', o?: { sampleInterval?: number }): Promise<void>; disconnect(): void };
const w: Window & { PressureObserver?: new (cb: (records: PressureRecord[]) => void) => Observer } = window;
declare const setVideoQuality: (q: 'low' | 'high') => void;
/** Returns a disconnect function for when the call or heavy view ends. */
export async function adaptToLoad(): Promise<() => void> {
  if (!w.PressureObserver) return () => {};
  const obs = new w.PressureObserver((records) => {
    const s = records.at(-1)?.state;
    setVideoQuality(s === 'serious' || s === 'critical' ? 'low' : 'high'); // fewer tiles, lower resolution, no blur
  });
  try { await obs.observe('cpu', { sampleInterval: 2_000 }); } catch { /* NotSupportedError */ }
  return () => obs.disconnect();
}
```

**Support:** Chrome/Edge 125+ desktop. Chrome Android, Safari, Firefox: no.

**Gotchas:**
- Check `PressureObserver.knownSources`; catch `NotSupportedError` from `observe()`.
- Add hysteresis so quality doesn't flap. Disconnect when done.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Compute_Pressure_API

## Local Font Access

`window.queryLocalFonts()` lists installed fonts (`family`, `fullName`, `postscriptName`) with `blob()` access, so design
and document tools show the user's own fonts like desktop apps.

```ts
const w: Window & { queryLocalFonts?: () => Promise<{ family: string; fullName: string; postscriptName: string }[]> } = window;
/** From a click in a font menu (asks for 'local-fonts'). */
export async function localFamilies(): Promise<string[]> {
  if (!w.queryLocalFonts) return [];
  return [...new Set((await w.queryLocalFonts()).map((f) => f.family))].sort();
}
```

**Support:** Chromium 103+ desktop. Mobile, Safari, Firefox: no.

**Gotchas:**
- Permission prompt plus activation. A fingerprinting surface: ask only where fonts are the feature.
- Fallback: let users type a family name and render it via CSS `local()`.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Local_Font_Access_API

## Keyboard Lock and Keyboard Map

`navigator.keyboard.lock(codes)` captures system-reserved keys (Esc and similar) while fullscreen;
`navigator.keyboard.getLayoutMap()` maps physical key codes to the user's layout labels. Games and remote desktops get
native-like key capture; shortcut hints show the right letter on AZERTY or QWERTZ.

```ts
type Kb = { lock(codes?: string[]): Promise<void>; unlock(): void; getLayoutMap(): Promise<Map<string, string>> };
const nav: Navigator & { keyboard?: Kb } = navigator;
/** Games / remote desktops. Only takes effect while fullscreen. */
export async function immersive(el: HTMLElement): Promise<void> {
  await el.requestFullscreen();
  await nav.keyboard?.lock(['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD']).catch(() => {}); // hold Esc to exit
}
/** 'KeyW' -> 'z' on AZERTY. */
export const keyLabel = async (code: string): Promise<string> =>
  (await nav.keyboard?.getLayoutMap())?.get(code) ?? code.replace(/^Key/, '');
```

**Support:** Chromium desktop 68/69. Safari and Firefox: no.

**Gotchas:**
- The lock applies only in fullscreen via `requestFullscreen` (not F11). With Escape locked, users must press and hold
  Esc to exit: tell them.
- For ordinary apps use `KeyboardEvent.code` for shortcuts and `getLayoutMap` only for labels.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Keyboard_API

## Storage Access API: embedded iframes

`document.hasStorageAccess()` and `document.requestStorageAccess()` let your iframe, embedded on another site, ask for
its unpartitioned cookies after a gesture, so embedded widgets stay signed in instead of showing "please log in".

```ts
declare const signInButton: HTMLButtonElement, openPopupLogin: () => void;
// Inside YOUR iframe embedded on someone else's site.
export async function setupStorageAccess(): Promise<void> {
  if (!('hasStorageAccess' in document) || (await document.hasStorageAccess())) return;
  signInButton.addEventListener('click', async () => {
    try { await document.requestStorageAccess(); location.reload(); } // cookies now reachable in this frame
    catch { openPopupLogin(); } // denied, or never visited first-party
  });
}
```

**Support:** Safari 11.1 / iOS 11.3, Firefox 65, Edge 85, Chrome 119 desktop / 120 Android. Android WebView: `hasStorageAccess` only.

**Gotchas:**
- Only relevant if the app is embeddable. Needs activation.
- Safari typically requires prior first-party use of your site. Storage stays partitioned without the grant.
- A sandboxed iframe needs `allow-storage-access-by-user-activation`.

**Sources:** https://developer.mozilla.org/en-US/docs/Web/API/Storage_Access_API

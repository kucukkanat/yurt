/**
 * install.ts: installation and app identity at runtime. Your own Install button (Chromium's beforeinstallprompt),
 * Add to Home Screen / Add to Dock steps where there is no prompt (Safari, Firefox), "am I the installed app?"
 * (including iOS's navigator.standalone and iPadOS's Mac user agent), the app icon badge, a one-time install hint,
 * and single-window launches (launch_handler + launchQueue).
 *
 * Browsers:
 *   beforeinstallprompt / appinstalled   Chromium only (Chrome, Edge, Samsung, Opera), desktop and Android.
 *   navigator.standalone                 iOS/iPadOS only (non-standard), the reliable "Home Screen app" signal.
 *   display-mode media                   Chrome 42, Safari 13, Firefox 47; Firefox desktop never matches standalone
 *                                        (Windows taskbar apps match minimal-ui from 142).
 *   setAppBadge / clearAppBadge          Chrome/Edge 81+ desktop (Windows, macOS; ChromeOS 91), Safari macOS 17+ web
 *                                        apps, iOS/iPadOS 16.4+ Home Screen apps after notification permission. Not
 *                                        Chrome Android (it shows notification dots) or Firefox.
 *   launchQueue                          Chrome/Edge 102+ (files), 110+ (targetURL).
 *
 * Wiring: call watchInstall() at startup, before your UI mounts (the event can fire very early), and call
 * promptInstall() directly inside the Install button's click handler with no await before it.
 * Adapt: the hint conditions in shouldOfferInstallHint and the storage key. Everything that decides is pure.
 *
 * iOS caveat: Safari and the Home Screen app do NOT share cookies, localStorage or IndexedDB (and each icon gets its
 * own storage). Suggest installing before the user creates local state, or provide a hand-off (sign-in link, export).
 */

/* ------------------------------------------------------------------------------------------------- pure decisions */

/** Display modes that mean "running in its own app window". Add fullscreen only if your manifest uses it. */
export const APP_DISPLAY_MODES =
  '(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)';

/** Installed-app launch: an app display mode, or iOS's navigator.standalone (WebKit can report standalone false there). */
export const isStandaloneFrom = (appDisplayMode: boolean, navigatorStandalone: unknown): boolean =>
  appDisplayMode || navigatorStandalone === true;

/** iPhone, iPod or iPad, including iPadOS 13+, which reports a Mac user agent but has touch points. */
export const isIos = (userAgent: string, maxTouchPoints: number): boolean =>
  /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

/** Safari on a Mac (File > Add to Dock, macOS Sonoma+), not another browser and not an iPad. */
export const isMacSafari = (userAgent: string, maxTouchPoints: number): boolean =>
  /Macintosh/.test(userAgent) &&
  maxTouchPoints <= 1 &&
  /Version\/\d+.*Safari/.test(userAgent) &&
  !/Chrome|Chromium|Edg|Firefox|OPR/.test(userAgent);

export type InstallPath = 'installed' | 'prompt' | 'ios-steps' | 'mac-dock' | 'browser-menu';

/** What the "Install" entry in Settings should offer on this device. */
export function installPath(env: {
  readonly standalone: boolean;
  readonly canPrompt: boolean;
  readonly ios: boolean;
  readonly macSafari: boolean;
}): InstallPath {
  if (env.standalone) return 'installed';
  if (env.canPrompt) return 'prompt';
  if (env.ios) return 'ios-steps';
  if (env.macSafari) return 'mac-dock';
  return 'browser-menu';
}

/** Human steps for the paths without a prompt. ADAPT the wording and translate. */
export function installSteps(path: InstallPath): readonly string[] {
  switch (path) {
    case 'ios-steps':
      return [
        'Tap ••• or Share.',
        'Choose Add to Home Screen (scroll if needed; it may hide under Edit Actions).',
        'Keep Open as Web App on, then tap Add.',
      ];
    case 'mac-dock':
      return ['In Safari, choose File > Add to Dock.', 'Click Add.'];
    case 'browser-menu':
      return ["Open your browser's menu and choose Install or Add to Home Screen."];
    case 'installed':
    case 'prompt':
      return [];
  }
}

/**
 * Whether to show the one-time install hint: after the user got value, never inside the installed app, once per
 * device, and only on touch devices (desktop Chromium already shows an install icon in the address bar).
 * Repeated or blocking install nags are a web tell; keep a permanent entry in Settings instead.
 */
export const shouldOfferInstallHint = (s: {
  readonly engaged: boolean;
  readonly standalone: boolean;
  readonly hintShown: boolean;
  readonly coarsePointer: boolean;
}): boolean => s.engaged && !s.standalone && !s.hintShown && s.coarsePointer;

/** The app-internal URL a launch should route to, or null if it isn't one of ours (launch params are external input). */
export function launchTarget(targetURL: unknown, origin: string): URL | null {
  if (typeof targetURL !== 'string') return null;
  try {
    const url = new URL(targetURL);
    return url.origin === origin ? url : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------- DOM wiring */

/** Chromium's install prompt event, narrowed at runtime (never declared globally: it doesn't exist in Safari/Firefox). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}
const isInstallPrompt = (e: Event): e is InstallPromptEvent =>
  'prompt' in e && typeof e.prompt === 'function' && 'userChoice' in e && e.userChoice instanceof Promise;

/** The captured offer. Keep it out of state stores (not serialisable); expose a boolean instead. */
let offer: InstallPromptEvent | null = null;

export const isStandalone = (): boolean =>
  isStandaloneFrom(matchMedia(APP_DISPLAY_MODES).matches, Reflect.get(navigator, 'standalone'));

export const thisIsIos = (): boolean => isIos(navigator.userAgent, navigator.maxTouchPoints);

export interface InstallState {
  /** Running as the installed app right now. */
  readonly standalone: boolean;
  /** A Chromium install prompt is ready for promptInstall(). */
  readonly canPrompt: boolean;
  readonly path: InstallPath;
}

export function installState(): InstallState {
  const standalone = isStandalone();
  const canPrompt = offer !== null && !standalone;
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints;
  return { standalone, canPrompt, path: installPath({ standalone, canPrompt, ios: isIos(ua, touch), macSafari: isMacSafari(ua, touch) }) };
}

/**
 * Captures Chromium's install offer (suppressing its mini-infobar so you can offer it in context), and reports
 * changes: an offer arrived, the app got installed (however it was installed), or the page moved between a tab and an
 * app window. Call once at startup. Returns a cleanup.
 */
export function watchInstall(onChange: (state: InstallState) => void): () => void {
  const report = () => onChange(installState());
  const onOffer = (e: Event) => {
    if (!isInstallPrompt(e)) return;
    e.preventDefault();
    offer = e;
    report();
  };
  // On Android this fires when the user accepts, seconds before the icon is actually on the home screen.
  const onInstalled = () => {
    offer = null;
    report();
  };
  const modes = matchMedia(APP_DISPLAY_MODES);
  window.addEventListener('beforeinstallprompt', onOffer);
  window.addEventListener('appinstalled', onInstalled);
  modes.addEventListener('change', report);
  report();
  return () => {
    window.removeEventListener('beforeinstallprompt', onOffer);
    window.removeEventListener('appinstalled', onInstalled);
    modes.removeEventListener('change', report);
  };
}

/**
 * Shows Chromium's install dialog. Call it synchronously from the click handler: any await before prompt() loses the
 * user activation and Chrome rejects. Each offer can prompt once; a dismissed one may not come back for a while, so
 * hide your button until watchInstall reports a new offer.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const o = offer;
  if (!o) return 'unavailable';
  offer = null;
  await o.prompt();
  return (await o.userChoice).outcome;
}

const HINT_KEY = 'install-hint-shown'; // ADAPT: your storage namespace

export function installHintShown(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== null;
  } catch {
    return true; // storage blocked: don't nag on every visit
  }
}

/** Persist BEFORE showing the hint, so a reload can't repeat it. */
export function markInstallHintShown(): void {
  try {
    localStorage.setItem(HINT_KEY, String(Date.now()));
  } catch {
    /* storage blocked */
  }
}

/**
 * Unread count (or a plain dot with `true`) on the installed app's icon: Dock, taskbar, Home Screen. 0 or false clears.
 * Calls reject outside an installed app or without permission: expected, so ignored. Clear it when the user reads,
 * not only at launch. The service worker can set it too (sw.ts).
 */
export function setBadge(count: number | boolean): void {
  if (!('setAppBadge' in navigator)) return; // Firefox, Chrome Android
  const done = count === false || count === 0 ? navigator.clearAppBadge() : count === true ? navigator.setAppBadge() : navigator.setAppBadge(count);
  done.catch(() => {});
}

/** launchQueue, typed locally and checked at runtime (not in TypeScript's lib.dom). */
interface LaunchParamsLike {
  readonly targetURL?: unknown;
  readonly files?: unknown;
}
interface LaunchQueueLike {
  setConsumer(consumer: (params: LaunchParamsLike) => void): void;
}
const isLaunchQueue = (q: unknown): q is LaunchQueueLike =>
  typeof q === 'object' && q !== null && 'setConsumer' in q && typeof q.setConsumer === 'function';

/**
 * Routes launches that reuse this window (manifest launch_handler "focus-existing": icon, shortcut, captured link,
 * file or protocol launch) instead of ignoring them; focus-existing does not navigate by itself. File handles from
 * file_handlers arrive in `onFiles`. Call early on every launch. Returns false where launchQueue doesn't exist.
 */
export function consumeLaunches(
  onTarget: (url: URL) => void,
  onFiles?: (files: readonly FileSystemFileHandle[]) => void,
): boolean {
  const queue: unknown = Reflect.get(window, 'launchQueue');
  if (!isLaunchQueue(queue)) return false;
  queue.setConsumer((params) => {
    const raw: readonly unknown[] = Array.isArray(params.files) ? params.files : [];
    const files = raw.filter(
      (f): f is FileSystemFileHandle => typeof FileSystemFileHandle !== 'undefined' && f instanceof FileSystemFileHandle,
    );
    if (files.length > 0 && onFiles) onFiles(files);
    const url = launchTarget(params.targetURL, location.origin);
    if (url) onTarget(url);
  });
  return true;
}

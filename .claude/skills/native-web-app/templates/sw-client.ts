/**
 * sw-client.ts: the page side of sw.ts. Registers the worker, offers updates instead of forcing them, checks for
 * updates during long sessions, routes notification clicks in place, shows notifications through the worker
 * registration (the only kind phones show), subscribes to push, and recovers from chunk-load errors after a deploy.
 *
 * Browsers:
 *   service workers                    Chrome 40+, Firefox 44+, Safari 11.1+ / iOS 11.3+. Dev servers usually have no
 *                                      worker: test against the production build.
 *   registration.showNotification      everywhere with a worker, EXCEPT an iOS Safari tab, whose registration lacks
 *                                      showNotification and getNotifications (and where Notification is undefined).
 *   new Notification()                 desktop tabs only; it throws on Chrome Android and Samsung Internet.
 *   Push                               Chrome/Edge, Firefox, Safari 16+ macOS, iOS 16.4+ in Home Screen apps only.
 *                                      Ask from a click (Safari, Firefox 72+ require a gesture).
 *
 * Adapt: the worker URL and scope, your toast (onUpdateReady), your router (onNavigate), your push endpoint.
 * Decisions come from sw-logic.ts; the pure helpers here (base64UrlToBytes, isChunkLoadError) are unit-testable.
 * TypeScript 5.7+ (typed-array generics: Uint8Array<ArrayBuffer>).
 */
import { navigateTargetOf, SKIP_WAITING, shouldCheckForUpdate } from './sw-logic';

/* ------------------------------------------------------------------------------------------------- pure helpers */

/** A VAPID public key (base64url) as the bytes pushManager.subscribe wants. */
export function base64UrlToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** A lazily imported chunk of a previous build is gone (the host or the new worker deleted it). */
export function isChunkLoadError(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  return (
    reason.name === 'ChunkLoadError' || // webpack
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(reason.message)
  );
}

/* ------------------------------------------------------------------------------------------------- registration */

export interface RegisterOptions {
  /** The worker's URL. Never rename or move it after launch. */
  readonly url: string;
  readonly scope?: string;
  /**
   * A new version is waiting. Show a persistent, non-modal toast (role=status, so it doesn't steal focus from a
   * composer) with a Reload action that saves drafts and then calls `apply`. Never reload without the user's click.
   */
  readonly onUpdateReady: (apply: () => void) => void;
  /** First install finished: the app now works offline. Say so once per device. */
  readonly onOfflineReady?: () => void;
  /** A notification was clicked: route in place to this same-origin URL (and the pressed action, '' for the body). */
  readonly onNavigate?: (url: string, action: string) => void;
}

export interface Registered {
  readonly registration: ServiceWorkerRegistration;
  /** Removes the listeners and the update timer (tests, hot reload). */
  readonly dispose: () => void;
}

/** Registers the worker and wires the prompt-to-update flow. Null where service workers don't exist. */
export async function registerServiceWorker(options: RegisterOptions): Promise<Registered | null> {
  if (!('serviceWorker' in navigator)) return null;
  const container = navigator.serviceWorker;
  // updateViaCache 'none': the browser never answers the update check for sw.js (or its imports) from the HTTP cache.
  const registration = await container.register(options.url, {
    updateViaCache: 'none',
    ...(options.scope === undefined ? {} : { scope: options.scope }),
  });

  let reloading = false;
  // Updated on every controllerchange: a tab first opened uncontrolled (first visit) must still offer later updates.
  let controlled = container.controller !== null;

  const apply = () => {
    const waiting = registration.waiting;
    if (!waiting) return;
    reloading = true;
    waiting.postMessage(SKIP_WAITING);
  };
  const announce = () => {
    if (registration.waiting && container.controller) options.onUpdateReady(apply);
  };

  // A worker may already be waiting from an earlier visit.
  announce();
  const onUpdateFound = () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state !== 'installed') return;
      if (container.controller) announce();
      else options.onOfflineReady?.();
    });
  };
  registration.addEventListener('updatefound', onUpdateFound);

  // The new worker took control. Reload once if this tab asked for it; other tabs (which didn't ask) offer a reload
  // instead of losing their state. The first install's clientsClaim() also lands here, with nothing to reload.
  const onControllerChange = () => {
    const wasControlled = controlled;
    controlled = true;
    if (reloading) {
      reloading = false;
      location.reload();
    } else if (wasControlled) {
      options.onUpdateReady(() => location.reload());
    }
  };
  container.addEventListener('controllerchange', onControllerChange);

  const onMessage = (e: MessageEvent) => {
    const target = navigateTargetOf(e.data, location.origin);
    if (target) options.onNavigate?.(target.url, target.action);
  };
  container.addEventListener('message', onMessage);

  // Installed apps sit in the app switcher for days and rarely navigate; browsers otherwise only check sw.js on
  // navigations. update() rejects offline or on a 404: try again later.
  let lastCheck = Date.now();
  const check = () => {
    const now = Date.now();
    if (!shouldCheckForUpdate({ now, lastCheck, online: navigator.onLine, installing: registration.installing !== null })) return;
    lastCheck = now;
    registration.update().catch(() => {});
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') check();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const timer = window.setInterval(check, 60 * 60_000);

  return {
    registration,
    dispose: () => {
      registration.removeEventListener('updatefound', onUpdateFound);
      container.removeEventListener('controllerchange', onControllerChange);
      container.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(timer);
    },
  };
}

/* ------------------------------------------------------------------------------------------------- notifications */

const notificationsGranted = (): boolean => typeof Notification !== 'undefined' && Notification.permission === 'granted';

/**
 * iOS Safari tabs register a worker whose registration lacks these; check both, not one. showNotification also
 * rejects (TypeError) until the registration has an active worker, e.g. during the very first install.
 */
const workerCanNotify = (r: ServiceWorkerRegistration): boolean => r.active !== null && typeof r.showNotification === 'function' && typeof r.getNotifications === 'function';

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  return 'serviceWorker' in navigator ? navigator.serviceWorker.getRegistration() : undefined;
}

/**
 * Shows a notification through the worker (survives the page, routes through notificationclick), falling back to a
 * page notification for desktop tabs without a worker. Put a URL in `options.data.url` so the click can route.
 * Returns false when nothing could be shown (no permission, unsupported).
 */
export async function showNotification(title: string, options: NotificationOptions, onPageClick?: () => void): Promise<boolean> {
  if (!notificationsGranted()) return false; // typeof check first: iOS tabs have no Notification at all
  const reg = await registration();
  if (reg && workerCanNotify(reg)) {
    await reg.showNotification(title, options);
    return true;
  }
  try {
    const n = new Notification(title, options); // desktop tab only; throws on Chrome Android
    n.onclick = () => {
      window.focus();
      onPageClick?.();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * Closes the notifications whose data matches, e.g. when their conversation is opened or read. Match on data, not
 * tag: Safari ignores tag. Mark read only while the page is visible.
 */
export async function closeNotifications(matches: (data: unknown) => boolean): Promise<void> {
  const reg = await registration();
  if (!reg || !workerCanNotify(reg)) return;
  for (const n of await reg.getNotifications()) {
    const data: unknown = n.data;
    if (matches(data)) n.close();
  }
}

export type PushResult = 'unsupported' | 'denied' | PushSubscriptionJSON;

/**
 * Asks for notification permission and subscribes to Web Push. Call from a click handler, with an explanation shown
 * first; never on load. 'unsupported' on iOS outside a Home Screen app: explain Add to Home Screen there. Send the
 * returned JSON (endpoint + keys) to your push sender, and re-run on later launches to keep the subscription alive.
 */
export async function subscribePush(vapidPublicKey: string): Promise<PushResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  // A subscription made with a different VAPID key makes subscribe() throw InvalidStateError: unsubscribe it first
  // if you rotate keys.
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(vapidPublicKey) }));
  return sub.toJSON();
}

/* ------------------------------------------------------------------------------------------------- deploy recovery */

/**
 * After a deploy, a lazily imported chunk of the old build may be gone. Save state and reload once (never loop),
 * instead of showing a broken screen. Listens for Vite's 'vite:preloadError' and for unhandled chunk-load rejections.
 * Serve index.html with Cache-Control: no-cache, and precache every lazy chunk so the running version stays whole
 * offline. Returns a cleanup.
 */
export function reloadOnChunkError(save: () => Promise<void> | void): () => void {
  const KEY = 'chunk-reload'; // ADAPT: storage namespace
  const recover = (e: Event) => {
    try {
      if (sessionStorage.getItem(KEY)) return; // one try per session
      sessionStorage.setItem(KEY, '1');
    } catch {
      return;
    }
    e.preventDefault();
    void Promise.resolve(save()).finally(() => location.reload());
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    if (isChunkLoadError(e.reason)) recover(e);
  };
  window.addEventListener('vite:preloadError', recover);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('vite:preloadError', recover);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

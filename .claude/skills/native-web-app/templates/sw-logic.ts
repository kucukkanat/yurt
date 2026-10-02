/**
 * sw-logic.ts: every decision the service worker (sw.ts) and its page glue (sw-client.ts) make, as pure functions.
 *
 * Worker bugs only show up in production builds and on phones, so keep the worker and the page glue as thin wiring
 * and unit-test this module instead. It uses nothing but URL and plain objects, so it compiles under both the DOM and
 * the WebWorker TypeScript libs and runs in any test runner.
 *
 * Everything that arrives here is external input (push payloads from a server, notification data written by an older
 * app version, postMessage data from another tab or worker version): `unknown` until checked. Swap the hand-written
 * checks for your schema library (Valibot, Zod) if you have one.
 *
 * Adapt: DEFAULT_TITLE, the message type names, the push payload shape your server sends.
 */

export const DEFAULT_TITLE = 'New activity'; // ADAPT: shown when a push payload can't be read (never show nothing)

/** Page -> waiting worker: "activate now" (the user accepted the update). Same shape as workbox-window's. */
export const SKIP_WAITING = { type: 'SKIP_WAITING' } as const;

/** Worker -> page: "route to this URL in place" (a notification was clicked). */
export const NAVIGATE = 'app:navigate';
export interface NavigateMessage {
  readonly type: typeof NAVIGATE;
  readonly url: string;
  /** The notification action button that was pressed ('' for the body). */
  readonly action: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
/** A badge count: a non-negative integer, or its decimal string (WebKit's Declarative Web Push example sends "1"). */
const count = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};

export const isSkipWaiting = (data: unknown): boolean => isRecord(data) && data['type'] === SKIP_WAITING.type;

/** Whether `url` is inside the worker's `scope` (same origin, path under the scope path). */
export function inScope(url: string, scope: string): boolean {
  try {
    const u = new URL(url, scope);
    const s = new URL(scope);
    return u.origin === s.origin && u.pathname.startsWith(s.pathname);
  } catch {
    return false;
  }
}

/** What a push or a notification should show and open. */
export interface PushNotice {
  readonly title: string;
  readonly body?: string;
  /** In-scope URL to open on click. */
  readonly url?: string;
  /** Collapses notifications per conversation (Chromium/Firefox; Safari ignores tag, so close by data instead). */
  readonly tag?: string;
  /** App icon badge count. */
  readonly badge?: number;
}

function notice(title: string, fields: { body?: string | undefined; url?: string | undefined; tag?: string | undefined; badge?: number | undefined }): PushNotice {
  return {
    title,
    ...(fields.body === undefined ? {} : { body: fields.body }),
    ...(fields.url === undefined ? {} : { url: fields.url }),
    ...(fields.tag === undefined ? {} : { tag: fields.tag }),
    ...(fields.badge === undefined ? {} : { badge: fields.badge }),
  };
}

/**
 * Reads a push payload: either the plain shape `{ title, body?, url?, tag?, badge? }`, or Declarative Web Push
 * (`{ web_push: 8030, notification: { title, body?, navigate, tag?, app_badge? }, app_badge?, mutable? }`, Safari
 * 18.4+; the spec draft puts app_badge at the top level, WebKit's example inside notification, so both are read), which
 * other browsers deliver to the worker as an ordinary push. Null when unreadable: the caller must still show something.
 * URLs outside `scope` are dropped.
 */
export function parsePush(text: string | null | undefined, scope: string): PushNotice | null {
  if (!text) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const inScopeUrl = (v: unknown): string | undefined => {
    const s = str(v);
    return s !== undefined && inScope(s, scope) ? new URL(s, scope).href : undefined;
  };
  const n = data['notification'];
  if (data['web_push'] === 8030 && isRecord(n)) {
    const title = str(n['title']);
    if (title === undefined) return null;
    return notice(title, { body: str(n['body']), url: inScopeUrl(n['navigate']), tag: str(n['tag']), badge: count(data['app_badge'] ?? n['app_badge']) });
  }
  const title = str(data['title']);
  if (title === undefined) return null;
  return notice(title, { body: str(data['body']), url: inScopeUrl(data['url']), tag: str(data['tag']), badge: count(data['badge']) });
}

/** Notification data we write, and read back on click. Keep it small and serialisable. */
export const noticeData = (n: PushNotice): { readonly url?: string } => (n.url === undefined ? {} : { url: n.url });

/** Where a clicked notification should go: its stored in-scope URL, or the app's start (the scope). */
export function noticeUrl(data: unknown, scope: string): string {
  const url = isRecord(data) ? str(data['url']) : undefined;
  return url !== undefined && inScope(url, scope) ? new URL(url, scope).href : scope;
}

export const navigateMessage = (url: string, action = ''): NavigateMessage => ({ type: NAVIGATE, url, action });

/** The URL a worker message asks the page to route to, or null if it isn't one (or points off-origin). */
export function navigateTargetOf(data: unknown, origin: string): { readonly url: string; readonly action: string } | null {
  if (!isRecord(data) || data['type'] !== NAVIGATE) return null;
  const url = str(data['url']);
  if (url === undefined) return null;
  try {
    if (new URL(url).origin !== origin) return null;
  } catch {
    return null;
  }
  return { url, action: str(data['action']) ?? '' };
}

/**
 * The window a notification click should reuse: the focused one, else a visible one, else the most recently focused
 * (clients.matchAll returns them in that order). Undefined means open a new window.
 */
export function pickWindow<T extends { readonly focused: boolean; readonly visibilityState: string }>(windows: readonly T[]): T | undefined {
  return windows.find((w) => w.focused) ?? windows.find((w) => w.visibilityState === 'visible') ?? windows[0];
}

/** Long-lived installed apps rarely navigate, so check for a new worker on return, at most once per `everyMs`. */
export const shouldCheckForUpdate = (s: {
  readonly now: number;
  readonly lastCheck: number;
  readonly online: boolean;
  readonly installing: boolean;
  readonly everyMs?: number;
}): boolean => s.online && !s.installing && s.now - s.lastCheck >= (s.everyMs ?? 60 * 60_000);

/** Runtime caches this worker version keeps; anything else that isn't Workbox's precache is deleted on activate. */
export const isStaleCache = (name: string, keep: ReadonlySet<string>): boolean => !name.startsWith('workbox-precache') && !keep.has(name);

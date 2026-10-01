import { normalizeCode } from '@yurt/protocol';

/** Where the app is: a workspace, a conversation in it, and an open thread. */
export interface Route {
  code?: string | undefined;
  ch?: string | undefined;
  thread?: string | undefined;
}

/** decodeURIComponent, but a malformed escape (a hand-edited or truncated link) stays as typed instead of throwing. */
const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** "#/w/CODE/c/channel/t/thread" → Route. Unknown segments (e.g. an invite's /k/…) are ignored; never throws. */
export function parseHash(h: string): Route {
  const p = h.replace(/^#\/?/, '').split('/').map(decode);
  const r: Route = {};
  for (let i = 0; i < p.length; i += 2) {
    const val = p[i + 1];
    if (p[i] === 'w') r.code = normalizeCode(val ?? '') || undefined;
    if (p[i] === 'c' && val) r.ch = val;
    if (p[i] === 't' && val) r.thread = val;
  }
  return r;
}

/** Route → hash. A channel needs a workspace and a thread needs a channel, so stray parts are dropped. */
export function buildHash(r: Route): string {
  if (!r.code) return '#/';
  if (!r.ch) return '#/w/' + r.code;
  return '#/w/' + r.code + '/c/' + encodeURIComponent(r.ch) + (r.thread ? '/t/' + encodeURIComponent(r.thread) : '');
}

import { normalizeCode } from './codes';
import { isWorkspaceKey, newWorkspaceKey } from './seal';

/**
 * How a workspace moves its events. Fixed at creation and carried by the invite link, because
 * members on different transports can't reach each other. Both carry a 256-bit key that exists
 * only in invite links; the 8-char code is just the workspace id.
 * - trystero: live WebRTC between online members; history lives only on members' devices.
 *   Without `key` it's a legacy workspace whose room is derived from the guessable code.
 * - nostr: events are encrypted and stored on relays, so they arrive even when nobody is online.
 */
export type WsTransport =
  | { readonly kind: 'trystero'; readonly key?: string }
  | { readonly kind: 'nostr'; readonly key: string; readonly relays: readonly string[] };

export type KeyedTransport = WsTransport & { readonly key: string };

export interface Invite { readonly code: string; readonly transport: KeyedTransport }

/** Workspaces created before invites carried keys. Kept working for existing members; can't be joined anew. */
export const LEGACY_TRYSTERO: WsTransport = { kind: 'trystero' };

export const isLegacy = (t: WsTransport): boolean => !t.key;

export const DEFAULT_RELAYS: readonly string[] = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

/** Relay URLs from free text (one per line, spaces or commas); keeps only wss:// and ws:// URLs. */
export function parseRelays(s: string): string[] {
  return [...new Set(s.split(/[\s,]+/).filter((u) => /^wss?:\/\/[^\s/]+/.test(u)))];
}

export const newTrysteroTransport = (): KeyedTransport => ({ kind: 'trystero', key: newWorkspaceKey() });

export function newNostrTransport(relays: readonly string[] = DEFAULT_RELAYS): KeyedTransport {
  return { kind: 'nostr', key: newWorkspaceKey(), relays: relays.length ? relays : DEFAULT_RELAYS };
}

const sameRelays = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((u, i) => u === b[i]);

/** "#/w/CODE/k/KEY" for Trystero; "#/w/CODE/k/KEY/n/<relays or ->" for Nostr ("-" = default relays). */
export function inviteHash({ code, transport: t }: Invite): string {
  const base = '#/w/' + code + '/k/' + t.key;
  if (t.kind === 'trystero') return base;
  return base + '/n/' + (sameRelays(t.relays, DEFAULT_RELAYS) ? '-' : encodeURIComponent(t.relays.join(',')));
}

/** Parses an invite link or its hash. Null for anything without a valid key: bare codes can't be joined safely. */
export function parseInvite(input: string): Invite | null {
  const code = normalizeCode(input);
  if (!code) return null;
  const seg = input.trim().replace(/^.*?#\/?/, '').split('/');
  const at = (k: string) => { const i = seg.indexOf(k); return i >= 0 ? decodeURIComponent(seg[i + 1] ?? '') : undefined; };
  const key = at('k');
  if (key === undefined || !isWorkspaceKey(key)) return null;
  const n = at('n');
  if (n === undefined) return { code, transport: { kind: 'trystero', key } };
  const relays = parseRelays(n);
  return { code, transport: { kind: 'nostr', key, relays: relays.length ? relays : DEFAULT_RELAYS } };
}

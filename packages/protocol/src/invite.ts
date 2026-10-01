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
/**
 * How WebRTC peers find each other (Trystero strategy). Members must share the method and at least
 * one server to ever meet, so it belongs to the workspace and travels in the invite link.
 * Empty `urls` = the strategy's built-in public servers.
 */
export type SignalKind = 'nostr' | 'torrent';
export interface Signaling { readonly kind: SignalKind; readonly urls: readonly string[] }
export const SIGNAL_KINDS: readonly SignalKind[] = ['nostr', 'torrent'];

export type WsTransport =
  | { readonly kind: 'trystero'; readonly key?: string; readonly signal?: Signaling }
  | { readonly kind: 'nostr'; readonly key: string; readonly relays: readonly string[] };

export type KeyedTransport = WsTransport & { readonly key: string };

/**
 * `creator` pins the workspace creator's Ed25519 public key (64 lowercase hex) so a joiner can't be
 * fooled by a forged or backdated ws.create. Links from before it existed omit it (TOFU on first join).
 */
export interface Invite { readonly code: string; readonly transport: KeyedTransport; readonly creator?: string }

const isPubKey = (s: string) => /^[0-9a-f]{64}$/.test(s);

/** Workspaces created before invites carried keys. Kept working for existing members; can't be joined anew. */
export const LEGACY_TRYSTERO: WsTransport = { kind: 'trystero' };

export const isLegacy = (t: WsTransport): boolean => !t.key;

// Defaults members can change per workspace. Links made with three default relays still overlap on nos.lol.
export const DEFAULT_RELAYS: readonly string[] = ['wss://nos.lol'];
/** Where new peer-to-peer workspaces find each other unless the user picks otherwise (Nostr signaling). */
export const DEFAULT_SIGNAL_URLS: readonly string[] = ['wss://nos.lol'];

/** Relay URLs from free text (one per line, spaces or commas); keeps only wss:// and ws:// URLs. */
export function parseRelays(s: string): string[] {
  return [...new Set(s.split(/[\s,]+/).filter((u) => /^wss?:\/\/[^\s/]+/.test(u)))];
}

/** The default (Nostr relays, built-in servers) is left out, so links stay short. */
export const newTrysteroTransport = (signal?: Signaling): KeyedTransport =>
  signal && (signal.kind !== 'nostr' || signal.urls.length) ? { kind: 'trystero', key: newWorkspaceKey(), signal } : { kind: 'trystero', key: newWorkspaceKey() };

/** Where this workspace's WebRTC room is signaled: relay workspaces use their own relays. */
export function signalingOf(t: WsTransport): Signaling {
  return t.kind === 'nostr' ? { kind: 'nostr', urls: t.relays } : t.signal ?? { kind: 'nostr', urls: [] };
}

export function newNostrTransport(relays: readonly string[] = DEFAULT_RELAYS): KeyedTransport {
  return { kind: 'nostr', key: newWorkspaceKey(), relays: relays.length ? relays : DEFAULT_RELAYS };
}

const sameRelays = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((u, i) => u === b[i]);

/**
 * "#/w/CODE/k/KEY" for Trystero; "#/w/CODE/k/KEY/n/<relays or ->" for Nostr ("-" = default relays);
 * either followed by "/o/<creator pubkey>" when the creator is known.
 */
export function inviteHash({ code, transport: t, creator }: Invite): string {
  const base = '#/w/' + code + '/k/' + t.key;
  const net = t.kind === 'trystero'
    ? (t.signal ? '/s/' + encodeURIComponent([t.signal.kind, ...t.signal.urls].join(',')) : '')
    : '/n/' + (sameRelays(t.relays, DEFAULT_RELAYS) ? '-' : encodeURIComponent(t.relays.join(',')));
  return base + net + (creator ? '/o/' + creator : '');
}

/** Parses an invite link or its hash. Null for anything without a valid key: bare codes can't be joined safely. */
export function parseInvite(input: string): Invite | null {
  const code = normalizeCode(input);
  if (!code) return null;
  const seg = input.trim().replace(/^.*?#\/?/, '').split('/');
  // Links are pasted by users, so a malformed percent-escape is just an invalid link: null, not a URIError.
  const at = (k: string) => { const i = seg.indexOf(k); if (i < 0) return undefined; try { return decodeURIComponent(seg[i + 1] ?? ''); } catch { return null; } };
  const key = at('k'), n = at('n'), o = at('o'), sig = at('s');
  if (typeof key !== 'string' || !isWorkspaceKey(key) || n === null || sig === null) return null;
  const creator = o && isPubKey(o) ? { creator: o } : {};
  if (n === undefined) {
    if (sig === undefined) return { code, transport: { kind: 'trystero', key }, ...creator };
    const [kind, ...rest] = sig.split(',');
    // An unknown method would put this member where nobody else looks: refuse the link instead.
    if (!SIGNAL_KINDS.includes(kind as SignalKind)) return null;
    return { code, transport: { kind: 'trystero', key, signal: { kind: kind as SignalKind, urls: parseRelays(rest.join(',')) } }, ...creator };
  }
  const relays = parseRelays(n);
  return { code, transport: { kind: 'nostr', key, relays: relays.length ? relays : DEFAULT_RELAYS }, ...creator };
}

import { normalizeCode } from './codes';
import { isWorkspaceKey, newWorkspaceKey } from './seal';

/**
 * Where a workspace's events live: end-to-end encrypted on these Nostr relays, so they arrive even
 * when nobody else is online. Carried by the invite link with the 256-bit key, which exists only in
 * invite links; the 8-char code is just the workspace id. Calls signal their WebRTC room over the same relays.
 */
export interface WsTransport {
  readonly key: string;
  readonly relays: readonly string[];
}

/**
 * `creator` pins the workspace creator's Ed25519 public key (64 lowercase hex) so a joiner can't be
 * fooled by a forged or backdated ws.create. Links without it fall back to trust on first use.
 */
export interface Invite {
  readonly code: string;
  readonly transport: WsTransport;
  readonly creator?: string;
}

const isPubKey = (s: string) => /^[0-9a-f]{64}$/.test(s);

// Members can change these per workspace.
export const DEFAULT_RELAYS: readonly string[] = ['wss://nos.lol'];

/** Relay URLs from free text (one per line, spaces or commas); keeps only wss:// and ws:// URLs. */
export function parseRelays(s: string): string[] {
  return [...new Set(s.split(/[\s,]+/).filter((u) => /^wss?:\/\/[^\s/]+/.test(u)))];
}

export function newNostrTransport(relays: readonly string[] = DEFAULT_RELAYS): WsTransport {
  return { key: newWorkspaceKey(), relays: relays.length ? relays : DEFAULT_RELAYS };
}

const sameRelays = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((u, i) => u === b[i]);

/** "#/w/CODE/k/KEY/n/<relays or ->" ("-" = default relays), followed by "/o/<creator pubkey>" when the creator is known. */
export function inviteHash({ code, transport: t, creator }: Invite): string {
  const relays = sameRelays(t.relays, DEFAULT_RELAYS) ? '-' : encodeURIComponent(t.relays.join(','));
  return '#/w/' + code + '/k/' + t.key + '/n/' + relays + (creator ? '/o/' + creator : '');
}

/** Parses an invite link or its hash. Null for anything without a valid key and relays: bare codes can't be joined safely. */
export function parseInvite(input: string): Invite | null {
  const code = normalizeCode(input);
  if (!code) return null;
  const seg = input
    .trim()
    .replace(/^.*?#\/?/, '')
    .split('/');
  // Links are pasted by users, so a malformed percent-escape is just an invalid link: null, not a URIError.
  const at = (k: string) => {
    const i = seg.indexOf(k);
    if (i < 0) return undefined;
    try {
      return decodeURIComponent(seg[i + 1] ?? '');
    } catch {
      return null;
    }
  };
  const key = at('k'),
    n = at('n'),
    o = at('o');
  if (typeof key !== 'string' || !isWorkspaceKey(key) || typeof n !== 'string') return null;
  const creator = o && isPubKey(o) ? { creator: o } : {};
  const relays = parseRelays(n);
  return { code, transport: { key, relays: relays.length ? relays : DEFAULT_RELAYS }, ...creator };
}

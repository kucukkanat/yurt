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
 * A link that carries the workspace key itself, as every link did before join approval. Still accepted: whoever
 * holds one gets in, until an admin rotates the key. `creator` pins the workspace creator's Ed25519 public key
 * (64 lowercase hex) so a joiner can't be fooled by a forged or backdated ws.create. Links without it fall back to
 * trust on first use.
 */
export interface KeyInvite {
  readonly code: string;
  readonly transport: WsTransport;
  readonly creator?: string;
}

/**
 * A link that only lets someone ask to join: it carries an invite's join key (see join.ts), never the workspace
 * key. The creator is required: it's how a joiner tells a real admin's answer from a forged one.
 */
export interface JoinInvite {
  readonly code: string;
  readonly join: string;
  readonly relays: readonly string[];
  readonly creator: string;
}

export type Invite = KeyInvite | JoinInvite;

export const isJoinInvite = (i: Invite): i is JoinInvite => 'join' in i;

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
const relaysPart = (relays: readonly string[]) => (sameRelays(relays, DEFAULT_RELAYS) ? '-' : encodeURIComponent(relays.join(',')));

/** "#/w/CODE/k/KEY/n/<relays or ->" ("-" = default relays), followed by "/o/<creator pubkey>" when the creator is known. */
export function inviteHash({ code, transport: t, creator }: KeyInvite): string {
  return '#/w/' + code + '/k/' + t.key + '/n/' + relaysPart(t.relays) + (creator ? '/o/' + creator : '');
}

/** "#/w/CODE/j/JOINKEY/n/<relays or ->/o/<creator pubkey>": a link to ask to join. */
export function joinHash({ code, join, relays, creator }: JoinInvite): string {
  return '#/w/' + code + '/j/' + join + '/n/' + relaysPart(relays) + '/o/' + creator;
}

/**
 * Parses an invite link or its hash. Null for anything without a valid key (or join key and creator) and relays:
 * bare codes can't be joined safely. A link with both keys is read as the older kind, which needs no approval.
 */
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
    join = at('j'),
    n = at('n'),
    o = at('o');
  if (typeof n !== 'string') return null;
  const parsed = parseRelays(n);
  const relays = parsed.length ? parsed : DEFAULT_RELAYS;
  const creator = o && isPubKey(o) ? o : undefined;
  if (typeof key === 'string' && isWorkspaceKey(key)) return { code, transport: { key, relays }, ...(creator ? { creator } : {}) };
  return typeof join === 'string' && isWorkspaceKey(join) && creator ? { code, join, relays, creator } : null;
}

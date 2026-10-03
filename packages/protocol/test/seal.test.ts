import { describe, it, expect } from 'vitest';
import {
  keyFromPhrase,
  newRecoveryPhrase,
  newWorkspaceKey,
  isWorkspaceKey,
  workspaceKeys,
  seal,
  open,
  inviteHash,
  parseInvite,
  parseRelays,
  newNostrTransport,
  padSize,
  DEFAULT_RELAYS,
} from '../src';

const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());
const K = workspaceKeys(newWorkspaceKey());

describe('seal', () => {
  it('round-trips under the same key and tag', () => {
    expect(open(K.enc, K.tag, seal(K.enc, K.tag, 'héllo 👋'))).toBe('héllo 👋');
  });

  it('uses a fresh nonce every time', () => {
    expect(seal(K.enc, K.tag, 'x')).not.toBe(seal(K.enc, K.tag, 'x'));
  });

  it('rejects the wrong workspace key, a different tag, tampering and garbage', () => {
    const s = seal(K.enc, K.tag, 'secret');
    const other = workspaceKeys(newWorkspaceKey());
    expect(open(other.enc, K.tag, s)).toBeNull();
    expect(open(K.enc, other.tag, s)).toBeNull();
    const flipped = s.slice(0, -2) + (s.at(-2) === 'A' ? 'B' : 'A') + s.at(-1);
    expect(open(K.enc, K.tag, flipped)).toBeNull();
    expect(open(K.enc, K.tag, 'AAAA')).toBeNull();
    expect(open(K.enc, K.tag, '!!not base64!!')).toBeNull();
  });

  it('derives deterministic, key-specific tags and inboxes', () => {
    const key = newWorkspaceKey();
    expect(workspaceKeys(key).tag).toBe(workspaceKeys(key).tag);
    expect(workspaceKeys(key).inbox(A.pub)).toBe(workspaceKeys(key).inbox(A.pub));
    expect(K.inbox(A.pub)).not.toBe(K.inbox(B.pub));
    expect(K.tag).toMatch(/^[0-9a-f]{32}$/);
    expect(K.tag).not.toBe(workspaceKeys(newWorkspaceKey()).tag);
  });

  it('gives a DM pair the same key from both sides and a third member none that works', () => {
    const ab = K.pair(A.sec, B.pub);
    expect(K.pair(B.sec, A.pub)).toEqual(ab);
    const s = seal(ab, K.inbox(B.pub), 'just us');
    expect(open(K.pair(B.sec, A.pub), K.inbox(B.pub), s)).toBe('just us');
    expect(open(K.pair(C.sec, A.pub), K.inbox(B.pub), s)).toBeNull();
    expect(open(K.pair(C.sec, B.pub), K.inbox(B.pub), s)).toBeNull();
    expect(open(K.enc, K.inbox(B.pub), s)).toBeNull();
  });

  it('pads plaintext into coarse size buckets', () => {
    const len = (t: string) => seal(K.enc, K.tag, t).length;
    expect(len('a')).toBe(len('a'.repeat(200)));
    expect(len('a'.repeat(300))).toBeGreaterThan(len('a'));
    expect([1, 256, 257, 1024, 4096, 65_536, 65_537, 200_000].map(padSize)).toEqual([256, 256, 1024, 1024, 4096, 65_536, 131_072, 262_144]);
    expect(open(K.enc, K.tag, seal(K.enc, K.tag, ''))).toBe('');
  });

  it('handles large payloads without overflowing the stack', () => {
    const big = 'x'.repeat(300_000);
    expect(open(K.enc, K.tag, seal(K.enc, K.tag, big))).toBe(big);
  });

  it('validates workspace keys', () => {
    expect(isWorkspaceKey(newWorkspaceKey())).toBe(true);
    expect(isWorkspaceKey('short')).toBe(false);
    expect(isWorkspaceKey('!'.repeat(43))).toBe(false);
    expect(() => workspaceKeys('nope')).toThrow('invalid workspace key');
  });
});

describe('invite', () => {
  it('refuses links without relays, and ignores old signaling segments', () => {
    const key = newWorkspaceKey();
    expect(parseInvite(`#/w/K7QX2MPD/k/${key}`)).toBeNull();
    expect(parseInvite(`#/w/K7QX2MPD/k/${key}/s/nostr`)).toBeNull();
    expect(parseInvite(`#/w/K7QX2MPD/k/${key}/s/torrent/n/-`)).toEqual({ code: 'K7QX2MPD', transport: { key, relays: DEFAULT_RELAYS } });
  });

  it('round-trips a Nostr invite with default relays as "-"', () => {
    const inv = { code: 'K7QX2MPD', transport: newNostrTransport() };
    const h = inviteHash(inv);
    expect(h.endsWith('/n/-')).toBe(true);
    expect(parseInvite('https://x.io/yurt/' + h)).toEqual(inv);
  });

  it('round-trips custom relays', () => {
    const inv = { code: 'K7QX2MPD', transport: newNostrTransport(['ws://127.0.0.1:7000', 'wss://r.example']) };
    expect(parseInvite(inviteHash(inv))).toEqual(inv);
  });

  it('refuses bare codes, code-only links, bad codes and malformed keys', () => {
    expect(parseInvite('k7qx-2mpd')).toBeNull();
    expect(parseInvite('https://x.io/yurt/#/w/K7QX2MPD')).toBeNull();
    expect(parseInvite('#/w/NOPE/k/' + newWorkspaceKey() + '/n/-')).toBeNull();
    expect(parseInvite('#/w/K7QX2MPD/k/tooshort/n/-')).toBeNull();
  });

  it('pins the creator key with /o/', () => {
    const creator = 'ab'.repeat(32);
    const inv = { code: 'K7QX2MPD', transport: newNostrTransport(), creator };
    const h = inviteHash(inv);
    expect(h.endsWith('/o/' + creator)).toBe(true);
    expect(parseInvite('https://x.io/yurt/' + h + '/c/general')).toEqual(inv);
  });

  it('treats a malformed creator as absent, so old-style TOFU applies', () => {
    const key = newWorkspaceKey();
    for (const o of ['AB'.repeat(32), 'ab'.repeat(31), 'zz'.repeat(32), '']) {
      const inv = parseInvite(`#/w/K7QX2MPD/k/${key}/n/-/o/${o}`);
      expect(inv).toEqual({ code: 'K7QX2MPD', transport: { key, relays: DEFAULT_RELAYS } });
      expect(inv && 'creator' in inv).toBe(false);
    }
  });

  it('returns null, not a URIError, for malformed percent-encoding', () => {
    const key = newWorkspaceKey();
    expect(parseInvite(`#/w/K7QX2MPD/k/${key}/n/%E0`)).toBeNull();
    expect(parseInvite(`#/w/K7QX2MPD/k/%E0${key}`)).toBeNull();
    expect(parseInvite(`#/w/K7QX2MPD/k/${key}/n/-/o/%`)).toEqual({ code: 'K7QX2MPD', transport: { key, relays: DEFAULT_RELAYS } });
  });

  it('falls back to default relays when none are usable', () => {
    expect(newNostrTransport([])).toMatchObject({ relays: DEFAULT_RELAYS });
    const key = newWorkspaceKey();
    expect(parseInvite(`#/w/K7QX2MPD/k/${key}/n/${encodeURIComponent('http://nope')}`)).toMatchObject({ transport: { key, relays: DEFAULT_RELAYS } });
  });

  it('parses relay lists from free text', () => {
    expect(parseRelays('wss://a.io\n wss://b.io, http://c.io wss://a.io ws://127.0.0.1:1')).toEqual(['wss://a.io', 'wss://b.io', 'ws://127.0.0.1:1']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOSSOM,
  DEFAULT_RELAYS,
  LEGACY_TRYSTERO,
  formatCode,
  keyFromPhrase,
  makeEvent,
  newInviteCode,
  newRecoveryPhrase,
  newWorkspaceKey,
  normalizeCode,
} from '@yurt/protocol';
import { DEFAULT_SETTINGS, loadBlob, loadEvents, loadIdentity, loadMark, loadSettings, loadToken, loadWorkspaces, uploadServers } from '../src/lib/stored';
import { anything, fc } from './fuzz';

const code = newInviteCode();
const key = newWorkspaceKey();
const creator = 'ab'.repeat(32);
const base = { code, name: 'Team', creator, lastRead: { general: 5 }, muted: ['random'] };

describe('stored workspaces', () => {
  it('load every transport shape the app writes, and records from before transports', () => {
    const nostr = { ...base, transport: { kind: 'nostr', key, relays: ['wss://r.example'] }, blossom: ['https://b.example'] };
    const trystero = { ...base, code: newInviteCode(), transport: { kind: 'trystero', key, signal: { kind: 'torrent', urls: ['wss://t.example'] } } };
    const bare = { ...base, code: newInviteCode(), transport: { kind: 'trystero' } };
    const old = { ...base, code: newInviteCode() };
    expect(loadWorkspaces([nostr, trystero, bare, old])).toEqual([nostr, trystero, bare, { ...old, transport: LEGACY_TRYSTERO }]);
  });

  it('fall back to safe values for bad fields', () => {
    const [w] = loadWorkspaces([
      {
        code,
        name: 42,
        transport: { kind: 'trystero', key, signal: { kind: 'carrier-pigeon', urls: [] } },
        creator: 'not-hex',
        lastRead: { general: 'yesterday', ok: 3, ['__proto__']: 9, inf: Number.POSITIVE_INFINITY },
        muted: ['a', 1, null],
        blossom: 'https://b.example',
      },
    ]);
    expect(w).toEqual({ code, name: formatCode(code), transport: { kind: 'trystero', key }, creator: null, lastRead: { ok: 3, ['__proto__']: 9 }, muted: ['a'] });
    expect(Object.getPrototypeOf(w?.lastRead)).toBeNull();
    expect(loadWorkspaces([{ ...base, lastRead: 'x', muted: 'y' }])[0]).toMatchObject({ lastRead: {}, muted: [] });
    // A minimal record (only what can't be defaulted) still loads.
    expect(loadWorkspaces([{ code }])).toEqual([{ code, name: formatCode(code), transport: LEGACY_TRYSTERO, creator: null, lastRead: {}, muted: [] }]);
    // A relay workspace that lost its relays gets the built-ins back, so it can sync again.
    expect(loadWorkspaces([{ ...base, transport: { kind: 'nostr', key, relays: [] } }])[0]?.transport).toEqual({ kind: 'nostr', key, relays: [...DEFAULT_RELAYS] });
  });

  it('skip records that can’t connect, and keep the first of a code', () => {
    const second = { ...base, name: 'Duplicate' };
    expect(
      loadWorkspaces([
        null,
        'x',
        [code],
        { ...base, code: 'nope' },
        { ...base, code: code.toLowerCase() },
        { ...base, transport: { kind: 'nostr', relays: ['wss://r.example'] } }, // no key
        { ...base, transport: { kind: 'nostr', key: 'short', relays: [] } },
        { ...base, transport: { kind: 'wormhole' } },
        { ...base, transport: { kind: 'trystero', key: 'short' } },
        base,
        second,
      ]),
    ).toEqual([{ ...base, transport: LEGACY_TRYSTERO }]);
    expect(loadWorkspaces(undefined)).toEqual([]);
    expect(loadWorkspaces({ 0: base })).toEqual([]);
  });

  it('never throw, and only return usable, unique workspaces', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(anything, fc.record({ code: fc.constantFrom(code, 'X'), transport: anything, lastRead: anything, muted: anything }))), (raw) => {
        const ws = loadWorkspaces(raw);
        expect(new Set(ws.map((w) => w.code)).size).toBe(ws.length);
        for (const w of ws) expect(normalizeCode(w.code)).toBe(w.code);
      }),
    );
    fc.assert(fc.property(anything, (raw) => void loadWorkspaces(raw)));
  });
});

describe('stored identity', () => {
  const phrase = newRecoveryPhrase();
  const keys = keyFromPhrase(phrase);

  it('derives keys from the phrase, so stale or edited keys can’t win', () => {
    expect(loadIdentity({ phrase, name: 'Ada', handle: 'ada', pub: 'old', sec: 'old' })).toEqual({ ...keys, phrase, name: 'Ada', handle: 'ada' });
  });

  it('fills a missing name and handle', () => {
    expect(loadIdentity({ phrase })).toEqual({ ...keys, phrase, name: 'Me', handle: 'me' });
    expect(loadIdentity({ phrase, name: 'Ada Lovelace', handle: '  ' })).toMatchObject({ name: 'Ada Lovelace', handle: 'ada-lovelace' });
    expect(loadIdentity({ phrase, name: ' ', handle: 7 })).toMatchObject({ name: 'Me', handle: 'me' });
  });

  it('is null without a valid phrase', () => {
    expect(loadIdentity(undefined)).toBeNull();
    expect(loadIdentity('phrase')).toBeNull();
    expect(loadIdentity({ name: 'Ada' })).toBeNull();
    expect(loadIdentity({ phrase: 'not a real recovery phrase at all' })).toBeNull();
    fc.assert(fc.property(anything, (raw) => void loadIdentity(raw)));
  });
});

describe('stored settings', () => {
  it('are the defaults when missing or not an object', () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('keep valid values and replace bad ones with defaults', () => {
    const good = {
      theme: 'light',
      notifications: true,
      haptics: false,
      installHint: true,
      turn: 'custom',
      turnUrls: 'turn:x',
      turnUser: 'u',
      turnPass: 'p',
      webrtc: true,
    } as const;
    expect(loadSettings(good)).toEqual(good);
    const bad = { theme: 'neon', notifications: 'yes', haptics: 0, installHint: 'no', turn: 1, turnUrls: null, webrtc: 'on', extra: 1 };
    expect(loadSettings(bad)).toEqual(DEFAULT_SETTINGS);
  });

  it('carry lastNet, migrating an older version’s network defaults once', () => {
    const lastNet = { nostr: { relays: ['wss://r.example'], blossom: [] } };
    expect(loadSettings({ lastNet })).toEqual({ ...DEFAULT_SETTINGS, lastNet });
    expect(loadSettings({ relays: 'wss://old.example' }).lastNet?.nostr?.relays).toEqual(['wss://old.example']);
    // Each half of lastNet is kept only when well-formed.
    expect(loadSettings({ lastNet: { trystero: { kind: 'x', urls: [] }, nostr: { relays: 'no' } } })).toEqual({ ...DEFAULT_SETTINGS, lastNet: {} });
    expect(loadSettings({ lastNet: { trystero: { kind: 'torrent', urls: ['wss://t'] } } }).lastNet).toEqual({ trystero: { kind: 'torrent', urls: ['wss://t'] } });
  });

  it('never throw and always hold valid choices', () => {
    fc.assert(
      fc.property(fc.oneof(anything, fc.dictionary(fc.constantFrom('theme', 'turn', 'lastNet', 'relays', 'signalKind', 'webrtc'), anything)), (raw) => {
        const s = loadSettings(raw);
        expect(['dark', 'light']).toContain(s.theme);
        expect(['default', 'custom', 'off']).toContain(s.turn);
        expect(typeof s.webrtc).toBe('boolean');
      }),
    );
  });
});

describe('other stored values', () => {
  it('read a token, or null', () => {
    expect(loadToken('abc')).toBe('abc');
    for (const x of ['', undefined, 5, {}]) expect(loadToken(x)).toBeNull();
  });

  it('read a sync mark, never negative or non-finite', () => {
    expect(loadMark(1234)).toBe(1234);
    for (const x of [undefined, -5, 0, Number.NaN, Number.POSITIVE_INFINITY, '9']) expect(loadMark(x)).toBe(0);
    fc.assert(
      fc.property(anything, (raw) => {
        expect(loadMark(raw)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('keep well-formed stored events and skip corrupt rows', () => {
    const kp = keyFromPhrase(newRecoveryPhrase());
    const ev = makeEvent(kp, { ws: code, t: 'msg', ch: 'general', b: { text: 'hi' } });
    expect(loadEvents([ev, null, { id: 1 }, 'x'])).toEqual([ev]);
    expect(loadEvents('not a list')).toEqual([]);
    fc.assert(fc.property(anything, (raw) => void loadEvents(raw)));
  });

  it('read file bytes only when they are bytes', () => {
    const buf = new ArrayBuffer(4);
    expect(loadBlob(buf)).toBe(buf);
    for (const x of [undefined, new Uint8Array(4), 'bytes']) expect(loadBlob(x)).toBeNull();
  });
});

describe('upload servers', () => {
  it('are a relay workspace’s own, else the defaults; peer-to-peer workspaces upload nowhere', () => {
    const relayWs = { ...base, transport: { kind: 'nostr' as const, key, relays: ['wss://r'] } };
    expect(uploadServers({ ...relayWs, blossom: ['https://b.example'] })).toEqual(['https://b.example']);
    expect(uploadServers(relayWs)).toBe(DEFAULT_BLOSSOM);
    expect(uploadServers({ ...relayWs, blossom: [] })).toBe(DEFAULT_BLOSSOM);
    expect(uploadServers({ ...base, transport: LEGACY_TRYSTERO })).toBeNull();
  });
});

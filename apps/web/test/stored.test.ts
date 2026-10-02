import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOSSOM, DEFAULT_RELAYS, formatCode, keyFromPhrase, makeEvent, newInviteCode, newRecoveryPhrase, newWorkspaceKey, normalizeCode } from '@yurt/protocol';
import { DEFAULT_SETTINGS, legacyMutes, loadBlob, loadEvents, loadIdentity, loadMark, loadSettings, loadToken, loadWorkspaces, uploadServers } from '../src/lib/stored';
import { anything, fc } from './fuzz';

const code = newInviteCode();
const key = newWorkspaceKey();
const creator = 'ab'.repeat(32);
const base = { code, name: 'Team', creator, lastRead: { general: 5 }, transport: { key, relays: ['wss://r.example'] } };

describe('stored workspaces', () => {
  it('load what the app writes, and skip records without a usable transport', () => {
    const good = { ...base, blossom: ['https://b.example'] };
    const keyless = { ...base, code: newInviteCode(), transport: { relays: ['wss://r.example'] } };
    const { transport: _, ...old } = { ...base, code: newInviteCode() };
    expect(loadWorkspaces([good, keyless, old])).toEqual([good]);
  });

  it('fall back to safe values for bad fields', () => {
    const [w] = loadWorkspaces([
      {
        code,
        name: 42,
        transport: { key, relays: 'wss://r.example' },
        creator: 'not-hex',
        lastRead: { general: 'yesterday', ok: 3, ['__proto__']: 9, inf: Number.POSITIVE_INFINITY },
        muted: ['a', 1, null],
        blossom: 'https://b.example',
      },
    ]);
    expect(w).toEqual({ code, name: formatCode(code), transport: { key, relays: [...DEFAULT_RELAYS] }, creator: null, lastRead: { ok: 3, ['__proto__']: 9 } });
    expect(Object.getPrototypeOf(w?.lastRead)).toBeNull();
    expect(loadWorkspaces([{ ...base, lastRead: 'x' }])[0]).toMatchObject({ lastRead: {} });
    // A minimal record (only what can't be defaulted) still loads.
    expect(loadWorkspaces([{ code, transport: { key } }])).toEqual([
      { code, name: formatCode(code), transport: { key, relays: [...DEFAULT_RELAYS] }, creator: null, lastRead: {} },
    ]);
    // A relay workspace that lost its relays gets the built-ins back, so it can sync again.
    expect(loadWorkspaces([{ ...base, transport: { key, relays: [] } }])[0]?.transport).toEqual({ key, relays: [...DEFAULT_RELAYS] });
  });

  it('give the conversations an older app muted on this device, to move to the synced alert level once', () => {
    const other = newInviteCode();
    const raw = [{ ...base, muted: ['random', 7, 'dm:x'] }, { ...base, code: other, muted: [] }, { code: 5, muted: ['a'] }, { muted: ['b'] }, null, 'x'];
    expect([...legacyMutes(raw)]).toEqual([[code, ['random', 'dm:x']]]);
    expect(loadWorkspaces(raw)[0]).not.toHaveProperty('muted');
    expect(legacyMutes(undefined).size).toBe(0);
    fc.assert(fc.property(anything, (x) => void legacyMutes(x)));
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
        { ...base, transport: { relays: ['wss://r.example'] } }, // no key
        { ...base, transport: { key: 'short', relays: [] } },
        { ...base, transport: { kind: 'wormhole' } },
        base,
        second,
      ]),
    ).toEqual([base]);
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
      sound: false,
      installHint: true,
      turn: 'custom',
      turnUrls: 'turn:x',
      turnUser: 'u',
      turnPass: 'p',
      webrtc: false,
    } as const;
    expect(loadSettings(good)).toEqual(good);
    const bad = { theme: 'neon', notifications: 'yes', haptics: 0, sound: 'loud', installHint: 'no', turn: 1, turnUrls: null, webrtc: 'on', extra: 1 };
    expect(loadSettings(bad)).toEqual(DEFAULT_SETTINGS);
  });

  it('turn sound on for settings saved before it existed', () => {
    expect(loadSettings({ theme: 'light', notifications: true, haptics: false }).sound).toBe(true);
  });

  it('carry lastNet when well-formed', () => {
    const lastNet = { relays: ['wss://r.example'], blossom: [] };
    expect(loadSettings({ lastNet })).toEqual({ ...DEFAULT_SETTINGS, lastNet });
    expect(loadSettings({ lastNet: { relays: 'no' } })).toEqual(DEFAULT_SETTINGS);
  });

  it('never throw and always hold valid choices', () => {
    fc.assert(
      fc.property(fc.oneof(anything, fc.dictionary(fc.constantFrom('theme', 'turn', 'lastNet', 'webrtc'), anything)), (raw) => {
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
  it('are the workspace’s own, else the defaults', () => {
    const relayWs = { ...base, transport: { key, relays: ['wss://r'] } };
    expect(uploadServers({ ...relayWs, blossom: ['https://b.example'] })).toEqual(['https://b.example']);
    expect(uploadServers(relayWs)).toBe(DEFAULT_BLOSSOM);
    expect(uploadServers({ ...relayWs, blossom: [] })).toBe(DEFAULT_BLOSSOM);
  });
});

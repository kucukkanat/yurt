import { describe, it, expect } from 'vitest';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from '@noble/ciphers/webcrypto';
import { joinRoom as trysteroJoin } from 'trystero';
import {
  WorkspacePeer,
  LEGACY_TRYSTERO,
  APP_ID,
  newRecoveryPhrase,
  keyFromPhrase,
  makeEvent,
  reduce,
  mentions,
  canonical,
  sortEvents,
  verifyEvent,
  normalizeCode,
  slug,
  sha256hex,
  verify,
  parseInvite,
  roomIdFor,
  newNostrTransport,
  newTrysteroTransport,
  newWorkspaceKey,
  workspaceKeys,
  seal,
  openBytes,
  buildKeyring,
  makeRekey,
  agentDmChannel,
  dmChannel,
  type JoinRoom,
  type RawRekey,
  type Ev,
} from '../src';
import { roomConfig } from '../src/room';
import { eventClock, memStore, northwind } from './util';

const WS = 'K7QX2MPD';
const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());
const { ev } = eventClock(WS);
const joinRoom = trysteroJoin as unknown as JoinRoom; // never called: these peers aren't started
const noErrors = (m: string) => {
  throw new Error(m);
};

describe('codes, crypto and events', () => {
  it('rejects codes with letters outside the alphabet, and slugs free text', () => {
    expect(normalizeCode('IIII-OOOO')).toBeNull(); // the right length, but I and O are never used
    expect(normalizeCode('k7qx-2mpd')).toBe(WS);
    expect(slug('  Hello, World!! ')).toBe('hello-world');
  });

  it('hashes bytes like their text, and treats malformed keys and signatures as not verifying', () => {
    expect(sha256hex(new TextEncoder().encode('abc'))).toBe(sha256hex('abc'));
    expect(verify('zz', 'message', 'zz')).toBe(false);
  });

  it('writes stable JSON: sorted keys, undefined dropped, array holes as null', () => {
    expect(canonical([1, undefined, { b: 1, a: undefined }])).toBe('[1,null,{"b":1}]');
    expect(canonical({ b: [true], a: 'x' })).toBe('{"a":"x","b":[true]}');
  });

  it('orders events by time, then id, whatever order they came in', () => {
    const x = makeEvent(A, { ws: WS, t: 'msg', b: { text: 'x' }, ts: 5 });
    const y = makeEvent(A, { ws: WS, t: 'msg', b: { text: 'y' }, ts: 5 });
    const [lo, hi] = x.id < y.id ? [x, y] : [y, x];
    expect(sortEvents([hi, lo, hi]).map((e) => e.id)).toEqual([lo.id, hi.id, hi.id]);
  });

  it('does not verify an event nested deeper than the stack, instead of throwing', () => {
    const e = makeEvent(A, { ws: WS, t: 'msg', ch: 'general', b: { text: 'x' } });
    const deep = JSON.parse(JSON.stringify({ ...e, b: { text: 'x', d: 0 } }).replace('"d":0', `"d":${'['.repeat(50_000)}${']'.repeat(50_000)}`));
    expect(verifyEvent(deep)).toBe(false);
  });

  it('finds mentions only where there are some', () => {
    expect(mentions('no handles here, mail@example.com')).toEqual([]);
    expect(mentions('@Ada and (@bo-2)')).toEqual(['ada', 'bo-2']);
  });

  it('refuses an invite whose key segment is cut off', () => {
    expect(parseInvite('https://yurt.example/#/w/K7QX2MPD/k')).toBeNull();
  });
});

describe('room config', () => {
  it('derives every credential from the key, or from the code for legacy workspaces', () => {
    const t = newTrysteroTransport({ kind: 'nostr', urls: ['wss://relay.example'] });
    const keyed = roomConfig(WS, t, t.key, { iceServers: [] });
    const k = workspaceKeys(t.key);
    expect(keyed).toEqual({ config: { appId: k.app, password: k.password, iceServers: [], relayConfig: { urls: ['wss://relay.example'] } }, roomId: k.room });
    const legacy = roomConfig(WS, LEGACY_TRYSTERO, undefined, undefined);
    expect(legacy.config.appId).toBe(APP_ID);
    expect(legacy.config.password).toBe(WS);
    expect(legacy.roomId).toBe(roomIdFor(WS));
  });

  it("leaves signaling servers to the strategy's defaults when the workspace names none", () => {
    const t = newTrysteroTransport({ kind: 'torrent', urls: [] });
    expect(roomConfig(WS, t, t.key, undefined).config).not.toHaveProperty('relayConfig');
  });
});

describe('sealing', () => {
  it('rejects an authenticated plaintext whose length prefix overruns it', () => {
    const key = workspaceKeys(newWorkspaceKey()).enc;
    const plain = new Uint8Array(256);
    new DataView(plain.buffer).setUint32(0, 10_000); // claims more bytes than there are
    const nonce = randomBytes(24);
    const sealed = new Uint8Array([...nonce, ...xchacha20poly1305(key, nonce, new TextEncoder().encode('tag')).encrypt(plain)]);
    expect(openBytes(key, 'tag', sealed)).toBeNull();
  });
});

describe('key rotation edge cases', () => {
  const HISTORY = 'yurt-rekey-history-v1';
  const WRAP = 'yurt-rekey-v1';
  const rekey = (p: Partial<RawRekey>): RawRekey => ({ id: 'r1', a: A.pub, epoch: 1, keys: {}, history: '', ...p });

  it('keeps a rekey whose history is authenticated but not JSON, just without history', () => {
    const k = newWorkspaceKey();
    const r = rekey({ history: seal(workspaceKeys(k).enc, HISTORY, 'not json') });
    const ring = buildKeyring(k, [r], [{ ...r, ts: 1 }], B);
    expect(ring.write.key).toBe(k);
    expect(ring.keys.get(k)?.epoch).toBe(1);
    expect(ring.lockedOut).toBe(false);
  });

  it('skips sealed keys from authors that are not curve points, and sealed values that are not keys', () => {
    const invite = newWorkspaceKey();
    const pair = workspaceKeys(invite).pair(A.sec, B.pub);
    const notAPoint = 'ff'.repeat(32);
    const junkAuthor = rekey({ id: 'r1', a: notAPoint, keys: { [B.pub]: seal(pair, WRAP, newWorkspaceKey()) }, history: 'x' });
    const notAKey = rekey({ id: 'r2', keys: { [B.pub]: seal(pair, WRAP, 'definitely not a key') }, history: 'x' });
    const ring = buildKeyring(invite, [junkAuthor, notAKey], [], B);
    expect([...ring.keys.keys()]).toEqual([invite]);
  });

  it('marks a member locked out when a valid rotation left them out, and refuses to rotate', () => {
    const t = newNostrTransport(['ws://127.0.0.1:9']);
    const create = ev(A, 'ws.create', { name: 'W' });
    const promote = ev(A, 'role', { target: B.pub, admin: true });
    // B rotates for itself only (A has no profile, so A isn't a member B seals the key for).
    const { body } = makeRekey(buildKeyring(t.key, [], [], B), B, [B.pub]);
    const rk = makeEvent(B, { ws: WS, t: 'rekey', b: body });
    const a = new WorkspacePeer({ code: WS, kp: A, selfId: 'a', transport: t, store: memStore().store, onError: noErrors });
    a.receive([create, promote, rk]);
    expect(() => a.rotate()).toThrow('This device no longer holds the current workspace key.');
    expect(a.lockedOut).toBe(true);
  });
});

describe('reduce edge cases', () => {
  const base = () => northwind(ev, A, B);
  const state = (evs: Ev[]) => reduce(WS, evs, { creator: A.pub });

  it('names an unnamed workspace, and keeps profiles from people, not agents', () => {
    const s = state([ev(A, 'ws.create', { name: '' }), ev(A, 'profile', { name: 'Ada' }), ev(B, 'profile', { name: 'Bot', handle: 'bot' }, { ag: 'x' })]);
    expect(s.name).toBe('Workspace');
    expect(s.profiles.get(A.pub)?.handle).toBe('');
    expect(s.profiles.has(B.pub)).toBe(false);
  });

  it('refuses private or duplicate channel ids, and updates only channels that exist', () => {
    const s = state([
      ...base(),
      ev(B, 'ch.create', { id: dmChannel(A.pub, B.pub), name: 'sneaky' }),
      ev(B, 'ch.create', { id: 'general', name: 'taken' }),
      ev(B, 'ch.update', { id: 'nowhere', name: 'x' }),
      ev(B, 'ch.update', { id: 'general', topic: 'Weekly' }),
    ]);
    expect([...s.channels.keys()]).toEqual(['general']);
    expect(s.channels.get('general')).toMatchObject({ name: 'general', topic: 'Weekly' });
  });

  it('applies reactions and pins only to live messages, and keys agent reactions by agent', () => {
    const b0 = base(); // events apply in time order, so the channel must come first
    const m = ev(B, 'msg', { text: 'hi' }, { ch: 'general' });
    const gone = ev(B, 'msg', { text: 'bye' }, { ch: 'general' });
    const s = state([
      ...b0,
      m,
      gone,
      ev(B, 'del', { target: gone.id }),
      ev(A, 'react', { target: gone.id, icon: 'heart', on: true }),
      ev(A, 'react', { target: 'missing', icon: 'heart', on: true }),
      ev(A, 'react', { target: m.id, icon: 'eyes', on: true }, { ag: 'harvey' }),
      ev(A, 'pin', { target: 'missing', on: true }),
      ev(A, 'pin', { target: m.id, on: true }),
      ev(A, 'pin', { target: m.id, on: false }),
    ]);
    expect(s.msgs.get(gone.id)?.reactions).toEqual({});
    expect({ ...s.msgs.get(m.id)?.reactions }).toEqual({ eyes: [A.pub + '/harvey'] });
    expect(s.pins.get('general')?.size).toBe(0);
  });

  it('accepts a message once, needs a channel, and keeps replies in their parent channel', () => {
    const b0 = base();
    const top = ev(B, 'msg', {}, { ch: 'general' });
    const side = ev(A, 'ch.create', { id: 'side', name: 'side' });
    const s = state([
      ...b0,
      top,
      top, // the same event twice in one log
      side,
      ev(B, 'msg', { text: 'nowhere' }),
      ev(B, 'msg', { text: 'wrong channel', parent: top.id }, { ch: 'side' }),
      ev(A, 'msg', { text: 'ok?' }, { ch: agentDmChannel(A.pub, 'harvey'), to: A.pub }),
    ]);
    expect(s.channelMsgs.get('general')).toEqual([top.id]);
    expect(s.msgs.get(top.id)?.text).toBe('');
    expect(s.channelMsgs.get('side')).toBeUndefined();
    expect([...s.msgs.values()].map((m) => m.text)).toEqual(['', 'ok?']);
  });
});

describe('a peer before it starts', () => {
  const store = () => memStore().store;

  it('is a legacy peer-to-peer workspace when no transport is given, with nobody around yet', () => {
    const p = new WorkspacePeer({ code: WS, kp: A, selfId: 'a', joinRoom, store: store(), onError: noErrors });
    expect(p.transport).toEqual(LEGACY_TRYSTERO);
    expect(p.presence.size).toBe(0);
    expect(p.relayStatus().size).toBe(0);
    expect(p.inviteKey).toBeUndefined();
    expect(p.connected).toBe(false);
  });

  it('uses the transport key for invites, and needs the user opt-in for WebRTC in relay workspaces', () => {
    const t = newTrysteroTransport();
    expect(new WorkspacePeer({ code: WS, kp: A, selfId: 'a', transport: t, joinRoom, store: store(), onError: noErrors }).inviteKey).toBe(t.key);
    const relayOnly = new WorkspacePeer({ code: WS, kp: A, selfId: 'a', transport: newNostrTransport(['ws://127.0.0.1:9']), store: store(), onError: noErrors });
    expect(relayOnly.calls).toBe(false);
    expect(relayOnly.ensureRoom()).toBeNull();
    expect(relayOnly['roomIdleMs']).toBe(60_000);
  });

  it('drops events that are not for it, from the future, or unverifiable, and keeps the rest of the batch', () => {
    const t = newNostrTransport(['ws://127.0.0.1:9']);
    const p = new WorkspacePeer({ code: WS, kp: A, selfId: 'a', transport: t, store: store(), onError: noErrors, roomIdleMs: 1_000 });
    const good = makeEvent(B, { ws: WS, t: 'profile', b: { name: 'Bo' } });
    const notMine = makeEvent(B, { ws: WS, t: 'msg', ch: dmChannel(B.pub, C.pub), to: C.pub, b: { text: 'psst' } });
    const future = makeEvent(B, { ws: WS, t: 'profile', b: { name: 'Later' }, ts: Date.now() + 3_600_000 });
    const deep = JSON.parse(JSON.stringify({ ...good, id: 'x', b: { d: 0 } }).replace('"d":0', `"d":${'['.repeat(50_000)}${']'.repeat(50_000)}`));
    p.receive([notMine, future, deep, 'junk', good]);
    expect([...p.events.keys()]).toEqual([good.id]);
    expect(p['roomIdleMs']).toBe(1_000);
  });
});

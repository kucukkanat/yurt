import { afterAll, describe, expect, inject, it } from 'vitest';
import { keyFromPhrase, newInviteCode, newNostrTransport, newRecoveryPhrase, type WsState } from '@yurt/protocol';
import { allPeers, connect, disconnect, getPeer, isLocalHost } from '../../../src/lib/net';
import { DEFAULT_SETTINGS, type NetSettings } from '../../../src/lib/stored';
import { openRemote, resetDb, until } from './harness';

const kp = keyFromPhrase(newRecoveryPhrase());
const relay = inject('relayUrl');
const seen = {
  states: 0,
  peers: 0,
  creators: [] as string[],
  keys: [] as string[],
  blobs: [] as string[],
  joinErrors: [] as unknown[],
  errors: [] as string[],
};
const handlers = {
  onState: (_c: string, _s: WsState) => void seen.states++,
  onPeers: () => void seen.peers++,
  onCreator: (_c: string, pub: string) => void seen.creators.push(pub),
  onKey: (_c: string, key: string) => void seen.keys.push(key),
  onBlob: (id: string) => void seen.blobs.push(id),
  onJoinError: (_c: string, d: unknown) => void seen.joinErrors.push(d),
  onError: (_c: string, msg: string) => void seen.errors.push(msg),
};
const net = (p: Partial<NetSettings> = {}): NetSettings => ({ ...DEFAULT_SETTINGS, ...p });

afterAll(async () => {
  for (const p of allPeers()) disconnect(p.code);
  await resetDb();
});

describe('workspace connections', () => {
  it('connect once per workspace and hand back the live peer', async () => {
    await resetDb();
    const code = newInviteCode();
    // No pinned creator: the peer learns it from the workspace's ws.create and reports it.
    const p = connect(code, kp, null, newNostrTransport([relay]), net(), handlers);
    expect(connect(code, kp, null, newNostrTransport([relay]), net(), handlers)).toBe(p);
    expect(getPeer(code)).toBe(p);
    expect(getPeer(null)).toBeUndefined();
    expect(allPeers()).toContain(p);
    await until(() => p.connected, 'the relay');
    p.publish({ t: 'ws.create', b: { name: 'Net' } });
    await until(() => seen.states > 0 && seen.creators.includes(kp.pub), 'state and creator callbacks');
    disconnect(code);
    expect(getPeer(code)).toBeUndefined();
    disconnect(code); // already gone: nothing to do
  });

  it('give workspaces WebRTC for calls only when calls are on, with any TURN choice', () => {
    const off = connect(newInviteCode(), kp, null, newNostrTransport([relay]), net({ webrtc: false }), handlers);
    expect(off.ensureRoom()).toBeNull();
    const ons = [
      net({ turn: 'default' }),
      net({ turn: 'custom', turnUrls: 'turn:a.example, turn:b.example', turnUser: 'u', turnPass: 'p' }),
      net({ turn: 'custom', turnUrls: '  ' }),
    ].map((n) => connect(newInviteCode(), kp, null, newNostrTransport([relay]), n, handlers));
    for (const p of ons) expect(p.ensureRoom()).not.toBeNull();
    for (const p of [off, ...ons]) disconnect(p.code);
  });
});

describe('connection problems', () => {
  it('report a refused handshake, e.g. a banned member trying to connect', async () => {
    const code = newInviteCode();
    const transport = newNostrTransport([relay]);
    const p = connect(code, kp, kp.pub, transport, net(), handlers);
    p.publish({ t: 'ws.create', b: { name: 'Banning' } });
    const mallory = keyFromPhrase(newRecoveryPhrase());
    p.publish({ t: 'ban', b: { target: mallory.pub, on: true } });
    await until(() => p.state.bans.has(mallory.pub), 'the ban');
    const remote = await openRemote();
    const m = remote.makePeer({ code, transport, creator: kp.pub, kp: mallory, webrtc: true });
    await m.peer.start();
    // A banned member's call presence doesn't open my room, so open both directly.
    p.ensureRoom();
    m.peer.ensureRoom();
    await until(() => seen.joinErrors.length > 0, 'the refused handshake', 30_000);
    expect(p.peers.size).toBe(0);
    m.peer.leave();
    disconnect(code);
  }, 40_000);

  it('report that this device couldn’t save, e.g. after a newer app upgraded the database in another tab', async () => {
    const code = newInviteCode();
    const p = connect(code, kp, null, newNostrTransport([relay]), net(), handlers);
    await until(() => p.connected, 'the relay');
    await new Promise<void>((res, rej) => {
      const r = indexedDB.open('yurt', 2); // closes this tab's connection (onversionchange), then upgrades
      r.onsuccess = () => {
        r.result.close();
        res();
      };
      r.onerror = () => rej(r.error);
    });
    p.publish({ t: 'msg', ch: 'general', b: { text: 'not saved here' } });
    await until(() => seen.errors.some((m) => m.includes('Couldn’t save') || m.includes("Couldn't save")), 'the save error');
    disconnect(code);
    await resetDb();
  });
});

describe('local hosts', () => {
  it('are the ones a dev or test file server runs on', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('kucukkanat.github.io')).toBe(false);
  });
});

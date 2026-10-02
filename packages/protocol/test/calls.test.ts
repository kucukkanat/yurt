import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { RTCPeerConnection } from 'werift';
import {
  WorkspacePeer,
  keyFromPhrase,
  newRecoveryPhrase,
  newNostrTransport,
  type Ev,
  type JoinRoom,
  type KeyPair,
  type WsTransport,
  type HuddleState,
  type TRoom,
  sign,
} from '../src';
import { roomConfig } from '../src/room';
import { startRelay, type TestRelay } from './relay';
import { memStore, until as waitFor } from './util';

// WebRTC needs longer than relays to find peers.
const until = (cond: () => boolean, ms = 20_000, what?: string) => waitFor(cond, ms, what);

// Real WebRTC (werift, as the bridge would use) with Trystero signaling over the local test relay,
// which also carries the workspace's events.
const CODE = 'K7QX2MPD';
const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());

let relay: TestRelay;
let transport: WsTransport; // one fresh workspace per test
const open: WorkspacePeer[] = [];
let errors: string[] = []; // every onError of the test; afterEach requires none

interface DeviceOpts {
  events?: Ev[];
  /** false: without the user's opt-in, so no WebRTC at all. */
  webrtc?: boolean;
  /** Start in a huddle, which keeps the room open. */
  call?: boolean;
}

/** One simulated device: its own Trystero instance (own selfId), store and peer. */
async function device(kp: KeyPair, opts: DeviceOpts = {}) {
  vi.resetModules();
  const { joinRoom, selfId } = await import('trystero');
  const store = memStore().store;
  if (opts.events) await store.save(opts.events);
  const p = new WorkspacePeer({
    code: CODE,
    kp,
    transport,
    roomIdleMs: 1_500,
    store,
    calls: opts.webrtc === false ? undefined : { joinRoom: joinRoom as unknown as JoinRoom, selfId, rtc: { rtcPolyfill: RTCPeerConnection } },
    onError: (m) => errors.push(m),
  });
  open.push(p);
  await p.start();
  if (opts.call) {
    await until(() => p.connected); // the call is announced through presence on the relay
    p.setHuddle({ ch: 'general', mic: true });
  }
  return p;
}

const pubs = (m: ReadonlyMap<string, { pub: string }>) => [...m.values()].map((x) => x.pub);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  relay = await startRelay();
});
afterAll(() => relay.close());
beforeEach(() => {
  transport = newNostrTransport([relay.url]);
  errors = [];
});
afterEach(() => {
  for (const p of open.splice(0)) p.leave();
  expect(errors).toEqual([]);
});

describe('calls open WebRTC only on demand', () => {
  it('joins the key-derived room for a huddle and leaves when it ends', async () => {
    const a = await device(A);
    const b = await device(B);
    await until(() => a.connected && b.connected);
    expect(a.room).toBeNull();
    expect(b.room).toBeNull();
    const seen: (HuddleState | null)[] = [];
    b.onHuddle = (_pid, h) => seen.push(h);
    a.setHuddle({ ch: 'general', mic: true }); // B joins because A's presence asks for the room
    await until(() => a.peers.size === 1 && b.peers.size === 1, 20_000, 'on-demand room');
    await until(() => seen.some((h) => h?.ch === 'general'), 20_000, 'huddle state');
    expect(b.peerIdsFor([A.pub])).toHaveLength(1);
    a.setHuddle({ ch: null });
    await until(() => a.room === null && b.room === null, 20_000, 'idle leave');
  }, 60_000);

  it('drops a member who leaves, and their huddle state', async () => {
    const b = await device(B);
    const seen: (HuddleState | null)[] = [];
    b.onHuddle = (_pid, h) => seen.push(h);
    const a = await device(A, { call: true });
    await until(() => seen.some((h) => h?.ch === 'general'), 20_000, 'huddle state');
    a.leave();
    await until(() => b.peers.size === 0 && seen.at(-1) === null, 20_000, 'peer leave');
  }, 60_000);

  it('ignores a banned member asking for the room', async () => {
    const a = await device(A);
    a.publish({ t: 'ws.create', b: { name: 'Strict' } });
    a.publish({ t: 'ban', b: { target: C.pub, on: true } });
    const c = await device(C, { webrtc: false });
    const b = await device(B, { webrtc: false });
    await until(() => a.connected && b.connected && c.connected && a.state.bans.has(C.pub));
    c.setPresence({ rtc: true });
    b.setPresence({ typing: 'general' }); // sent after C's, so once A sees it, C's has arrived too
    await until(() => [...a.presence.values()].some((p) => p.pub === B.pub && p.typing === 'general'), 20_000, 'marker presence');
    await pause(2000); // past a room check (every 1.5 s here)
    expect(a.room).toBeNull();
    expect(pubs(a.presence)).not.toContain(C.pub);
  }, 60_000);

  it('never opens WebRTC without the opt-in, even when a member asks for a call', async () => {
    const caller = await device(A);
    const quiet = await device(B, { webrtc: false });
    await until(() => caller.connected && quiet.connected);
    expect(quiet.calls).toBe(false);
    expect(quiet.ensureRoom()).toBeNull();
    caller.setHuddle({ ch: 'general', mic: true });
    await until(() => [...quiet.presence.values()].some((p) => p.pub === A.pub && p.rtc), 20_000, 'rtc presence');
    await pause(2000);
    expect(quiet.room).toBeNull();
    expect(caller.peers.size).toBe(0);
  }, 60_000);
});

describe('bans in calls', () => {
  it('refuses a banned member at the handshake', async () => {
    const first = await device(A);
    const events = [first.publish({ t: 'ws.create', b: { name: 'Strict' } }), first.publish({ t: 'ban', b: { target: C.pub, on: true } })];
    for (const p of open.splice(0)) p.leave();
    const a = await device(A, { events, call: true });
    const c = await device(C, { call: true });
    await device(B, { call: true });
    // B proves the room works; C, banned in A's log, never becomes A's peer.
    await until(() => pubs(a.peers).includes(B.pub));
    await pause(2000);
    expect(pubs(a.peers)).not.toContain(C.pub);
    expect(pubs(c.peers)).not.toContain(A.pub);
  }, 60_000);

  it('cuts off a member banned while connected', async () => {
    const a = await device(A, { call: true });
    a.publish({ t: 'ws.create', b: { name: 'Strict' } });
    const b = await device(B, { call: true });
    const c = await device(C, { call: true });
    await until(() => a.peers.size === 2 && b.peers.size === 2 && c.peers.size === 2 && b.state.creator === A.pub);
    a.publish({ t: 'ban', b: { target: C.pub, on: true } });
    await until(() => !pubs(a.peers).includes(C.pub) && !pubs(b.peers).includes(C.pub), 20_000, 'ban disconnect');
    await pause(1500);
    expect(pubs(a.peers)).not.toContain(C.pub); // and it can't come back through the handshake
  }, 60_000);
});

/** Joins the workspace's call room as a raw Trystero peer, answering the handshake with whatever `reply` returns. */
const raws: TRoom[] = [];
async function rawPeer(reply: (peerId: string, selfId: string) => unknown, hold?: Promise<void>) {
  vi.resetModules();
  const { joinRoom, selfId } = await import('trystero');
  const { config, roomId } = roomConfig(transport.relays, transport.key, { rtcPolyfill: RTCPeerConnection });
  const room = (joinRoom as unknown as JoinRoom)(config, roomId, {
    onPeerHandshake: async (peerId, send, receive) => {
      await receive();
      await send(reply(peerId, selfId));
      await hold; // keeps this side from finishing the handshake until the test says so
    },
  });
  raws.push(room);
  return room;
}
afterEach(() => {
  for (const r of raws.splice(0)) r.leave();
});
const signedHandshake = (kp: KeyPair) => (peerId: string, selfId: string) => ({ pub: kp.pub, sig: sign(kp.sec, `yurt-hs:${CODE}:${selfId}>${peerId}`) });

describe('hostile peers', () => {
  it('cannot join without proving a key, or with a signature for another key', async () => {
    const a = await device(A, { call: true });
    await rawPeer(() => 'not a handshake');
    await rawPeer((peerId, selfId) => ({ ...signedHandshake(C)(peerId, selfId), pub: B.pub })); // claims B, signed by C
    const b = await device(B, { call: true });
    await until(() => a.peers.size === 1 && b.peers.size === 1); // the real member gets in
    await pause(1500);
    expect(pubs(a.peers)).toEqual([B.pub]);
  }, 60_000);

  it('are refused when banned between their handshake and joining', async () => {
    const a = await device(A, { call: true });
    a.publish({ t: 'ws.create', b: { name: 'Strict' } });
    const gate: { open?: () => void } = {};
    const room = await rawPeer(signedHandshake(C), new Promise<void>((r) => (gate.open = r)));
    // A's view is what counts: C's own side only notices the closed connection later.
    await until(() => a['pendingPub'].size === 1); // A checked C's key; C hasn't finished its side
    a.publish({ t: 'ban', b: { target: C.pub, on: true } });
    await until(() => a.isBanned(C.pub));
    gate.open?.();
    await pause(2000);
    expect(pubs(a.peers)).toEqual([]);
    expect(room).toBeDefined();
  }, 60_000);

  it('cannot hurt a member with malformed huddle state', async () => {
    const a = await device(A, { call: true });
    const c = await device(C, { call: true });
    await until(() => a.peers.size === 1 && c.peers.size === 1);
    const target = { target: c.peerIdsFor([A.pub]) };
    const hud = c.room?.makeAction<unknown>('hud');
    await hud?.send(null, target);
    await hud?.send('junk', target);
    await pause(1500);
    expect(a.huddles.size).toBe(1); // only C's real state from when it joined
    expect(a.huddles.values().next().value).toMatchObject({ ch: 'general' });
  }, 60_000);
});

describe('key rotation with a call open', () => {
  it('leaves the WebRTC room, whose credentials came from the old key', async () => {
    const keys: string[] = [];
    const a = await device(A);
    a.o.onKey = (k) => keys.push(k);
    a.publish({ t: 'ws.create', b: { name: 'Calls' } });
    await until(() => a.connected);
    expect(a.ensureRoom()).toBe(a.room);
    expect(a.ensureRoom()).toBe(a.room); // the same room while it's open
    a.rotate();
    expect(a.room).toBeNull();
    expect(keys).toEqual([a.inviteKey]);
  }, 60_000);
});

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { RTCPeerConnection } from 'werift';
import {
  WorkspacePeer, keyFromPhrase, newRecoveryPhrase, newNostrTransport, newTrysteroTransport, dmChannel, sha256Buf, LEGACY_TRYSTERO,
  type Ev, type JoinRoom, type KeyPair, type PeerStore, type WsTransport, type HuddleState,
} from '../src';
import { startRelay, type TestRelay } from './relay';

// Real WebRTC (werift, as the bridge uses) with Trystero signaling over the local test relay.
const CODE = 'K7QX2MPD';
const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());

function memStore(blobs = new Map<string, ArrayBuffer>()): PeerStore {
  const evs = new Map<string, Ev>();
  return {
    load: async () => [...evs.values()],
    save: async (xs) => { xs.forEach((e) => evs.set(e.id, e)); },
    getBlob: async (id) => blobs.get(id) ?? null,
    putBlob: async (id, buf) => { blobs.set(id, buf); },
  };
}

async function until(cond: () => boolean, ms = 20_000, what = 'condition') {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 50));
  }
}

let relay: TestRelay;
let keyed: WsTransport; // one fresh workspace per test
const open: WorkspacePeer[] = [];

/** One simulated device: its own Trystero instance (own selfId), store and peer. */
async function device(kp: KeyPair, opts: { transport?: WsTransport; code?: string; blobs?: Map<string, ArrayBuffer>; events?: Ev[]; webrtc?: boolean } = {}) {
  vi.resetModules();
  const { joinRoom, selfId } = await import('trystero');
  const store = memStore(opts.blobs);
  if (opts.events) await store.save(opts.events);
  const blobsSeen: string[] = [];
  const p = new WorkspacePeer({
    code: opts.code ?? CODE, kp, selfId, transport: opts.transport ?? keyed, store, roomIdleMs: 1_500,
    // `webrtc: false` is a relay workspace without the user's opt-in: no WebRTC at all.
    joinRoom: opts.webrtc === false ? undefined : (joinRoom as unknown as JoinRoom),
    rtc: { rtcPolyfill: RTCPeerConnection, relayConfig: { urls: [relay.url] } },
    onBlob: (id) => blobsSeen.push(id),
  });
  open.push(p);
  await p.start();
  return { p, blobsSeen };
}

const texts = (p: WorkspacePeer) => [...p.state.msgs.values()].map((m) => m.text);

beforeAll(async () => { relay = await startRelay(); });
afterAll(() => relay.close());
beforeEach(() => { keyed = newTrysteroTransport(); });
afterEach(() => { open.splice(0).forEach((p) => p.leave()); });

describe('trystero transport', () => {
  it('syncs history between members and delivers live messages', async () => {
    const { p: a } = await device(A);
    a.publish({ t: 'ws.create', b: { name: 'P2P' } });
    a.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    const early = a.publish({ t: 'msg', ch: 'general', b: { text: 'before you came' } });
    expect(a.queued.has(early.id)).toBe(true); // nobody to send to yet
    const { p: b } = await device(B);
    await until(() => texts(b).includes('before you came'), 20_000, 'history sync');
    expect(a.queued.size).toBe(0);
    expect(a.connected && b.connected).toBe(true);
    b.publish({ t: 'msg', ch: 'general', b: { text: 'hi back' } });
    await until(() => texts(a).includes('hi back'), 20_000, 'live reply');
  }, 60_000);

  it('routes DMs only to the pair and shares presence', async () => {
    const { p: a } = await device(A);
    const { p: b } = await device(B);
    const { p: c } = await device(C);
    await until(() => a.peers.size === 2 && b.peers.size === 2 && c.peers.size === 2);
    const dm = a.publish({ t: 'msg', ch: dmChannel(A.pub, B.pub), to: B.pub, b: { text: 'psst' } });
    const pub = a.publish({ t: 'msg', ch: 'general', b: { text: 'everyone' } });
    await until(() => b.events.has(dm.id) && c.events.has(pub.id));
    expect(c.events.has(dm.id)).toBe(false);
    b.setPresence({ typing: 'general' });
    await until(() => [...a.presence.values()].some((p) => p.pub === B.pub && p.typing === 'general'));
    expect(a.peerIdsFor([B.pub])).toHaveLength(1);
  }, 60_000);

  it('carries huddle state and verified file transfers', async () => {
    const buf = new TextEncoder().encode('file body').buffer as ArrayBuffer;
    const id = await sha256Buf(buf);
    const { p: a } = await device(A, { blobs: new Map([[id, buf]]) });
    a.publish({ t: 'msg', ch: 'general', b: { text: 'see attached', files: [{ id, name: 'a.txt', size: 9, type: 'text/plain' }] } });
    const { p: b, blobsSeen } = await device(B);
    await until(() => b.events.size === 1);
    await until(() => a.peers.size === 1 && b.peers.size === 1);
    const seen: (HuddleState | null)[] = [];
    b.onHuddle = (_pid, h) => seen.push(h);
    a.setHuddle({ ch: 'general', mic: true });
    await until(() => seen.some((h) => h?.ch === 'general'), 20_000, 'huddle state');
    const got = await b.fetchFile(id); // waits for the WebRTC transfer
    expect(got && new TextDecoder().decode(got)).toBe('file body');
    expect(blobsSeen).toContain(id);
    expect(new TextDecoder().decode((await b.fetchFile(id)) ?? new ArrayBuffer(0))).toBe("file body"); // now served locally
    a.leave();
    await until(() => b.peers.size === 0 && seen.at(-1) === null, 20_000, 'peer leave');
  }, 60_000);

  it('refuses a banned member at the handshake', async () => {
    const create = (await device(A)).p.publish({ t: 'ws.create', b: { name: 'Strict' } });
    const ban = open[0].publish({ t: 'ban', b: { target: C.pub, on: true } });
    open.splice(0).forEach((p) => p.leave());
    const events = [create, ban];
    const { p: a } = await device(A, { events });
    const { p: c } = await device(C);
    await device(B);
    // B proves the room works; C, banned in A's log, never becomes A's peer.
    await until(() => [...a.peers.values()].some((x) => x.pub === B.pub));
    await new Promise((r) => setTimeout(r, 2000));
    expect([...a.peers.values()].map((x) => x.pub)).not.toContain(C.pub);
    expect([...c.peers.values()].map((x) => x.pub)).not.toContain(A.pub);
  }, 60_000);
});

describe('rooms are keyed', () => {
  it('keeps someone holding only the code out of the room', async () => {
    const { p: a } = await device(A);
    const { p: b } = await device(B);
    await until(() => a.peers.size === 1 && b.peers.size === 1);
    const { p: outsider } = await device(C, { transport: LEGACY_TRYSTERO });
    await new Promise((r) => setTimeout(r, 2000));
    expect(outsider.peers.size).toBe(0);
    expect([...a.peers.values()].map((x) => x.pub)).not.toContain(C.pub);
  }, 60_000);

  it('still connects legacy code-only workspaces for existing members', async () => {
    const { p: a } = await device(A, { transport: LEGACY_TRYSTERO });
    const { p: b } = await device(B, { transport: LEGACY_TRYSTERO });
    await until(() => a.peers.size === 1 && b.peers.size === 1);
  }, 60_000);
});

describe('DM files', () => {
  it('travel only within the pair, even when a member asks directly', async () => {
    const buf = new TextEncoder().encode('private file').buffer as ArrayBuffer;
    const id = await sha256Buf(buf);
    const { p: a } = await device(A, { blobs: new Map([[id, buf]]) });
    const dm = a.publish({ t: 'msg', ch: dmChannel(A.pub, B.pub), to: B.pub, b: { text: 'for you', files: [{ id, name: 'p.txt', size: 12, type: 'text/plain' }] } });
    const { p: b, blobsSeen: bSeen } = await device(B);
    const { p: c, blobsSeen: cSeen } = await device(C);
    await until(() => b.events.has(dm.id) && c.peers.size === 2);
    c.requestBlob(id); // C's own client doesn't even ask: C can't see a message attaching it
    // A malicious client asks A directly anyway.
    const [aPeer] = c.peerIdsFor([A.pub]);
    c.room?.makeAction<{ id: string }>('fwant').send({ id }, { target: aPeer });
    b.requestBlob(id);
    await until(() => bSeen.includes(id));
    await new Promise((r) => setTimeout(r, 1500));
    expect(cSeen).not.toContain(id);
  }, 60_000);
});

describe('relay workspaces open WebRTC only on demand', () => {
  it('joins the key-derived room for a huddle and leaves when it ends', async () => {
    const transport = newNostrTransport([relay.url]);
    const { p: a } = await device(A, { transport });
    const { p: b } = await device(B, { transport });
    await until(() => a.connected && b.connected);
    expect(a.room).toBeNull();
    expect(b.room).toBeNull();
    const seen: (HuddleState | null)[] = [];
    b.onHuddle = (_pid, h) => seen.push(h);
    a.setHuddle({ ch: 'general', mic: true }); // B joins because A's presence asks for the room
    await until(() => a.peers.size === 1 && b.peers.size === 1, 20_000, 'on-demand room');
    await until(() => seen.some((h) => h?.ch === 'general'), 20_000, 'huddle state');
    a.setHuddle({ ch: null });
    await until(() => a.room === null && b.room === null, 20_000, 'idle leave');
  }, 60_000);

  it('never opens WebRTC without the opt-in, even when a member asks for a call', async () => {
    const transport = newNostrTransport([relay.url]);
    const { p: caller } = await device(A, { transport });
    const { p: quiet } = await device(B, { transport, webrtc: false });
    await until(() => caller.connected && quiet.connected);
    expect(quiet.calls).toBe(false);
    expect(quiet.ensureRoom()).toBeNull();
    caller.setHuddle({ ch: 'general', mic: true });
    await until(() => [...quiet.presence.values()].some((p) => p.pub === A.pub && p.rtc), 20_000, 'rtc presence');
    await new Promise((r) => setTimeout(r, 2000));
    expect(quiet.room).toBeNull();
    expect(caller.peers.size).toBe(0);
  }, 60_000);
});

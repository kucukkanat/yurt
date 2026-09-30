import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WorkspacePeer, keyFromPhrase, newRecoveryPhrase, newNostrTransport, dmChannel, makeEvent, workspaceKeys, uploadFile, sha256Buf,
  type Ev, type KeyPair, type PeerStore, type WsTransport, type KeyedTransport,
} from '../src';
import { startRelay, type TestRelay } from './relay';
import { startBlossom, type TestBlossom } from './blossom-server';

const CODE = 'K7QX2MPD';
const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());

/** In-memory PeerStore: a real implementation of the interface, one per simulated device. */
function memStore(initial: Ev[] = []) {
  const evs = new Map<string, Ev>(initial.map((e) => [e.id, e]));
  const blobs = new Map<string, ArrayBuffer>();
  let mark = 0;
  const store: PeerStore = {
    getBlob: async (id) => blobs.get(id) ?? null,
    putBlob: async (id, b) => { blobs.set(id, b); },
    load: async () => [...evs.values()],
    save: async (xs) => { xs.forEach((e) => evs.set(e.id, e)); },
    loadMark: async () => mark,
    saveMark: async (_ws, s) => { mark = s; },
  };
  return { store, mark: () => mark };
}

async function until(cond: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

let relay: TestRelay;
let transport: KeyedTransport;
const open: WorkspacePeer[] = [];

async function join(kp: KeyPair, t: WsTransport = transport, store = memStore().store) {
  const p = new WorkspacePeer({ code: CODE, kp, selfId: kp.pub.slice(0, 20), transport: t, store, onError: (m) => { throw new Error(m); } });
  open.push(p);
  await p.start();
  await until(() => p.connected);
  return p;
}

const texts = (p: WorkspacePeer) => [...p.state.msgs.values()].map((m) => m.text);

beforeEach(async () => {
  relay = await startRelay();
  transport = newNostrTransport([relay.url]);
});
afterEach(async () => {
  open.splice(0).forEach((p) => p.leave());
  await relay.close();
});

describe('nostr transport', () => {
  it('keeps history on the relay for members who join after the author left', async () => {
    const a = await join(A);
    a.publish({ t: 'ws.create', b: { name: 'Northwind' } });
    a.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    a.publish({ t: 'msg', ch: 'general', b: { text: 'written while alone' } });
    await until(() => a.queued.size === 0);
    a.leave();

    const b = await join(B);
    await until(() => texts(b).includes('written while alone'));
    expect(b.state.name).toBe('Northwind');
  });

  it('delivers live messages between online members', async () => {
    const a = await join(A);
    const b = await join(B);
    a.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    a.publish({ t: 'msg', ch: 'general', b: { text: 'live hello' } });
    await until(() => texts(b).includes('live hello'));
  });

  it('shows who is online through signed presence', async () => {
    const a = await join(A);
    const b = await join(B);
    b.setPresence({ typing: 'general' });
    await until(() => [...a.presence.values()].some((p) => p.pub === B.pub && p.typing === 'general'));
  });

  it('keeps DMs between the pair even from other members', async () => {
    const a = await join(A);
    const b = await join(B);
    const c = await join(C);
    const ch = dmChannel(A.pub, B.pub);
    const dm = a.publish({ t: 'msg', ch, to: B.pub, b: { text: 'just between us' } });
    await until(() => texts(b).includes('just between us'));
    // Give C every chance to receive it, then make sure it never did.
    const marker = c.publish({ t: 'msg', ch: 'general', b: { text: 'marker' } });
    await until(() => b.events.has(marker.id));
    expect(c.events.has(dm.id)).toBe(false);
  });

  it('syncs DMs to the author\'s other devices', async () => {
    const a1 = await join(A);
    const dm = a1.publish({ t: 'msg', ch: dmChannel(A.pub, B.pub), to: B.pub, b: { text: 'from my laptop' } });
    await until(() => a1.queued.size === 0);
    const a2 = await join(A);
    await until(() => a2.events.has(dm.id));
  });

  it('gives relay operators nothing readable', async () => {
    const a = await join(A);
    const b = await join(B);
    a.publish({ t: 'profile', b: { name: 'Ada Lovelace', handle: 'ada' } });
    a.publish({ t: 'msg', ch: 'general', b: { text: 'quarterly numbers are 42' } });
    a.publish({ t: 'msg', ch: dmChannel(A.pub, B.pub), to: B.pub, b: { text: 'private note' } });
    b.setPresence({ typing: 'general' });
    await until(() => a.queued.size === 0 && relay.stored.length >= 3);
    const dump = JSON.stringify(relay.stored);
    for (const secret of ['Ada Lovelace', 'quarterly', 'private note', CODE, A.pub, B.pub, 'general', 'profile']) expect(dump).not.toContain(secret);
  });

  it('stores DMs as unlinkable per-inbox copies with padded sizes and fuzzed times', async () => {
    const k = workspaceKeys(transport.key);
    const a = await join(A);
    a.publish({ t: 'msg', ch: 'general', b: { text: 'short' } });
    a.publish({ t: 'msg', ch: 'general', b: { text: 'a noticeably longer public message, '.repeat(6) } });
    a.publish({ t: 'msg', ch: dmChannel(A.pub, B.pub), to: B.pub, b: { text: 'short private' } });
    await until(() => a.queued.size === 0 && relay.stored.length === 4);
    const now = Math.floor(Date.now() / 1000);
    for (const e of relay.stored) {
      expect(e.tags).toHaveLength(1);
      expect(e.created_at).toBeLessThanOrEqual(now);
      expect(e.created_at).toBeGreaterThan(now - 7_200 - 10);
    }
    const [pub, longer] = relay.stored.filter((e) => e.tags[0][1] === k.tag);
    const toB = relay.stored.find((e) => e.tags[0][1] === k.inbox(B.pub));
    const toA = relay.stored.find((e) => e.tags[0][1] === k.inbox(A.pub));
    expect(pub && toA && toB).toBeTruthy();
    expect(new Set([pub.pubkey, toA?.pubkey, toB?.pubkey]).size).toBe(3);
    expect(pub.content.length).toBe(longer.content.length); // length hidden within a size bucket
    expect(toA?.content.length).toBe(toB?.content.length);
  });

  it('ignores a workspace with the same code but a different key', async () => {
    const a = await join(A);
    a.publish({ t: 'msg', ch: 'general', b: { text: 'for key holders only' } });
    await until(() => a.queued.size === 0);
    const outsider = await join(C, newNostrTransport([relay.url]));
    await new Promise((r) => setTimeout(r, 500));
    expect(outsider.events.size).toBe(0);
  });

  it('sends events published while the link was still starting', async () => {
    const a = new WorkspacePeer({ code: CODE, kp: A, selfId: 'a', transport, store: memStore().store });
    open.push(a);
    const starting = a.start();
    a.publish({ t: 'ws.create', b: { name: 'Early' } }); // what createWorkspace does right after connecting
    await starting;
    await until(() => a.queued.size === 0);
    const b = await join(B);
    await until(() => b.state.name === 'Early');
  });

  it('re-sends my events that never reached a relay before the app closed', async () => {
    const unsent = makeEvent(A, { ws: CODE, t: 'ws.create', b: { name: 'Survived a restart' } });
    await join(A, transport, memStore([unsent]).store);
    const b = await join(B);
    await until(() => b.state.name === 'Survived a restart');
  });

  it('does not re-send events the relay already has', async () => {
    const s = memStore();
    const a = await join(A, transport, s.store);
    a.publish({ t: 'ws.create', b: { name: 'Once' } });
    await until(() => a.queued.size === 0 && relay.stored.length === 1);
    a.leave();
    await join(A, transport, s.store);
    await new Promise((r) => setTimeout(r, 500));
    expect(relay.stored).toHaveLength(1);
  });

  it('records a sync mark so restarts only fetch what is new', async () => {
    const s = memStore();
    await join(A, transport, s.store);
    await until(() => s.mark() > 0);
  });

  it('queues events while no relay is reachable and sends them when one comes back', async () => {
    const { port } = relay;
    await relay.close();
    const errors: string[] = [];
    const a = new WorkspacePeer({ code: CODE, kp: A, selfId: 'a', transport, store: memStore().store, onError: (m) => errors.push(m) });
    open.push(a);
    await a.start();
    const e = a.publish({ t: 'msg', ch: 'general', b: { text: 'offline draft' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(a.queued.has(e.id)).toBe(true);
    expect(a.connected).toBe(false);
    relay = await startRelay(port);
    await until(() => a.queued.size === 0, 25_000);
    expect(relay.stored).toHaveLength(1);
    expect(errors).toEqual([]);
  }, 30_000);
});

describe('files in relay workspaces', () => {
  let blossom: TestBlossom;
  beforeEach(async () => { blossom = await startBlossom(); });
  afterEach(() => blossom.close());

  async function attach(text: string) {
    const bytes = new TextEncoder().encode(text);
    const id = await sha256Buf(bytes.slice().buffer);
    return { id, name: 'notes.txt', size: bytes.length, type: 'text/plain', blob: await uploadFile([blossom.url], bytes) };
  }
  const read = (b: ArrayBuffer | null) => (b ? new TextDecoder().decode(b) : null);

  it('reach members who join after the sender left, without WebRTC', async () => {
    const a = await join(A);
    const f = await attach('the plan');
    a.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    const m = a.publish({ t: 'msg', ch: 'general', b: { text: 'see file', files: [f] } });
    await until(() => a.queued.size === 0);
    a.leave();
    const b = await join(B);
    await until(() => b.events.has(m.id));
    expect(read(await b.fetchFile(f.id))).toBe('the plan');
    expect(b.room).toBeNull();
    expect(b.calls).toBe(false);
  });

  it('stay within a DM pair: others never learn the file key', async () => {
    const a = await join(A);
    const b = await join(B);
    const c = await join(C);
    const f = await attach('for B only');
    const dm = a.publish({ t: 'msg', ch: dmChannel(A.pub, B.pub), to: B.pub, b: { text: 'here', files: [f] } });
    await until(() => b.events.has(dm.id));
    expect(read(await b.fetchFile(f.id))).toBe('for B only');
    expect(await c.fetchFile(f.id)).toBeNull();
    expect(JSON.stringify(relay.stored)).not.toContain(f.blob.key);
  });

  it('refuse a server copy that does not match the attached file', async () => {
    const a = await join(A);
    const f = await attach('original');
    const forged = { ...f, blob: (await attach('forged')).blob };
    a.publish({ t: 'msg', ch: 'general', b: { text: 'x', files: [forged] } });
    expect(await a.fetchFile(f.id)).toBeNull();
  });
});

describe('workspace peer', () => {
  it('refuses a Trystero workspace without a WebRTC room', () => {
    expect(() => new WorkspacePeer({ code: CODE, kp: A, selfId: 'a', store: memStore().store })).toThrow('Trystero workspaces need joinRoom');
  });

  it('drops forged, foreign and malformed events', async () => {
    const a = await join(A);
    const good = a.publish({ t: 'msg', ch: 'general', b: { text: 'ok' } });
    const b = await join(B);
    await until(() => b.events.has(good.id));
    const n = b.events.size;
    b.receive([{ ...good, id: 'x'.repeat(32) }, { ...good, ws: 'OTHERWSX' }, null, 'junk', { ...good, b: { text: 'tampered' } }]);
    b.receive('not an array');
    expect(b.events.size).toBe(n);
  });

  it('reports relay errors loudly when no handler is given', () => {
    const p = new WorkspacePeer({ code: CODE, kp: A, selfId: 'a', transport, store: memStore().store });
    expect(() => p.error('boom')).toThrow('boom');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import {
  WorkspacePeer,
  keyFromPhrase,
  newRecoveryPhrase,
  newNostrTransport,
  dmChannel,
  guestDmChannel,
  makeEvent,
  workspaceKeys,
  uploadFile,
  sha256Buf,
  seal,
  type KeyPair,
  type WsTransport,
  type KeyedTransport,
  type WorkspacePeerOpts,
} from '../src';
import { startRelay, type TestRelay } from './relay';
import { startBlossom, type TestBlossom } from './blossom-server';
import { memStore, until } from './util';

const CODE = 'K7QX2MPD';
const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());

let relay: TestRelay;
let transport: KeyedTransport;
const open: WorkspacePeer[] = [];
/** Every onError of this test; afterEach requires it empty, so tests that expect errors take theirs out. */
let errors: string[] = [];

function peer(kp: KeyPair, t: WsTransport = transport, store = memStore().store, extra: Partial<WorkspacePeerOpts> = {}) {
  const p = new WorkspacePeer({ code: CODE, kp, selfId: kp.pub.slice(0, 20), transport: t, store, devFileServers: true, onError: (m) => errors.push(m), ...extra });
  open.push(p);
  return p;
}

async function join(kp: KeyPair, t: WsTransport = transport, store = memStore().store, extra: Partial<WorkspacePeerOpts> = {}) {
  const p = peer(kp, t, store, extra);
  await p.start();
  await until(() => p.connected);
  return p;
}

/** A stored relay event in Yurt's wire format, built by hand to control what relays hold. */
const rawEvent = (content: string, tag: string, createdAt = Math.floor(Date.now() / 1000)) =>
  finalizeEvent({ kind: 4344, created_at: createdAt, tags: [['y', tag]], content }, generateSecretKey());

/** Swap the shared relay for one with other behaviour. */
async function useRelay(opts: Parameters<typeof startRelay>[1]) {
  await relay.close();
  relay = await startRelay(0, opts);
  transport = newNostrTransport([relay.url]);
}

const texts = (p: WorkspacePeer) => [...p.state.msgs.values()].map((m) => m.text);

beforeEach(async () => {
  errors = [];
  relay = await startRelay();
  transport = newNostrTransport([relay.url]);
});
afterEach(async () => {
  for (const p of open.splice(0)) p.leave();
  await relay.close();
  expect(errors).toEqual([]);
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

  it("carries a guest DM with someone else's agent to the member and the owner only", async () => {
    const a = await join(A);
    const b = await join(B);
    const c = await join(C);
    const ch = guestDmChannel(B.pub, A.pub, 'harvey');
    const ask = b.publish({ t: 'msg', ch, to: A.pub, b: { text: 'hi harvey' } });
    await until(() => texts(a).includes('hi harvey'));
    const answer = a.publish({ t: 'msg', ch, to: B.pub, ag: 'harvey', b: { text: 'hello from harvey' } });
    await until(() => texts(b).includes('hello from harvey'));
    const marker = c.publish({ t: 'msg', ch: 'general', b: { text: 'marker' } });
    await until(() => a.events.has(marker.id) && b.events.has(marker.id));
    expect(c.events.has(ask.id) || c.events.has(answer.id)).toBe(false);
  });

  it("syncs DMs to the author's other devices", async () => {
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
    const a = peer(A);
    const starting = a.start();
    a.publish({ t: 'ws.create', b: { name: 'Early' } }); // what createWorkspace does right after connecting
    await starting;
    await until(() => a.queued.size === 0);
    const b = await join(B);
    await until(() => b.state.name === 'Early');
  });

  it('re-sends my events that never reached a relay before the app closed', async () => {
    const unsent = makeEvent(A, { ws: CODE, t: 'ws.create', b: { name: 'Survived a restart' } });
    await join(A, transport, memStore({ initial: [unsent] }).store);
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
    const a = peer(A);
    await a.start();
    const e = a.publish({ t: 'msg', ch: 'general', b: { text: 'offline draft' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(a.queued.has(e.id)).toBe(true);
    expect(a.connected).toBe(false);
    relay = await startRelay(port);
    await until(() => a.queued.size === 0, 25_000);
    expect(relay.stored).toHaveLength(1);
  }, 30_000);

  it('skips private wrappers naming invalid keys and still finishes the backfill', async () => {
    const k = workspaceKeys(transport.key);
    // Only members can write these, but a member (or a buggy client) can write anything.
    for (const a of ['not hex', 'f'.repeat(64)]) relay.stored.push(rawEvent(seal(k.enc, k.tag, JSON.stringify({ a, to: A.pub, c: 'x' })), k.inbox(A.pub)));
    const good = makeEvent(B, { ws: CODE, t: 'ws.create', b: { name: 'Still synced' } });
    relay.stored.push(rawEvent(seal(k.enc, k.tag, JSON.stringify(good)), k.tag, Math.floor(Date.now() / 1000) - 5 * 3600)); // backfill only
    const s = memStore();
    const a = await join(A, transport, s.store);
    await until(() => a.state.name === 'Still synced' && s.mark() > 0);
  });

  it('pages each relay to the end even when it serves fewer events than asked', async () => {
    await useRelay({ maxLimit: 5 });
    const a = await join(A);
    const sent = Array.from({ length: 12 }, (_, i) => a.publish({ t: 'msg', ch: 'general', b: { text: 'm' + i } }));
    await until(() => a.queued.size === 0);
    const s = memStore();
    const b = await join(B, transport, s.store);
    await until(() => sent.every((e) => b.events.has(e.id)) && s.mark() > 0);
  });

  it('gives up on an event relays keep refusing, says why once, and keeps it queued', async () => {
    let refusals = 0;
    await useRelay({
      refuse: (e) => {
        if (e.kind !== 4344) return null;
        refusals++;
        return 'blocked: members of the relay only';
      },
    });
    const a = await join(A);
    const e = a.publish({ t: 'msg', ch: 'general', b: { text: 'refused' } });
    await until(() => errors.length > 0, 45_000);
    expect(refusals).toBe(3); // retried a bounded number of times first
    expect(errors).toEqual([expect.stringContaining('blocked: members of the relay only')]);
    await new Promise((r) => setTimeout(r, 16_000)); // a full retry period: nothing more is sent or reported
    expect(refusals).toBe(3);
    expect(errors).toHaveLength(1);
    expect(a.queued.has(e.id)).toBe(true);
    errors = [];
  }, 70_000);

  it('does not re-send own events whose fuzzed relay copy predates the sync window', async () => {
    const k = workspaceKeys(transport.key);
    const since = Math.floor(Date.now() / 1000) - 30 * 3600; // where the next backfill starts (mark − 1 day)
    const ev = makeEvent(A, { ws: CODE, t: 'ws.create', b: { name: 'Backdated' }, ts: (since + 600) * 1000 });
    relay.stored.push(rawEvent(seal(k.enc, k.tag, JSON.stringify(ev)), k.tag, since - 600)); // created_at backdated past `since`
    const s = memStore({ initial: [ev], mark: since + 86_400 });
    await join(A, transport, s.store);
    await until(() => s.mark() > since + 86_400);
    await new Promise((r) => setTimeout(r, 300));
    expect(relay.stored).toHaveLength(1);
  });

  it('opens no relay link when left while still loading', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const base = memStore().store;
    const a = peer(A, transport, {
      ...base,
      load: async (ws) => {
        await gate;
        return base.load(ws);
      },
    });
    const starting = a.start();
    a.leave();
    release();
    await starting;
    await new Promise((r) => setTimeout(r, 500));
    expect(a.connected).toBe(false);
    expect(a.relayStatus()).toEqual(new Map([[relay.url, false]]));
  });

  it("reports each relay's connection", async () => {
    const down = 'ws://127.0.0.1:9';
    const a = await join(A, newNostrTransport([relay.url, down]));
    expect(a.relayStatus()).toEqual(
      new Map([
        [relay.url, true],
        [down, false],
      ]),
    );
  });

  it('reports a failed save on this device', async () => {
    const a = await join(A, transport, {
      ...memStore().store,
      save: async () => {
        throw new Error('disk full');
      },
    });
    a.publish({ t: 'msg', ch: 'general', b: { text: 'x' } });
    await until(() => errors.some((m) => m.includes('disk full')));
    errors = [];
  });
});

describe('files in relay workspaces', () => {
  let blossom: TestBlossom;
  beforeEach(async () => {
    blossom = await startBlossom();
  });
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

  it('only come from https servers unless dev file servers are allowed', async () => {
    const a = await join(A);
    const f = await attach('over plain http');
    const m = a.publish({ t: 'msg', ch: 'general', b: { text: 'x', files: [f] } });
    const b = await join(B, transport, memStore().store, { devFileServers: false });
    await until(() => b.events.has(m.id));
    expect(await b.fetchFile(f.id)).toBeNull();
    expect(read(await a.fetchFile(f.id))).toBe('over plain http');
  });

  it('shrug off malformed refs from other members', async () => {
    const a = await join(A);
    const f = await attach('x');
    a.publish({ t: 'msg', ch: 'general', b: { text: 'x', files: [{ ...f, blob: { key: 5, hash: null, servers: 5 } }] } });
    a.requestBlob(f.id); // fire and forget: must not become an unhandled rejection
    expect(await a.fetchFile(f.id)).toBeNull();
  });
});

describe('workspace peer', () => {
  it('refuses a Trystero workspace without a WebRTC room', () => {
    expect(() => new WorkspacePeer({ code: CODE, kp: A, selfId: 'a', store: memStore().store, onError: (m) => errors.push(m) })).toThrow('Trystero workspaces need joinRoom');
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
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WorkspacePeer, reduce, makeEvent, keyFromPhrase, newRecoveryPhrase, newNostrTransport, newTrysteroTransport, dmChannel, workspaceKeys, open,
  type Ev, type KeyPair, type PeerStore, type KeyedTransport,
} from '../src';
import { startRelay, type TestRelay } from './relay';

// Key rotation against a real local relay: every device is a real WorkspacePeer with its own store.
const CODE = 'K7QX2MPD';
const [A, B, C, D, E] = Array.from({ length: 5 }, () => keyFromPhrase(newRecoveryPhrase()));

function memStore() {
  const evs = new Map<string, Ev>();
  let mark = 0;
  const store: PeerStore = {
    load: async () => [...evs.values()],
    save: async (xs) => { xs.forEach((e) => evs.set(e.id, e)); },
    loadMark: async () => mark,
    saveMark: async (_ws, s) => { mark = s; },
  };
  return store;
}

async function until(cond: () => boolean, what = 'condition', ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let relay: TestRelay;
let transport: KeyedTransport;
let errors: string[];
const peers: WorkspacePeer[] = [];

async function join(kp: KeyPair, name: string, opts: { key?: string; store?: PeerStore; onKey?: (k: string) => void } = {}) {
  const t = { ...transport, key: opts.key ?? transport.key };
  const p = new WorkspacePeer({ code: CODE, kp, selfId: kp.pub.slice(0, 20), transport: t, creator: A.pub, store: opts.store ?? memStore(), onError: (m) => errors.push(m), onKey: opts.onKey });
  peers.push(p);
  await p.start();
  await until(() => p.connected, name + ' connected');
  p.publish({ t: 'profile', b: { name, handle: name.toLowerCase() } });
  return p;
}
const texts = (p: WorkspacePeer) => [...p.state.msgs.values()].map((m) => m.text);
const say = (p: WorkspacePeer, text: string) => p.publish({ t: 'msg', ch: 'general', b: { text } });

beforeEach(async () => {
  relay = await startRelay();
  transport = newNostrTransport([relay.url]);
  errors = [];
});
afterEach(async () => {
  peers.splice(0).forEach((p) => p.leave());
  await relay.close();
  expect(errors).toEqual([]);
});

/** A (creator), B and C in a workspace with some history; then A bans C and rotates the key. */
async function banAndRotate() {
  const a = await join(A, 'Ada');
  a.publish({ t: 'ws.create', b: { name: 'Team' } });
  a.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
  const b = await join(B, 'Bo');
  const c = await join(C, 'Cy');
  say(a, 'before the ban');
  await until(() => [b, c].every((p) => texts(p).includes('before the ban') && p.state.profiles.size === 3), 'history on B and C');
  await until(() => a.state.profiles.size === 3, 'A sees every profile');
  a.publish({ t: 'ban', b: { target: C.pub, on: true } });
  const rk = a.rotate();
  await until(() => b.inviteKey === a.inviteKey, 'B adopts the new key');
  return { a, b, c, rk };
}

describe('key rotation', () => {
  it('cuts a banned member off from everything new', async () => {
    const { a, b, c } = await banAndRotate();
    expect(a.inviteKey).not.toBe(transport.key);
    const secret = say(a, 'after the ban');
    b.publish({ t: 'msg', ch: 'general', b: { text: 'b after the ban' } });
    await until(() => texts(b).includes('after the ban') && texts(a).includes('b after the ban'), 'members still talk');
    await pause(500);
    expect(texts(c)).not.toContain('after the ban');
    expect(texts(c)).not.toContain('b after the ban');
    expect(c.events.has(secret.id)).toBe(false); // never even decrypted, not just hidden
    await until(() => c.lockedOut, 'C sees it was removed');
    expect(a.lockedOut || b.lockedOut).toBe(false);
  });

  it('leaves nothing on the relay that the old key can open', async () => {
    const { a, b } = await banAndRotate();
    const before = new Set(relay.stored.map((e) => e.id));
    say(a, 'secret after rotation');
    await until(() => texts(b).includes('secret after rotation'), 'B reads it');
    const old = workspaceKeys(transport.key);
    const newer = relay.stored.filter((e) => !before.has(e.id));
    expect(newer.length).toBeGreaterThan(0);
    for (const e of newer) expect(open(old.enc, old.tag, e.content)).toBeNull();
  });

  it('gives someone invited afterwards the whole history, before and after the rotation', async () => {
    const { a } = await banAndRotate();
    say(a, 'after the ban');
    await until(() => a.queued.size === 0, 'A delivered');
    const d = await join(D, 'Di', { key: a.inviteKey });
    await until(() => texts(d).includes('before the ban') && texts(d).includes('after the ban'), 'D reads both epochs');
    expect(d.lockedOut).toBe(false);
    expect(d.inviteKey).toBe(a.inviteKey);
  });

  it('gives an out-of-date invite only the history from before the rotation', async () => {
    const { a } = await banAndRotate();
    say(a, 'after the ban');
    await until(() => a.queued.size === 0, 'A delivered');
    const e = await join(E, 'Ed', { key: transport.key });
    await until(() => texts(e).includes('before the ban') && e.lockedOut, 'E reads old history and knows it is out of date');
    await pause(300);
    expect(texts(e)).not.toContain('after the ban');
  });

  it('ignores a rotation by someone who is not an admin', async () => {
    const { a, b, c } = await banAndRotate();
    const key = a.inviteKey;
    expect(() => b.rotate()).toThrow('Only admins');
    // A forged rekey from B, handing a new key to everyone including C.
    const ring = { keys: new Map(), write: { key: transport.key, keys: workspaceKeys(transport.key), epoch: 0 }, lockedOut: false };
    const { makeRekey } = await import('../src');
    b.publish({ t: 'rekey', b: makeRekey(ring, B, [A.pub, B.pub, C.pub]).body });
    await pause(500);
    expect(a.inviteKey).toBe(key);
    say(a, 'still private');
    await until(() => texts(b).includes('still private'), 'B reads it');
    await pause(300);
    expect(texts(c)).not.toContain('still private');
  });

  it('rebuilds the key chain from the log after a restart', async () => {
    const store = memStore();
    const a = await join(A, 'Ada');
    a.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    let b = await join(B, 'Bo', { store });
    await until(() => a.state.profiles.size === 2, 'A sees B');
    a.rotate();
    await until(() => b.inviteKey === a.inviteKey, 'B adopts the new key');
    b.leave();
    b = await join(B, 'Bo', { store }); // still started from the original invite key
    expect(b.inviteKey).toBe(a.inviteKey);
    say(a, 'after restart');
    await until(() => texts(b).includes('after restart'), 'B reads new messages');
  });

  it('converges when two admins rotate at the same time', async () => {
    const a = await join(A, 'Ada');
    a.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    const b = await join(B, 'Bo');
    a.publish({ t: 'role', b: { target: B.pub, admin: true } });
    await until(() => b.state.admins.has(B.pub) && a.state.profiles.size === 2 && b.state.profiles.size === 2, 'B is an admin');
    a.rotate();
    b.rotate();
    await until(() => a.inviteKey === b.inviteKey && a.state.rekeys.length === 2 && b.state.rekeys.length === 2, 'both settle on one key');
    say(a, 'from a');
    say(b, 'from b');
    await until(() => texts(a).includes('from b') && texts(b).includes('from a'), 'both read each other');
  });

  it('keeps DMs working and private after a rotation', async () => {
    const { a, b, c } = await banAndRotate();
    const dm = a.publish({ t: 'msg', ch: dmChannel(A.pub, B.pub), to: B.pub, b: { text: 'just us, new key' } });
    await until(() => b.events.has(dm.id), 'B gets the DM');
    await pause(300);
    expect(c.events.has(dm.id)).toBe(false);
  });

  it('tells the app the new key to use in invite links', async () => {
    const keys: string[] = [];
    const a = await join(A, 'Ada', { onKey: (k) => keys.push(k) });
    a.rotate();
    expect(keys).toEqual([a.inviteKey]);
  });

  it('only rotates relay workspaces', () => {
    const p = new WorkspacePeer({ code: CODE, kp: A, selfId: 'a', transport: newTrysteroTransport(), store: memStore(), onError: (m) => errors.push(m), joinRoom: () => { throw new Error('unused'); } });
    expect(() => p.rotate()).toThrow('Only relay workspaces');
  });
});

describe('which rotations count', () => {
  const ev = (kp: KeyPair, t: Ev['t'], b: unknown, ts: number) => makeEvent(kp, { ws: CODE, t, b, ts });
  const body = (epoch: number) => ({ epoch, keys: { [A.pub]: 'x' }, history: 'y' });
  const epochs = (evs: Ev[]) => reduce(CODE, evs, { creator: A.pub }).rekeys.map((r) => [r.a, r.epoch]);

  it('counts admins, not other members, and rejects malformed bodies', () => {
    expect(epochs([ev(A, 'rekey', body(1), 1), ev(B, 'rekey', body(1), 2)])).toEqual([[A.pub, 1]]);
    for (const bad of [{ epoch: 0, keys: {}, history: 'h' }, { epoch: 1.5, keys: {}, history: 'h' }, { epoch: 1, keys: 'k', history: 'h' }, { epoch: 1, keys: {} }, null]) {
      expect(epochs([ev(A, 'rekey', bad, 1)])).toEqual([]);
    }
  });

  it('keeps a rotation by an admin who is later demoted, but drops a banned one', () => {
    const promote = ev(A, 'role', { target: B.pub, admin: true }, 1);
    const rk = ev(B, 'rekey', body(1), 2);
    expect(epochs([promote, rk, ev(A, 'role', { target: B.pub, admin: false }, 3)])).toEqual([[B.pub, 1]]);
    expect(epochs([promote, rk, ev(A, 'ban', { target: B.pub, on: true }, 3)])).toEqual([]);
  });

  it('drops keys addressed to malformed pubkeys', () => {
    const r = reduce(CODE, [ev(A, 'rekey', { epoch: 1, keys: { [A.pub]: 'ok', nothex: 'x', [B.pub]: 7 }, history: 'h' }, 1)], { creator: A.pub }).rekeys[0];
    expect(Object.keys(r.keys)).toEqual([A.pub]);
  });
});

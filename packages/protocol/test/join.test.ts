import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WorkspacePeer,
  JoinClient,
  reduce,
  members,
  inviteOpen,
  keyFromPhrase,
  newRecoveryPhrase,
  newNostrTransport,
  newWorkspaceKey,
  workspaceKeys,
  parseInvite,
  joinHash,
  isJoinInvite,
  sealJoinRequest,
  openJoinRequest,
  sealGrant,
  openGrant,
  lobbyEvent,
  makeEvent,
  seal,
  sign,
  DEFAULT_RELAYS,
  type JoinInvite,
  type JoinReq,
  type KeyPair,
  type WsTransport,
} from '../src';
import { SimplePool } from 'nostr-tools/pool';
import { startRelay, type TestRelay } from './relay';
import { eventClock, memStore, northwind, until as waitFor } from './util';

const until = (cond: () => boolean, what: string) => waitFor(cond, 10_000, what);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CODE = 'K7QX2MPD';
const key = () => keyFromPhrase(newRecoveryPhrase());
const A = key(); // creator
const B = key(); // a member A makes admin
const J = key(); // asks to join
const K = key(); // someone else holding the link

describe('join links', () => {
  const jk = newWorkspaceKey();

  it('carry a join key and the creator, never the workspace key', () => {
    const inv: JoinInvite = { code: CODE, join: jk, relays: DEFAULT_RELAYS, creator: A.pub };
    const parsed = parseInvite('https://yurt.example/' + joinHash(inv));
    expect(parsed).toEqual(inv);
    expect(parsed && isJoinInvite(parsed)).toBe(true);
    const custom = { ...inv, relays: ['wss://a.io', 'wss://b.io'] };
    expect(parseInvite(joinHash(custom))).toEqual(custom);
  });

  it('are refused without a creator to check answers against', () => {
    expect(parseInvite(`#/w/${CODE}/j/${jk}/n/-`)).toBeNull();
    expect(parseInvite(`#/w/${CODE}/j/nope/n/-/o/${A.pub}`)).toBeNull();
  });

  it('read a link with both keys as the older kind', () => {
    const k = newWorkspaceKey();
    const inv = parseInvite(`#/w/${CODE}/k/${k}/j/${jk}/n/-/o/${A.pub}`);
    expect(inv && !isJoinInvite(inv)).toBe(true);
  });
});

describe('requests and grants', () => {
  const jk = newWorkspaceKey();
  const lk = workspaceKeys(jk);
  const invite: JoinInvite = { code: CODE, join: jk, relays: DEFAULT_RELAYS, creator: A.pub };
  const wk = newWorkspaceKey();
  const { ev } = eventClock(CODE);

  it('opens a signed request, and only for its workspace and invite', () => {
    const sealed = sealJoinRequest(J, CODE, jk, { name: 'Jo', handle: 'jo' }, 5);
    expect(openJoinRequest(CODE, jk, sealed)).toEqual({ pub: J.pub, name: 'Jo', handle: 'jo', ts: 5, jk });
    expect(openJoinRequest('OTHERWS1', jk, sealed)).toBeNull(); // signed for another workspace
    expect(openJoinRequest(CODE, newWorkspaceKey(), sealed)).toBeNull(); // another invite's lobby
    expect(openJoinRequest(CODE, jk, 'junk')).toBeNull();
    expect(openJoinRequest(CODE, jk, seal(lk.enc, lk.tag, '{not json'))).toBeNull();
    // Someone claiming another person's key can't sign for it.
    const forged = JSON.stringify({ p: K.pub, n: 'Jo', t: 5, s: 'ab' });
    expect(openJoinRequest(CODE, jk, seal(lk.enc, lk.tag, forged))).toBeNull();
    // Without a handle: none.
    const t = 6;
    const bare = { p: J.pub, n: 'Jo', t, s: sign(J.sec, `yurt-join:${CODE}:${lk.tag}:${t}:${J.pub}:${JSON.stringify(['Jo', ''])}`) };
    expect(openJoinRequest(CODE, jk, seal(lk.enc, lk.tag, JSON.stringify(bare)))).toMatchObject({ handle: '' });
  });

  it('takes a key from the creator', () => {
    expect(openGrant(J, invite, sealGrant(A, jk, J.pub, wk))).toEqual({ key: wk, by: A.pub });
    expect(openGrant(K, invite, sealGrant(A, jk, J.pub, wk))).toBeNull(); // sealed to someone else
  });

  it('takes a key from an admin only with the creator’s signed promotion', () => {
    const promo = ev(A, 'role', { target: B.pub, admin: true });
    expect(openGrant(J, invite, sealGrant(B, jk, J.pub, wk, promo))).toEqual({ key: wk, by: B.pub });
    expect(openGrant(J, invite, sealGrant(B, jk, J.pub, wk))).toBeNull(); // no proof
    expect(openGrant(J, invite, sealGrant(K, jk, J.pub, wk, promo))).toBeNull(); // someone else's promotion
    expect(openGrant(J, invite, sealGrant(B, jk, J.pub, wk, ev(A, 'role', { target: B.pub, admin: false })))).toBeNull();
    expect(openGrant(J, invite, sealGrant(B, jk, J.pub, wk, ev(K, 'role', { target: B.pub, admin: true })))).toBeNull(); // not by the creator
    expect(openGrant(J, invite, sealGrant(B, jk, J.pub, wk, ev(A, 'ban', { target: B.pub, on: true })))).toBeNull();
    expect(openGrant(J, invite, sealGrant(B, jk, J.pub, wk, ev(A, 'role', { target: B.pub })))).toBeNull(); // malformed body
    const elsewhere = makeEvent(A, { ws: 'OTHERWS1', t: 'role', b: { target: B.pub, admin: true } });
    expect(openGrant(J, invite, sealGrant(B, jk, J.pub, wk, elsewhere))).toBeNull();
    expect(openGrant(J, invite, sealGrant(B, jk, J.pub, wk, { ...promo, sig: promo.sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) }))).toBeNull();
  });

  it('ignores junk in the lobby inbox', () => {
    expect(openGrant(J, invite, 'junk')).toBeNull();
    const wrap = (o: unknown) => seal(lk.enc, lk.tag, JSON.stringify(o));
    expect(openGrant(J, invite, wrap({ a: A.pub }))).toBeNull();
    expect(openGrant(J, invite, wrap({ a: 'f'.repeat(64), c: 'x' }))).toBeNull(); // not a curve point
    expect(openGrant(J, invite, wrap({ a: A.pub, c: seal(lk.pair(A.sec, J.pub), lk.tag, '{"key":"short"}') }))).toBeNull();
  });
});

describe('invites and admissions in the log', () => {
  const { ev } = eventClock(CODE);
  const base = northwind(ev, A, B);
  const jk = newWorkspaceKey();

  it('lets anyone in make an invite, and its maker or an admin revoke it', () => {
    const mine = ev(B, 'invite', { jk, on: true, exp: 2_000_000_000_000 });
    let s = reduce(CODE, [...base, mine, ev(A, 'invite', { jk, on: true })], { creator: A.pub });
    expect(s.invites.get(jk)).toMatchObject({ by: B.pub, off: false, exp: 2_000_000_000_000 }); // first one counts
    expect(inviteOpen(s, jk, 1_999_999_999_999)).toBe(true);
    expect(inviteOpen(s, jk, 2_000_000_000_000)).toBe(false);
    expect(inviteOpen(s, newWorkspaceKey(), 0)).toBe(false);
    s = reduce(CODE, [...base, mine, ev(K, 'invite', { jk, on: false })], { creator: A.pub });
    expect(s.invites.get(jk)?.off).toBe(false); // neither its maker nor an admin
    for (const by of [A, B]) {
      s = reduce(CODE, [...base, mine, ev(by, 'invite', { jk, on: false })], { creator: A.pub });
      expect(inviteOpen(s, jk, 0)).toBe(false);
    }
    s = reduce(CODE, [...base, ev(A, 'invite', { jk, on: false })], { creator: A.pub });
    expect(s.invites.size).toBe(0);
    s = reduce(CODE, [...base, ev(A, 'invite', { jk, on: true })], { creator: A.pub });
    expect(inviteOpen(s, jk, Date.now())).toBe(true); // no expiry
  });

  it('counts admissions by admins only, and the latest answer', () => {
    const s = reduce(
      CODE,
      [
        ...base,
        ev(B, 'admit', { target: K.pub, jk, on: true }), // B isn't an admin
        ev(A, 'admit', { target: J.pub, jk, on: false }),
        ev(A, 'admit', { target: J.pub, on: true }),
        ev(A, 'admit', { target: 'nope', on: true }),
      ],
      { creator: A.pub },
    );
    expect(s.admits.has(K.pub)).toBe(false);
    expect(s.admits.get(J.pub)).toMatchObject({ by: A.pub, on: true });
    expect(members(s).sort()).toEqual([A.pub, B.pub, J.pub].sort()); // let in, even before a profile
    const banned = reduce(CODE, [...base, ev(A, 'admit', { target: J.pub, on: true }), ev(A, 'ban', { target: J.pub, on: true })], { creator: A.pub });
    expect(members(banned)).not.toContain(J.pub);
    const declined = reduce(CODE, [...base, ev(A, 'admit', { target: J.pub, on: false })], { creator: A.pub });
    expect(members(declined)).not.toContain(J.pub);
  });
});

describe('joining with approval, over a relay', () => {
  let relay: TestRelay;
  let transport: WsTransport;
  let errors: string[];
  const peers: WorkspacePeer[] = [];
  const clients: JoinClient[] = [];
  let asked: JoinReq[];

  async function start(kp: KeyPair, name: string, k = transport.key) {
    const p = new WorkspacePeer({
      code: CODE,
      kp,
      transport: { ...transport, key: k },
      creator: A.pub,
      store: memStore().store,
      onError: (m) => errors.push(m),
      onJoinRequest: (r) => asked.push(r),
    });
    peers.push(p);
    await p.start();
    await until(() => p.connected, name + ' connected');
    p.publish({ t: 'profile', b: { name, handle: name.toLowerCase() } });
    return p;
  }
  function ask(kp: KeyPair, jk: string, onGranted: (key: string, by: string) => void, relays = transport.relays, retryMs: number | undefined = 20) {
    const c = new JoinClient({ invite: { code: CODE, join: jk, relays, creator: A.pub }, kp, who: { name: 'Jo', handle: 'jo' }, onGranted, retryMs });
    clients.push(c);
    return c;
  }

  beforeEach(async () => {
    relay = await startRelay();
    transport = newNostrTransport([relay.url]);
    errors = [];
    asked = [];
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) c.leave();
    for (const p of peers.splice(0)) p.leave();
    await relay.close();
    expect(errors).toEqual([]);
  });

  it('lets someone in only once an admin says so', async () => {
    const a = await start(A, 'Ada');
    a.publish({ t: 'ws.create', b: { name: 'Team' } });
    a.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    a.publish({ t: 'msg', ch: 'general', b: { text: 'before you came' } });
    const jk = newWorkspaceKey();
    a.publish({ t: 'invite', b: { jk, on: true } });
    let granted: { key: string; by: string } | null = null;
    ask(J, jk, (k, by) => {
      granted = { key: k, by };
    });
    await until(() => a.joinRequests.length === 1, 'A sees the request');
    // Anyone with the link can post in J's lobby inbox; junk there is ignored.
    const pool = new SimplePool();
    await Promise.any(pool.publish([relay.url], lobbyEvent(workspaceKeys(jk).inbox(J.pub), 'junk')));
    pool.destroy();
    expect(a.joinRequests[0]).toMatchObject({ pub: J.pub, name: 'Jo', handle: 'jo', jk });
    expect(asked.map((r) => r.pub)).toEqual([J.pub]);
    await pause(300);
    expect(granted).toBeNull(); // the link alone gets nobody in
    a.admit(J.pub, true);
    await until(() => a.joinRequests.length === 0, 'answered');
    await until(() => granted !== null, 'J gets the key');
    expect(granted).toEqual({ key: a.inviteKey, by: A.pub });
    const j = await start(J, 'Jo', a.inviteKey);
    await until(() => [...j.state.msgs.values()].some((m) => m.text === 'before you came'), 'J reads the history');
  });

  it('lets an admin who isn’t the creator answer, with proof', async () => {
    const a = await start(A, 'Ada');
    a.publish({ t: 'ws.create', b: { name: 'Team' } });
    const b = await start(B, 'Bo');
    a.publish({ t: 'role', b: { target: B.pub, admin: true } });
    a.publish({ t: 'role', b: { target: B.pub, admin: true } }); // promoted twice: either proves it
    await until(() => b.state.admins.has(B.pub) && [...b.events.values()].filter((e) => e.t === 'role').length === 2, 'B is an admin');
    const jk = newWorkspaceKey();
    b.publish({ t: 'invite', b: { jk, on: true } });
    let by = '';
    ask(J, jk, (_k, who) => {
      by = who;
    });
    await until(() => b.joinRequests.length === 1 && a.joinRequests.length === 1, 'both admins see it');
    b.admit(J.pub, true);
    await until(() => by === B.pub, 'J takes B’s answer');
    await until(() => a.joinRequests.length === 0, 'A sees it was answered');
  });

  it('keeps people out who were turned away, until they ask again', async () => {
    const a = await start(A, 'Ada');
    a.publish({ t: 'ws.create', b: { name: 'Team' } });
    const jk = newWorkspaceKey();
    a.publish({ t: 'invite', b: { jk, on: true } });
    await until(() => a.state.invites.has(jk), 'the invite is in the log');
    const post = (ts: number) => a.joinRequest(jk, sealJoinRequest(J, CODE, jk, { name: 'Jo', handle: 'jo' }, ts));
    post(Date.now() - 5000);
    expect(a.joinRequests).toHaveLength(1);
    a.admit(J.pub, false);
    await until(() => a.joinRequests.length === 0, 'turned away');
    post(Date.now() - 6000); // an older copy changes nothing
    expect(a.joinRequests).toHaveLength(0);
    post(Date.now() + 1000);
    expect(a.joinRequests).toHaveLength(1); // a new request after the answer
    a.joinRequest(jk, sealJoinRequest(K, CODE, jk, { name: 'Kai', handle: '' }));
    expect(a.joinRequests.map((r) => r.pub)).toEqual([K.pub, J.pub]); // oldest first
    a.publish({ t: 'invite', b: { jk, on: false } });
    await until(() => a.joinRequests.length === 0, 'the invite was revoked');
    a.joinRequest(jk, 'junk');
    expect(asked).toHaveLength(3);
  });

  it('only lets admins answer, and only people who asked', async () => {
    const a = await start(A, 'Ada');
    a.publish({ t: 'ws.create', b: { name: 'Team' } });
    const b = await start(B, 'Bo');
    const jk = newWorkspaceKey();
    a.publish({ t: 'invite', b: { jk, on: true } });
    b.joinRequest(jk, sealJoinRequest(J, CODE, jk, { name: 'Jo', handle: 'jo' }));
    expect(() => b.admit(J.pub, true)).toThrow('Only admins');
    expect(() => a.admit(K.pub, true)).toThrow('haven’t asked');
    await until(() => b.state.invites.has(jk), 'B sees the invite');
    expect(b.joinRequests).toHaveLength(1); // anyone may see who asked; only admins are told
    expect(asked).toHaveLength(0);
  });

  it('includes people let in when the key rotates, before they say who they are', async () => {
    const a = await start(A, 'Ada');
    a.publish({ t: 'ws.create', b: { name: 'Team' } });
    const jk = newWorkspaceKey();
    a.publish({ t: 'invite', b: { jk, on: true } });
    let got = '';
    ask(J, jk, (k) => {
      got = k;
    });
    await until(() => a.joinRequests.length === 1, 'A sees the request');
    a.admit(J.pub, true);
    await until(() => got !== '', 'J gets the first key');
    a.rotate();
    a.publish({ t: 'msg', ch: 'general', b: { text: 'after the rotation' } });
    const j = new WorkspacePeer({ code: CODE, kp: J, transport: { ...transport, key: got }, creator: A.pub, store: memStore().store, onError: (m) => errors.push(m) });
    peers.push(j);
    await j.start();
    await until(() => j.inviteKey === a.inviteKey && !j.lockedOut, 'J follows the rotation');
  });

  it('keeps asking while no relay takes the request, and stops when told', async () => {
    const dead = ['ws://127.0.0.1:1'];
    ask(J, newWorkspaceKey(), () => {}, dead).leave(); // gave up at once
    ask(J, newWorkspaceKey(), () => {}, dead);
    // At the default pace (15 s) it waits past the end of this test.
    clients.push(new JoinClient({ invite: { code: CODE, join: newWorkspaceKey(), relays: dead, creator: A.pub }, kp: J, who: { name: 'Jo', handle: '' }, onGranted: () => {} }));
    await pause(200);
  });
});

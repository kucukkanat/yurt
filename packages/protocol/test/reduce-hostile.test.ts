import { describe, it, expect } from 'vitest';
import { newRecoveryPhrase, keyFromPhrase, makeEvent, reduce, liveAgents, members, dmChannel, agentDmChannel, EDIT_WINDOW_MS, type Ev, type EvType } from '../src';

const WS = 'K7QX2MPD';
const A = keyFromPhrase(newRecoveryPhrase()); // creator
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());
const D = keyFromPhrase(newRecoveryPhrase());
let clock = 1_700_000_000_000;
const ev = (kp: typeof A, t: EvType, b: unknown, extra: { ch?: string; to?: string; ag?: string; ts?: number } = {}) =>
  makeEvent(kp, { ws: WS, t, b, ts: (clock += 1000), ...extra });

const base = (): Ev[] => [
  ev(A, 'ws.create', { name: 'Northwind' }),
  ev(A, 'ch.create', { id: 'general', name: 'general' }),
  ev(A, 'profile', { name: 'Ada', handle: 'ada' }),
  ev(B, 'profile', { name: 'Bo', handle: 'bo' }),
];

describe('reduce on hostile bodies', () => {
  it('ignores bad events without throwing and keeps applying the rest', () => {
    const evs = base();
    const m = ev(B, 'msg', { text: 'hi' }, { ch: 'general' });
    const evil = { toString: 0, valueOf: 0 };
    const bad = [
      ev(C, 'react', { target: m.id, icon: '__proto__', on: true }),
      ev(C, 'react', { target: m.id, icon: 'constructor', on: true }),
      ev(C, 'react', { target: m.id, icon: 'hasOwnProperty', on: false }),
      ev(C, 'react', { target: m.id, icon: evil, on: true }),
      ev(C, 'profile', { name: evil, handle: 'x' }),
      ev(C, 'profile', { name: 'Cy', handle: evil }),
      ev(C, 'ch.create', { id: 'x', name: evil }),
      ev(C, 'ch.create', { id: evil, name: 'y' }),
      ev(C, 'ch.update', { id: 'general', name: evil, topic: evil }),
      ev(C, 'msg', { text: evil }, { ch: 'general' }),
      ev(C, 'msg', { text: 'ok', parent: evil }, { ch: 'general' }),
      ev(C, 'msg', { text: 'f', files: [evil, null, 1], trace: 'x', approval: evil }, { ch: 'general' }),
      ev(C, 'msg', ['text'], { ch: 'general' }),
      ev(C, 'msg', null, { ch: 'general' }),
      ev(B, 'edit', { target: m.id, text: evil }),
      ev(C, 'pin', { target: m.id, on: evil }),
      ev(C, 'agent', { id: 'x', handle: 'x', name: evil, runtime: 'r', replyIn: 'thread' }),
      ev(C, 'role', null),
      ev(A, 'role', { target: evil, admin: true }),
      ev(A, 'ban', { target: C.pub, on: 'yes' }),
      ev(C, 'approve', { req: evil, option: evil }),
      ev(A, 'ws.create', null),
    ];
    const tail = ev(C, 'react', { target: m.id, icon: 'heart', on: true });
    const s = reduce(WS, [...evs, m, ...bad, tail]);
    const r = s.msgs.get(m.id);
    expect(Object.keys(r?.reactions ?? {})).toEqual(['__proto__', 'constructor', 'heart']);
    expect(r?.reactions['heart']).toEqual([C.pub]);
    expect(r?.text).toBe('hi');
    expect(s.channels.get('general')).toMatchObject({ name: 'general', topic: '' });
    expect([...s.channels.keys()]).toEqual(['general']);
    expect(s.profiles.has(C.pub)).toBe(false);
    expect(s.channelMsgs.get('general')).toHaveLength(2); // m, plus "f" with its malformed parts dropped
    expect(s.msgs.get(bad[11].id)).toMatchObject({ files: [], trace: [], approval: undefined });
    expect(s.pins.size + s.agents.size + s.approvals.size + s.bans.size).toBe(0);
    expect(s.name).toBe('Northwind');
  });

  it('skips structurally invalid events instead of mis-sorting on them', () => {
    const evs = base();
    const nan = { ...ev(A, 'ch.create', { id: 'x', name: 'x' }), ts: NaN };
    const junk = [null, 'x', { t: 'msg' }] as unknown as Ev[];
    const s = reduce(WS, [...evs, nan, ...junk]);
    expect([...s.channels.keys()]).toEqual(['general']);
  });
});

describe('reduce authority', () => {
  it('pins the creator from the invite over an earlier forged ws.create', () => {
    const forged = makeEvent(C, { ws: WS, t: 'ws.create', b: { name: 'Evil' }, ts: 1 });
    const s = reduce(WS, [forged, ...base(), ev(C, 'ban', { target: A.pub, on: true })], { creator: A.pub });
    expect(s.creator).toBe(A.pub);
    expect(s.name).toBe('Northwind');
    expect(s.bans.size).toBe(0);
  });

  it('lets admins ban non-admins only, and only the creator ban or demote an admin', () => {
    const promote = [ev(A, 'role', { target: B.pub, admin: true }), ev(A, 'role', { target: C.pub, admin: true })];
    // Admin C backdates a ban of admin B to before anything else: ignored.
    const preempt = makeEvent(C, { ws: WS, t: 'ban', b: { target: B.pub, on: true }, ts: 2 });
    const s = reduce(WS, [
      ...base(),
      ...promote,
      preempt,
      ev(C, 'ban', { target: B.pub, on: true }),
      ev(C, 'ban', { target: D.pub, on: true }),
      ev(C, 'ban', { target: C.pub, on: true }),
      ev(B, 'role', { target: C.pub, admin: false }),
    ]);
    expect([...s.admins].sort()).toEqual([A.pub, B.pub, C.pub].sort());
    expect([...s.bans]).toEqual([D.pub]);
    const t = reduce(WS, [...base(), ...promote, ev(A, 'ban', { target: B.pub, on: true }), ev(A, 'role', { target: C.pub, admin: false })]);
    expect([...t.admins]).toEqual([A.pub]);
    expect([...t.bans]).toEqual([B.pub]);
  });

  it('treats the edit window as advisory but never lets an edit predate its message', () => {
    const evs = base();
    const m = ev(B, 'msg', { text: 'v1' }, { ch: 'general' });
    const early = makeEvent(B, { ws: WS, t: 'edit', b: { target: m.id, text: 'v0' }, ts: m.ts - 1 });
    const early2 = makeEvent(B, { ws: WS, t: 'del', b: { target: m.id }, ts: m.ts - 1 });
    const late = makeEvent(B, { ws: WS, t: 'edit', b: { target: m.id, text: 'v9' }, ts: m.ts + EDIT_WINDOW_MS + 1 });
    expect(reduce(WS, [...evs, m, early, early2, late]).msgs.get(m.id)).toMatchObject({ text: 'v1', deleted: false });
  });
});

describe('reduce private channels', () => {
  it('accepts DMs only between the two parties, addressed to the other', () => {
    const ch = dmChannel(A.pub, B.pub);
    const ok = [ev(A, 'msg', { text: '1' }, { ch, to: B.pub }), ev(B, 'msg', { text: '2' }, { ch, to: A.pub })];
    const self = dmChannel(A.pub, A.pub);
    const okSelf = ev(A, 'msg', { text: 'me' }, { ch: self, to: A.pub });
    const bad = [
      ev(C, 'msg', { text: 'posing' }, { ch, to: A.pub }),
      ev(A, 'msg', { text: 'public' }, { ch }),
      ev(A, 'msg', { text: 'wrong to' }, { ch, to: C.pub }),
      ev(A, 'msg', { text: 'unsorted' }, { ch: 'dm:' + [A.pub, B.pub].sort().reverse().join(':'), to: B.pub }),
      ev(A, 'msg', { text: 'extra' }, { ch: ch + ':x', to: B.pub }),
    ];
    const s = reduce(WS, [...base(), ...ok, okSelf, ...bad]);
    expect(s.channelMsgs.get(ch)).toEqual(ok.map((e) => e.id));
    expect(s.channelMsgs.get(self)).toEqual([okSelf.id]);
    expect(bad.some((e) => s.msgs.has(e.id))).toBe(false);
  });

  it('accepts agent-DM messages only from the owner, as itself or that agent, to itself', () => {
    const ch = agentDmChannel(A.pub, 'scout');
    const ok = [ev(A, 'msg', { text: 'do it' }, { ch, to: A.pub }), ev(A, 'msg', { text: 'done' }, { ch, to: A.pub, ag: 'scout' })];
    const bad = [
      ev(B, 'msg', { text: 'x' }, { ch, to: A.pub }),
      ev(A, 'msg', { text: 'x' }, { ch }),
      ev(A, 'msg', { text: 'x' }, { ch, to: A.pub, ag: 'other' }),
      ev(A, 'msg', { text: 'x' }, { ch: 'adm:' + A.pub, to: A.pub }),
    ];
    const s = reduce(WS, [...base(), ...ok, ...bad]);
    expect(s.channelMsgs.get(ch)).toEqual(ok.map((e) => e.id));
    expect(bad.some((e) => s.msgs.has(e.id))).toBe(false);
  });
});

describe('reduce approvals', () => {
  it('takes answers only from the human owner of the asking agent, even when clocks disagree', () => {
    const ch = agentDmChannel(A.pub, 'scout');
    const approval = { req: 'r1', title: 'run tests', options: [{ id: 'yes', name: 'Allow', kind: 'allow_once' }] };
    const byOther = ev(B, 'approve', { req: 'r1', option: 'no' });
    const byAgent = ev(A, 'approve', { req: 'r1', option: 'no' }, { ag: 'scout' });
    const byOwner = ev(A, 'approve', { req: 'r1', option: 'yes' }, { ts: 1 }); // owner clock far behind
    const ask = ev(A, 'msg', { text: 'ok?', approval }, { ch, to: A.pub, ag: 'scout' });
    expect(reduce(WS, [...base(), byOwner, ask, byOther, byAgent]).approvals.get('r1')).toBe('yes');
    expect(reduce(WS, [...base(), ask, byOther]).approvals.has('r1')).toBe(false);
    // Approval prompts outside the owner's agent channel don't exist, so they can't be answered.
    const pub = ev(B, 'msg', { text: 'ok?', approval: { ...approval, req: 'r2' } }, { ch: 'general' });
    const s = reduce(WS, [...base(), pub, ev(B, 'approve', { req: 'r2', option: 'yes' })]);
    expect(s.msgs.get(pub.id)?.approval).toBeUndefined();
    expect(s.approvals.size).toBe(0);
  });
});

describe('reduce keeps well-formed data intact', () => {
  it('passes valid files, traces, agents, pins, reactions, topic updates and deletes through', () => {
    const evs = base();
    const file = { id: 'f1', name: 'a.txt', size: 3, type: 'text/plain', blob: { key: 'k', hash: 'h', servers: ['https://s'] } };
    const trace = [{ title: 'Read', tool: 'read', status: 'done', ms: 5 }];
    const m = ev(B, 'msg', { text: 'x', files: [file, { ...file, blob: { key: 1 } }], trace, meta: 'm' }, { ch: 'general' });
    const agent = { id: 'scout', name: 'Scout', handle: 'scout', runtime: 'claude', replyIn: 'thread' };
    const s = reduce(WS, [
      ...evs,
      m,
      ev(A, 'ch.update', { id: 'general', name: 'main', topic: 'hi' }),
      ev(A, 'react', { target: m.id, icon: 'heart', on: true }),
      ev(A, 'react', { target: m.id, icon: 'heart', on: false }),
      ev(A, 'pin', { target: m.id, on: true }),
      ev(A, 'agent', agent),
      ev(B, 'agent', { ...agent, removed: true }),
    ]);
    expect(s.msgs.get(m.id)).toMatchObject({ files: [file], trace, meta: 'm', reactions: {} });
    expect(s.channels.get('general')).toMatchObject({ name: 'main', topic: 'hi' });
    expect(s.pins.get('general')).toEqual(new Set([m.id]));
    expect(liveAgents(s).map((a) => a.owner)).toEqual([A.pub]);
    expect(members(s).sort()).toEqual([A.pub, B.pub].sort());
    expect(reduce(WS, [...evs, m, ev(B, 'del', { target: m.id })]).msgs.get(m.id)).toMatchObject({ deleted: true, text: '', files: [] });
  });
});

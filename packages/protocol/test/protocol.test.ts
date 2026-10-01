import { describe, it, expect } from 'vitest';
import {
  newRecoveryPhrase,
  keyFromPhrase,
  isValidPhrase,
  sign,
  verify,
  fingerprint,
  makeEvent,
  verifyEvent,
  reduce,
  EDIT_WINDOW_MS,
  summarize,
  diffDays,
  idsByDays,
  reconcile,
  normalizeCode,
  formatCode,
  newInviteCode,
  dmChannel,
  mentions,
  parseOr,
  SyncMsgSchema,
  type Ev,
} from '../src';
import { eventClock, northwind } from './util';

const WS = 'K7QX2MPD';
const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());
const { ev, later } = eventClock(WS);

const base = (): Ev[] => northwind(ev, A, B);

describe('identity', () => {
  it('derives the same key from the same phrase', () => {
    const p = newRecoveryPhrase();
    expect(p.split(' ')).toHaveLength(12);
    expect(isValidPhrase(p)).toBe(true);
    expect(keyFromPhrase(p)).toEqual(keyFromPhrase('  ' + p.toUpperCase() + ' '));
  });
  it('signs and verifies', () => {
    const s = sign(A.sec, 'hi');
    expect(verify(A.pub, 'hi', s)).toBe(true);
    expect(verify(B.pub, 'hi', s)).toBe(false);
    expect(fingerprint(A.pub)).toMatch(/^[0-9A-F]{4}…[0-9A-F]{4}$/);
  });
});

describe('events', () => {
  it('stamps events from one device in strictly increasing order', () => {
    const ts = Array.from({ length: 50 }, () => makeEvent(A, { ws: WS, t: 'msg', b: {} }).ts);
    expect(ts.every((t, i) => i === 0 || t > (ts[i - 1] ?? Number.POSITIVE_INFINITY))).toBe(true);
  });

  it('rejects tampered events', () => {
    const e = ev(A, 'msg', { text: 'hello' }, { ch: 'general' });
    expect(verifyEvent(e)).toBe(true);
    expect(verifyEvent({ ...e, b: { text: 'bye' } })).toBe(false);
    expect(verifyEvent({ ...e, a: B.pub })).toBe(false);
  });

  it('rejects structurally invalid events even when correctly signed', () => {
    for (const ts of [NaN, Infinity, 1.5, '5' as unknown as number]) expect(verifyEvent(makeEvent(A, { ws: WS, t: 'msg', b: {}, ts }))).toBe(false);
    expect(verifyEvent(makeEvent(A, { ws: WS, t: 'nope' as 'msg', b: {} }))).toBe(false);
    expect(verifyEvent(makeEvent(A, { ws: WS, t: 'msg', b: {}, ch: 5 as unknown as string }))).toBe(false);
    for (const x of [null, undefined, 'x', [], { id: 'a' }]) expect(verifyEvent(x)).toBe(false);
  });
});

describe('codes', () => {
  it('normalizes codes and links', () => {
    const c = newInviteCode();
    expect(normalizeCode(formatCode(c).toLowerCase())).toBe(c);
    expect(normalizeCode('https://x.github.io/yurt/#/w/' + c)).toBe(c);
    expect(normalizeCode('nope')).toBeNull();
    expect(dmChannel(B.pub, A.pub)).toBe(dmChannel(A.pub, B.pub));
  });
  it('finds mentions', () => {
    expect(mentions('hey @Scout and @bo-2, mail a@b.c')).toEqual(['scout', 'bo-2']);
  });
});

describe('reduce', () => {
  it('builds channels, messages and threads', () => {
    const evs = base();
    const m = ev(B, 'msg', { text: 'hi @ada' }, { ch: 'general' });
    const r = ev(A, 'msg', { text: 'hey', parent: m.id }, { ch: 'general' });
    const s = reduce(WS, [r, m, ...evs]);
    expect(s.name).toBe('Northwind');
    expect(s.channelMsgs.get('general')).toEqual([m.id]);
    expect(s.msgs.get(m.id)?.replies).toEqual([r.id]);
  });
  it('enforces the 15 minute edit window and authorship', () => {
    const evs = base();
    const m = ev(B, 'msg', { text: 'v1' }, { ch: 'general' });
    const byOther = ev(A, 'edit', { target: m.id, text: 'hacked' });
    const ok = ev(B, 'edit', { target: m.id, text: 'v2' });
    later(EDIT_WINDOW_MS);
    const late = ev(B, 'edit', { target: m.id, text: 'v3' });
    const s = reduce(WS, [...evs, m, byOther, ok, late]);
    expect(s.msgs.get(m.id)?.text).toBe('v2');
  });
  it('lets only the creator promote and never demotes the creator', () => {
    const evs = base();
    const s = reduce(WS, [...evs, ev(B, 'role', { target: C.pub, admin: true }), ev(A, 'role', { target: B.pub, admin: true }), ev(B, 'role', { target: A.pub, admin: false })]);
    expect([...s.admins].sort()).toEqual([A.pub, B.pub].sort());
  });
  it('drops every event from a banned key, backdated or not, until unbanned', () => {
    const evs = base();
    const before = ev(B, 'msg', { text: 'before' }, { ch: 'general' });
    const ban = ev(A, 'ban', { target: B.pub, on: true });
    const after = ev(B, 'msg', { text: 'after' }, { ch: 'general' });
    const backdated = makeEvent(B, { ws: WS, t: 'msg', ch: 'general', b: { text: 'old' }, ts: before.ts - 1 });
    const s = reduce(WS, [...evs, before, ban, after, backdated]);
    expect(s.bans.has(B.pub)).toBe(true);
    expect([before, after, backdated].some((m) => s.msgs.has(m.id))).toBe(false);
    expect(s.profiles.has(B.pub)).toBe(false);
    const u = reduce(WS, [...evs, before, ban, after, ev(A, 'ban', { target: B.pub, on: false })]);
    expect(u.bans.has(B.pub)).toBe(false);
    expect(u.msgs.has(before.id) && u.msgs.has(after.id)).toBe(true);
  });
  it('pins the creator on first join (TOFU)', () => {
    const fake = makeEvent(C, { ws: WS, t: 'ws.create', b: { name: 'Evil' }, ts: 1 });
    const s = reduce(WS, [fake, ...base()], { creator: A.pub });
    expect(s.name).toBe('Northwind');
  });
});

describe('sync', () => {
  it('finds exactly the missing events', () => {
    const all = base().concat([ev(A, 'msg', { text: 'x' }, { ch: 'general' }), ev(B, 'msg', { text: 'y' }, { ch: 'general' })]);
    const mine = all.slice(0, 3);
    const theirs = all.slice(1);
    const days = diffDays(summarize(mine), summarize(theirs));
    expect(days.length).toBeGreaterThan(0);
    const { want, give } = reconcile(mine, idsByDays(theirs, days), () => false);
    expect(new Set(want)).toEqual(new Set(all.slice(3).map((e) => e.id)));
    expect(give.map((e) => e.id)).toEqual([all[0]?.id]);
  });
  it('ignores hostile day keys and values from the other side', () => {
    const mine = base();
    // As they arrive: parsed by the wire schema first, then compared.
    const ids = parseOr(SyncMsgSchema, { k: 'ids', d: JSON.parse('{"__proto__":[1],"constructor":5,"x":["a"],"1":{"length":1}}') });
    expect(ids?.k === 'ids' && reconcile(mine, ids.d, () => false)).toEqual({ want: [], give: [] });
    const sum = parseOr(SyncMsgSchema, { k: 'sum', s: JSON.parse('{"__proto__":"1:1","toString":"x"}') });
    expect(sum?.k === 'sum' && diffDays(summarize(mine), sum.s)).toEqual(Object.keys(summarize(mine)));
  });
});

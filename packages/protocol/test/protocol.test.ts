import { describe, it, expect } from 'vitest';
import {
  newRecoveryPhrase, keyFromPhrase, isValidPhrase, sign, verify, fingerprint,
  makeEvent, verifyEvent, reduce, EDIT_WINDOW_MS, summarize, diffDays, idsByDays, reconcile,
  normalizeCode, formatCode, newInviteCode, dmChannel, mentions, type Ev,
} from '../src';

const WS = 'K7QX2MPD';
const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());
let clock = 1_700_000_000_000;
const ev = (kp = A, t: any, b: any, extra: any = {}) => makeEvent(kp, { ws: WS, t, b, ts: (clock += 1000), ...extra });

function base(): Ev[] {
  return [
    ev(A, 'ws.create', { name: 'Northwind' }),
    ev(A, 'ch.create', { id: 'general', name: 'general' }),
    ev(A, 'profile', { name: 'Ada', handle: 'ada' }),
    ev(B, 'profile', { name: 'Bo', handle: 'bo' }),
  ];
}

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
  it('rejects tampered events', () => {
    const e = ev(A, 'msg', { text: 'hello' }, { ch: 'general' });
    expect(verifyEvent(e)).toBe(true);
    expect(verifyEvent({ ...e, b: { text: 'bye' } })).toBe(false);
    expect(verifyEvent({ ...e, a: B.pub })).toBe(false);
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
    expect(s.msgs.get(m.id)!.replies).toEqual([r.id]);
  });
  it('enforces the 15 minute edit window and authorship', () => {
    const evs = base();
    const m = ev(B, 'msg', { text: 'v1' }, { ch: 'general' });
    const byOther = ev(A, 'edit', { target: m.id, text: 'hacked' });
    const ok = ev(B, 'edit', { target: m.id, text: 'v2' });
    clock += EDIT_WINDOW_MS;
    const late = ev(B, 'edit', { target: m.id, text: 'v3' });
    const s = reduce(WS, [...evs, m, byOther, ok, late]);
    expect(s.msgs.get(m.id)!.text).toBe('v2');
  });
  it('lets only the creator promote and never demotes the creator', () => {
    const evs = base();
    const s = reduce(WS, [...evs,
      ev(B, 'role', { target: C.pub, admin: true }),
      ev(A, 'role', { target: B.pub, admin: true }),
      ev(B, 'role', { target: A.pub, admin: false }),
    ]);
    expect([...s.admins].sort()).toEqual([A.pub, B.pub].sort());
  });
  it('drops events from banned keys after the ban', () => {
    const evs = base();
    const before = ev(B, 'msg', { text: 'before' }, { ch: 'general' });
    const ban = ev(A, 'ban', { target: B.pub, on: true });
    const after = ev(B, 'msg', { text: 'after' }, { ch: 'general' });
    const s = reduce(WS, [...evs, before, ban, after]);
    expect(s.bans.has(B.pub)).toBe(true);
    expect(s.msgs.has(before.id)).toBe(true);
    expect(s.msgs.has(after.id)).toBe(false);
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
    expect(give).toEqual([all[0].id]);
  });
});

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  newRecoveryPhrase,
  keyFromPhrase,
  reduce,
  noticeFor,
  inMyThread,
  levelOf,
  alerts,
  dmChannel,
  guestDmChannel,
  NOTIFY_LEVELS,
  type Ev,
  type Msg,
  type WsState,
} from '../src';
import { eventClock } from './util';

const WS = 'K7QX2MPD';
const ADA = keyFromPhrase(newRecoveryPhrase());
const BO = keyFromPhrase(newRecoveryPhrase());
const { ev } = eventClock(WS);
// Built first, so the workspace's events come before every test's (the clock only moves forward).
const BASE: Ev[] = [
  ev(ADA, 'ws.create', { name: 'W' }),
  ev(ADA, 'ch.create', { id: 'general', name: 'general' }),
  ev(ADA, 'profile', { name: 'Ada', handle: 'ada' }),
  ev(BO, 'profile', { name: 'Bo', handle: 'bo' }),
];
const state = (evs: Ev[]) => reduce(WS, [...BASE, ...evs], { creator: ADA.pub });

const msg = (s: WsState, e: Ev): Msg => {
  const m = s.msgs.get(e.id);
  if (!m) throw new Error('message not in state');
  return m;
};

describe('what notifies me', () => {
  const dm = dmChannel(ADA.pub, BO.pub);

  it('a DM, a mention or an agent asking for approval; never my own or deleted ones', () => {
    const mention = ev(BO, 'msg', { text: 'hey @Ada look' }, { ch: 'general' });
    const plain = ev(BO, 'msg', { text: 'hello all' }, { ch: 'general' });
    const direct = ev(BO, 'msg', { text: 'psst' }, { ch: dm, to: ADA.pub });
    const mine = ev(ADA, 'msg', { text: 'me @ada' }, { ch: 'general' });
    const gone = ev(BO, 'msg', { text: '@ada oops' }, { ch: 'general' });
    const adm = 'adm:' + ADA.pub + ':scout';
    const ask = ev(ADA, 'msg', { text: 'ok?', approval: { req: 'r', title: 'edit notes.md', options: [] } }, { ch: adm, to: ADA.pub, ag: 'scout' });
    const s = state([mention, plain, direct, mine, gone, ev(BO, 'del', { target: gone.id }), ask]);
    expect(noticeFor(msg(s, mention), s, ADA.pub)).toEqual({ title: 'Bo in #general', body: 'hey @Ada look', ch: 'general' });
    expect(noticeFor(msg(s, direct), s, ADA.pub)).toEqual({ title: 'Bo', body: 'psst', ch: dm });
    expect(noticeFor(msg(s, ask), s, ADA.pub)).toEqual({ title: 'Agent needs you', body: 'edit notes.md', ch: adm });
    expect(noticeFor(msg(s, plain), s, ADA.pub)).toBeNull();
    expect(noticeFor(msg(s, mine), s, ADA.pub)).toBeNull();
    expect(noticeFor(msg(s, gone), s, ADA.pub)).toBeNull();
  });

  it('names agents and strangers, and needs a handle to be mentioned', () => {
    const stranger = keyFromPhrase(newRecoveryPhrase());
    const gdm = guestDmChannel(stranger.pub, ADA.pub, 'scout');
    const fromStranger = ev(stranger, 'msg', { text: 'hi agent' }, { ch: gdm, to: ADA.pub });
    const agentAgent = ev(ADA, 'agent', { id: 'scout', name: 'Scout', handle: 'scout', runtime: 'copilot', replyIn: 'thread' });
    const byAgent = ev(ADA, 'msg', { text: 'done' }, { ch: 'adm:' + ADA.pub + ':scout', to: ADA.pub, ag: 'scout' });
    const s = state([fromStranger, agentAgent, byAgent]);
    expect(noticeFor(msg(s, fromStranger), s, ADA.pub)?.title).toBe('Someone');
    expect(noticeFor(msg(s, byAgent), s, ADA.pub)?.title).toBe('Scout');
    // Bo's view without a profile of his own: an @mention can't be about him.
    const noProfile = reduce(
      WS,
      [BASE[0], BASE[1], ev(ADA, 'msg', { text: '@bo' }, { ch: 'general' })].filter((e) => !!e),
      { creator: ADA.pub },
    );
    const [only] = noProfile.msgs.values();
    expect(only && noticeFor(only, noProfile, BO.pub)).toBeNull();
  });

  it('falls back to the channel id for a message whose channel it does not know', () => {
    const s = state([]);
    const m: Msg = { id: 'x', ch: 'elsewhere', a: BO.pub, ts: 1, text: '@ada', files: [], edited: false, deleted: false, reactions: {}, replies: [] };
    expect(noticeFor(m, s, ADA.pub)?.title).toBe('Bo in #elsewhere');
  });
});

describe('alert levels', () => {
  const dm = dmChannel(ADA.pub, BO.pub);
  const adm = 'adm:' + ADA.pub + ':scout';
  const level = (ch: string, l: string, extra: { to?: string; ts?: number } = { to: ADA.pub }) => ev(ADA, 'notify', { ch, level: l }, extra);

  it('default to every message in private conversations and to mentions in channels', () => {
    const s = state([]);
    expect(levelOf(s, ADA.pub, 'general')).toBe('mentions');
    expect([dm, adm, guestDmChannel(BO.pub, ADA.pub, 'scout')].map((ch) => levelOf(s, ADA.pub, ch))).toEqual(['all', 'all', 'all']);
  });

  it('count only addressed to myself and well formed; the newest wins, per conversation and per person', () => {
    const s = state([
      level('general', 'all'),
      level('general', 'none'),
      level(dm, 'mentions'),
      level('general', 'all', {}), // public: would tell everyone
      level('random', 'loud'),
      ev(ADA, 'notify', { level: 'none' }, { to: ADA.pub }),
      ev(BO, 'notify', { ch: 'general', level: 'none' }, { to: ADA.pub }),
      ev(BO, 'notify', { ch: 'general', level: 'all' }, { to: BO.pub }),
    ]);
    expect(levelOf(s, ADA.pub, 'general')).toBe('none');
    expect(levelOf(s, ADA.pub, dm)).toBe('mentions');
    expect(levelOf(s, ADA.pub, 'random')).toBe('mentions');
    expect(levelOf(s, BO.pub, 'general')).toBe('all');
  });

  it('settle on the newest setting whatever order the events arrive in, ties by id', () => {
    const settings = fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.constantFrom(...NOTIFY_LEVELS)), { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(settings, fc.boolean(), (sets, reversed) => {
        const evs = sets.map(([dt, l]) => ({ e: level('general', l, { to: ADA.pub, ts: 1_600_000_000_000 + dt }), l }));
        const newest = [...evs].sort((a, b) => a.e.ts - b.e.ts || (a.e.id < b.e.id ? -1 : 1)).at(-1);
        const sent = evs.map((x) => x.e);
        expect(levelOf(state(reversed ? sent.reverse() : sent), ADA.pub, 'general')).toBe(newest?.l);
      }),
      { seed: 20_261_002, numRuns: 100 },
    );
  });

  it('decide what notifies: everything, mentions and approvals, or nothing', () => {
    const plain = ev(BO, 'msg', { text: 'hello all' }, { ch: 'general' });
    const mention = ev(BO, 'msg', { text: 'hey @ada' }, { ch: 'general' });
    const direct = ev(BO, 'msg', { text: 'psst' }, { ch: dm, to: ADA.pub });
    const ask = ev(ADA, 'msg', { text: 'ok?', approval: { req: 'r', title: 'edit', options: [] } }, { ch: adm, to: ADA.pub, ag: 'scout' });
    const base = [plain, mention, direct, ask];
    const body = (s: WsState, e: Ev) => {
      const m = s.msgs.get(e.id);
      if (!m) throw new Error('message not in state');
      return noticeFor(m, s, ADA.pub)?.body ?? null;
    };
    expect(body(state([level('general', 'all'), ...base]), plain)).toBe('hello all');
    const quiet = state([level('general', 'none'), level(dm, 'mentions'), level(adm, 'none'), ...base]);
    expect(base.map((e) => body(quiet, e))).toEqual([null, null, null, null]);
    const mentionsOnly = state([level(adm, 'mentions'), ...base]);
    expect([body(mentionsOnly, ask), body(mentionsOnly, mention), body(mentionsOnly, plain)]).toEqual(['edit', 'hey @ada', null]);
    const m = mentionsOnly.msgs.get(mention.id);
    if (!m) throw new Error('message not in state');
    expect(alerts(m, ADA.pub, 'ADA', 'mentions')).toBe(true);
    expect(alerts(m, ADA.pub, undefined, 'mentions')).toBe(false);
  });

  it('a reply in a thread I started or replied to; not my agent’s thread, nor one I only read', () => {
    const CY = keyFromPhrase(newRecoveryPhrase());
    const mineTop = ev(ADA, 'msg', { text: 'plan?' }, { ch: 'general' });
    const reply = ev(BO, 'msg', { text: 'yes', parent: mineTop.id }, { ch: 'general' });
    const theirs = ev(BO, 'msg', { text: 'lunch?' }, { ch: 'general' });
    const early = ev(CY, 'msg', { text: 'sure', parent: theirs.id }, { ch: 'general' });
    const joined = ev(ADA, 'msg', { text: 'me too', parent: theirs.id }, { ch: 'general' });
    const later = ev(BO, 'msg', { text: 'noon', parent: theirs.id }, { ch: 'general' });
    const other = ev(BO, 'msg', { text: 'standup' }, { ch: 'general' });
    const byAgent = ev(ADA, 'msg', { text: 'summary', parent: other.id }, { ch: 'general', ag: 'scout' });
    const unseen = ev(CY, 'msg', { text: 'ok', parent: other.id }, { ch: 'general' });
    const s = state([mineTop, reply, theirs, early, joined, later, other, byAgent, unseen]);
    expect(noticeFor(msg(s, reply), s, ADA.pub)).toEqual({ title: 'Bo in #general', body: 'yes', ch: 'general' });
    expect(inMyThread(msg(s, later), s, ADA.pub)).toBe(true);
    // Replies before I joined are in my thread too: I'm in it now.
    expect(inMyThread(msg(s, early), s, ADA.pub)).toBe(true);
    expect(inMyThread(msg(s, joined), s, BO.pub)).toBe(true);
    expect(inMyThread(msg(s, joined), s, CY.pub)).toBe(true);
    expect(inMyThread(msg(s, unseen), s, ADA.pub)).toBe(false);
    expect(noticeFor(msg(s, unseen), s, ADA.pub)).toBeNull();
    expect(inMyThread(msg(s, theirs), s, BO.pub)).toBe(false);
    // A thread whose reply list names a message the state lacks.
    const parent: Msg = { ...msg(s, other), replies: ['missing'] };
    const m: Msg = { ...msg(s, unseen), parent: parent.id };
    expect(inMyThread(m, { ...s, msgs: new Map([[parent.id, parent]]) }, ADA.pub)).toBe(false);
    expect(inMyThread({ ...m, parent: 'gone' }, s, ADA.pub)).toBe(false);
  });
});

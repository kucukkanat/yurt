import { describe, it, expect } from 'vitest';
import { newRecoveryPhrase, keyFromPhrase, reduce, noticeFor, dmChannel, guestDmChannel, type Ev, type Msg, type WsState } from '../src';
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

describe('what notifies me', () => {
  const msg = (s: WsState, e: Ev): Msg => {
    const m = s.msgs.get(e.id);
    if (!m) throw new Error('message not in state');
    return m;
  };
  const dm = dmChannel(ADA.pub, BO.pub);

  it('a DM, a mention or an agent asking for approval; never my own, muted or deleted ones', () => {
    const mention = ev(BO, 'msg', { text: 'hey @Ada look' }, { ch: 'general' });
    const plain = ev(BO, 'msg', { text: 'hello all' }, { ch: 'general' });
    const direct = ev(BO, 'msg', { text: 'psst' }, { ch: dm, to: ADA.pub });
    const mine = ev(ADA, 'msg', { text: 'me @ada' }, { ch: 'general' });
    const gone = ev(BO, 'msg', { text: '@ada oops' }, { ch: 'general' });
    const adm = 'adm:' + ADA.pub + ':scout';
    const ask = ev(ADA, 'msg', { text: 'ok?', approval: { req: 'r', title: 'edit notes.md', options: [] } }, { ch: adm, to: ADA.pub, ag: 'scout' });
    const s = state([mention, plain, direct, mine, gone, ev(BO, 'del', { target: gone.id }), ask]);
    expect(noticeFor(msg(s, mention), s, ADA.pub, [])).toEqual({ title: 'Bo in #general', body: 'hey @Ada look', ch: 'general' });
    expect(noticeFor(msg(s, direct), s, ADA.pub, [])).toEqual({ title: 'Bo', body: 'psst', ch: dm });
    expect(noticeFor(msg(s, ask), s, ADA.pub, [])).toEqual({ title: 'Agent needs you', body: 'edit notes.md', ch: adm });
    expect(noticeFor(msg(s, plain), s, ADA.pub, [])).toBeNull();
    expect(noticeFor(msg(s, mine), s, ADA.pub, [])).toBeNull();
    expect(noticeFor(msg(s, gone), s, ADA.pub, [])).toBeNull();
    expect(noticeFor(msg(s, mention), s, ADA.pub, ['general'])).toBeNull();
  });

  it('names agents and strangers, and needs a handle to be mentioned', () => {
    const stranger = keyFromPhrase(newRecoveryPhrase());
    const gdm = guestDmChannel(stranger.pub, ADA.pub, 'scout');
    const fromStranger = ev(stranger, 'msg', { text: 'hi agent' }, { ch: gdm, to: ADA.pub });
    const agentAgent = ev(ADA, 'agent', { id: 'scout', name: 'Scout', handle: 'scout', runtime: 'copilot', replyIn: 'thread' });
    const byAgent = ev(ADA, 'msg', { text: 'done' }, { ch: 'adm:' + ADA.pub + ':scout', to: ADA.pub, ag: 'scout' });
    const s = state([fromStranger, agentAgent, byAgent]);
    expect(noticeFor(msg(s, fromStranger), s, ADA.pub, [])?.title).toBe('Someone');
    expect(noticeFor(msg(s, byAgent), s, ADA.pub, [])?.title).toBe('Scout');
    // Bo's view without a profile of his own: an @mention can't be about him.
    const noProfile = reduce(
      WS,
      [BASE[0], BASE[1], ev(ADA, 'msg', { text: '@bo' }, { ch: 'general' })].filter((e) => !!e),
      { creator: ADA.pub },
    );
    const [only] = noProfile.msgs.values();
    expect(only && noticeFor(only, noProfile, BO.pub, [])).toBeNull();
  });

  it('falls back to the channel id for a message whose channel it does not know', () => {
    const s = state([]);
    const m: Msg = { id: 'x', ch: 'elsewhere', a: BO.pub, ts: 1, text: '@ada', files: [], edited: false, deleted: false, reactions: {}, replies: [] };
    expect(noticeFor(m, s, ADA.pub, [])?.title).toBe('Bo in #elsewhere');
  });
});

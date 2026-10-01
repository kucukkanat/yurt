import { describe, it, expect } from 'vitest';
import { newRecoveryPhrase, keyFromPhrase, makeEvent, reduce, agentKey, agentPrefs, guestDmChannel, parseGuestDm, isPrivateChannel, type Ev, type EvType } from '../src';

const WS = 'K7QX2MPD';
const OWNER = keyFromPhrase(newRecoveryPhrase());
const MEMBER = keyFromPhrase(newRecoveryPhrase());
const OTHER = keyFromPhrase(newRecoveryPhrase());
let clock = 1_700_000_000_000;
const ev = (kp: typeof OWNER, t: EvType, b: unknown, extra: { ch?: string; to?: string; ag?: string } = {}) =>
  makeEvent(kp, { ws: WS, t, b, ts: (clock += 1000), ...extra });
const agentBody = { id: 'harvey', name: 'Harvey', handle: 'harvey', runtime: 'copilot', replyIn: 'thread' };
const base = (): Ev[] => [ev(OWNER, 'ws.create', { name: 'W' }), ev(OWNER, 'ch.create', { id: 'general', name: 'general' })];
const state = (evs: Ev[]) => reduce(WS, evs, { creator: OWNER.pub });

describe('agent settings', () => {
  it('keeps triggers, placement and discoverability', () => {
    const s = state([...base(), ev(OWNER, 'agent', { ...agentBody, respondTo: { mentions: false, replies: true }, postIn: { thread: true, channel: true }, discoverable: true })]);
    const a = s.agents.get(agentKey(OWNER.pub, 'harvey'));
    expect(a && agentPrefs(a)).toEqual({ respondTo: { mentions: false, replies: true }, postIn: { thread: true, channel: true }, discoverable: true });
  });

  it('fills in older agents from replyIn, and ignores malformed new fields', () => {
    for (const [replyIn, postIn] of [['thread', { thread: true, channel: false }], ['channel', { thread: false, channel: true }]] as const) {
      const s = state([...base(), ev(OWNER, 'agent', { ...agentBody, replyIn, respondTo: { mentions: 'yes' }, postIn: [1], discoverable: 'true' })]);
      const a = s.agents.get(agentKey(OWNER.pub, 'harvey'));
      expect(a?.respondTo).toBeUndefined();
      expect(a && agentPrefs(a)).toEqual({ respondTo: { mentions: true, replies: false }, postIn, discoverable: false });
    }
  });

  it('never ends up with nowhere to post', () => {
    expect(agentPrefs({ replyIn: 'channel', postIn: { thread: false, channel: false } }).postIn).toEqual({ thread: false, channel: true });
  });
});

describe('guest DMs with someone else’s agent', () => {
  const ch = guestDmChannel(MEMBER.pub, OWNER.pub, 'harvey');
  const texts = (evs: Ev[]) => (state([...base(), ...evs]).channelMsgs.get(ch) ?? []).length;

  it('are private and parse back into their parties', () => {
    expect(isPrivateChannel(ch)).toBe(true);
    expect(parseGuestDm(ch)).toEqual({ member: MEMBER.pub, owner: OWNER.pub, agentId: 'harvey' });
    expect(parseGuestDm('gdm:only-one')).toBeNull();
  });

  it('carry the member’s messages to the owner and the agent’s answers back', () => {
    expect(texts([ev(MEMBER, 'msg', { text: 'hi' }, { ch, to: OWNER.pub })])).toBe(1);
    expect(texts([ev(OWNER, 'msg', { text: 'hello' }, { ch, to: MEMBER.pub, ag: 'harvey' })])).toBe(1);
  });

  it('refuse everyone and everything else', () => {
    const bad = [
      ev(OTHER, 'msg', { text: 'x' }, { ch, to: OWNER.pub }), // a third member
      ev(MEMBER, 'msg', { text: 'x' }, { ch }), // not addressed
      ev(MEMBER, 'msg', { text: 'x' }, { ch, to: OWNER.pub, ag: 'harvey' }), // a member can't speak as the agent
      ev(OWNER, 'msg', { text: 'x' }, { ch, to: MEMBER.pub }), // the owner only speaks here as the agent
      ev(OWNER, 'msg', { text: 'x' }, { ch, to: MEMBER.pub, ag: 'other-agent' }),
      ev(OWNER, 'msg', { text: 'x' }, { ch: guestDmChannel(OWNER.pub, OWNER.pub, 'harvey'), to: OWNER.pub }), // member == owner
    ];
    expect(texts(bad)).toBe(0);
    expect(state([...base(), ...bad]).msgs.size).toBe(0);
  });

  it('never carry approval prompts', () => {
    const m = ev(OWNER, 'msg', { text: 'ok?', approval: { req: 'r1', title: 't', options: [{ id: 'y', label: 'Yes', kind: 'allow' }] } }, { ch, to: MEMBER.pub, ag: 'harvey' });
    expect(state([...base(), m]).msgs.get(m.id)?.approval).toBeUndefined();
  });
});

describe('thread replies also sent to the channel', () => {
  it('appear in the thread and in the channel, once', () => {
    const b0 = base(); // the channel must exist before the messages (events apply in time order)
    const root = ev(MEMBER, 'msg', { text: 'question' }, { ch: 'general' });
    const both = ev(OWNER, 'msg', { text: 'answer', parent: root.id, alsoInChannel: true }, { ch: 'general', ag: 'harvey' });
    const plain = ev(OWNER, 'msg', { text: 'follow-up', parent: root.id }, { ch: 'general', ag: 'harvey' });
    const s = state([...b0, root, both, plain]);
    expect(s.msgs.get(root.id)?.replies).toEqual([both.id, plain.id]);
    expect(s.channelMsgs.get('general')).toEqual([root.id, both.id]);
    expect(s.msgs.get(both.id)?.alsoInChannel).toBe(true);
    expect(s.msgs.get(plain.id)?.alsoInChannel).toBeUndefined();
  });

  it('only counts for actual thread replies', () => {
    const b0 = base();
    const top = ev(MEMBER, 'msg', { text: 'top', alsoInChannel: true }, { ch: 'general' });
    const s = state([...b0, top]);
    expect(s.msgs.get(top.id)?.alsoInChannel).toBeUndefined();
    expect(s.channelMsgs.get('general')).toEqual([top.id]);
  });
});

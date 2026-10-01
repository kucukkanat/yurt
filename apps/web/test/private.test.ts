import { describe, it, expect } from 'vitest';
import { keyFromPhrase, newRecoveryPhrase, makeEvent, reduce, agentPrefs, dmChannel, agentDmChannel, guestDmChannel } from '@yurt/protocol';
import { addressed, guestDmTitle, isDirect, prefsLine, privateTarget } from '../src/lib/private';
import { fc } from './fuzz';

const OWNER = keyFromPhrase(newRecoveryPhrase());
const MEMBER = keyFromPhrase(newRecoveryPhrase());
const WS = 'K7QX2MPD';
const ch = guestDmChannel(MEMBER.pub, OWNER.pub, 'harvey');

describe('private channels', () => {
  it('address the other side, never yourself, so reactions reach them', () => {
    expect(privateTarget(dmChannel(OWNER.pub, MEMBER.pub), MEMBER.pub)).toBe(OWNER.pub);
    expect(privateTarget(dmChannel(MEMBER.pub, MEMBER.pub), MEMBER.pub)).toBe(MEMBER.pub); // notes to self
    expect(privateTarget(agentDmChannel(OWNER.pub, 'harvey'), OWNER.pub)).toBe(OWNER.pub);
    expect(privateTarget(ch, MEMBER.pub)).toBe(OWNER.pub);
    expect(privateTarget('general', MEMBER.pub)).toBeUndefined();
  });

  it('count DMs and guest DMs as direct, not the owner’s agent chat', () => {
    expect([dmChannel(OWNER.pub, MEMBER.pub), ch, agentDmChannel(OWNER.pub, 'harvey'), 'general'].map(isDirect)).toEqual([true, true, false, false]);
  });

  it('title a guest DM for the member and for the owner', () => {
    let ts = 1_700_000_000_000;
    const s = reduce(
      WS,
      [
        makeEvent(OWNER, { ws: WS, t: 'ws.create', b: { name: 'W' }, ts: ++ts }),
        makeEvent(OWNER, { ws: WS, t: 'profile', b: { name: 'Ada', handle: 'ada' }, ts: ++ts }),
        makeEvent(MEMBER, { ws: WS, t: 'profile', b: { name: 'Bea', handle: 'bea' }, ts: ++ts }),
        makeEvent(OWNER, { ws: WS, t: 'agent', b: { id: 'harvey', name: 'Harvey', handle: 'harvey', runtime: 'copilot', replyIn: 'thread' }, ts: ++ts }),
      ],
      { creator: OWNER.pub },
    );
    expect(guestDmTitle(s, ch, MEMBER.pub)).toBe('Harvey (Ada’s agent)');
    expect(guestDmTitle(s, ch, OWNER.pub)).toBe('Bea ↔ Harvey');
    expect(guestDmTitle(undefined, ch, MEMBER.pub)).toMatch(/^harvey \(.+’s agent\)$/);
    expect(guestDmTitle(s, 'general', MEMBER.pub)).toBeNull();
  });
});

describe('prefsLine', () => {
  it('summarizes when an agent answers and where it posts', () => {
    expect(prefsLine(agentPrefs({ replyIn: 'thread' }))).toBe('answers @mentions · posts in thread');
    expect(prefsLine({ respondTo: { mentions: true, replies: true }, postIn: { thread: true, channel: true }, discoverable: true })).toBe(
      'answers @mentions and replies · posts in thread + channel · discoverable',
    );
    expect(prefsLine({ respondTo: { mentions: false, replies: false }, postIn: { thread: false, channel: true }, discoverable: false })).toBe(
      'answers only private chats · posts in channel',
    );
  });
});

describe('private channels, for any keys and channel ids', () => {
  const hex = fc.stringMatching(/^[0-9a-f]{64}$/);

  it('address a DM to the other person, never to me unless it’s my notes', () => {
    fc.assert(
      fc.property(hex, hex, (me, other) => {
        const to = privateTarget(dmChannel(me, other), me);
        expect(to).toBe(other);
        expect(addressed(dmChannel(me, other), me)).toEqual({ to: other });
      }),
    );
  });

  it('address a guest DM to the agent’s owner, from either side', () => {
    fc.assert(
      fc.property(hex, hex, fc.stringMatching(/^[a-z0-9-]{1,24}$/), (member, owner, agent) => {
        expect(privateTarget(guestDmChannel(member, owner, agent), member)).toBe(owner);
      }),
    );
  });

  it('leave public channels unaddressed, and never throw', () => {
    fc.assert(
      fc.property(fc.string(), hex, (ch, me) => {
        const to = privateTarget(ch, me);
        if (!ch.startsWith('dm:') && !ch.startsWith('adm:') && !ch.startsWith('gdm:')) expect(to).toBeUndefined();
        expect(addressed(ch, me)).toEqual(to ? { to } : {});
        void isDirect(ch);
        void guestDmTitle(undefined, ch, me);
      }),
    );
  });

  it('summarize any agent settings in one line', () => {
    const b = fc.boolean();
    fc.assert(
      fc.property(b, b, b, b, b, (mentions, replies, thread, channel, discoverable) => {
        const line = prefsLine({ respondTo: { mentions, replies }, postIn: { thread, channel }, discoverable });
        expect(line.startsWith('answers ')).toBe(true);
        expect(line.endsWith(' · discoverable')).toBe(discoverable);
      }),
    );
  });
});

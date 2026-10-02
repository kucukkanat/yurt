import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderHook } from 'vitest-browser-react';
import { agentDmChannel, agentKey, dmChannel, fingerprint, guestDmChannel, keyFromPhrase, newNostrTransport, newRecoveryPhrase, type WsState } from '@yurt/protocol';
import { CALM } from '../../../src/lib/favicon';
import { getPeer } from '../../../src/lib/net';
import { authorKey, channelTitle, faviconStateOf, needIdentity, othersOnline, personFor, roster, unread, useCurrent, useMedia } from '../../../src/model';
import { useApp } from '../../../src/store';
import { openRemote, resetDb, until } from './harness';
import type { RemoteApi } from './remote';

// The model's views of real workspace state: profiles, roles, presence and agents from other members' real peers.
const app = () => useApp.getState();
const phrase = newRecoveryPhrase();
const me = keyFromPhrase(phrase);
let code = '';
let remote: RemoteApi;
let olu: ReturnType<RemoteApi['makePeer']>;
let laptop: ReturnType<RemoteApi['makePeer']>; // my other device, running my agent like the bridge does
let bea: ReturnType<RemoteApi['makePeer']>;
const state = (): WsState => {
  const s = app().states[code];
  if (!s) throw new Error('no state');
  return s;
};

beforeAll(async () => {
  await resetDb();
  await app().init();
  await page.viewport(1200, 800);
  await app().createIdentity(phrase, 'Ada', 'ada');
  code = await app().createWorkspace('Model', { relays: [inject('relayUrl')], blossom: [] });
  const rec = app().workspaces.find((w) => w.code === code);
  if (!rec) throw new Error('no record');
  remote = await openRemote();
  olu = remote.makePeer({ code, transport: rec.transport, creator: me.pub });
  await olu.peer.start();
  olu.peer.publish({ t: 'profile', b: { name: 'Olu', handle: 'olu' } });
  const other = await openRemote();
  laptop = other.makePeer({ code, transport: rec.transport, creator: me.pub, kp: me });
  await laptop.peer.start();
  laptop.peer.publish({ t: 'agent', b: { id: 'scout', name: 'Scout', handle: 'scout', runtime: 'copilot', replyIn: 'thread', discoverable: true } });
  laptop.peer.setPresence({ bridge: true, agents: { scout: { working: 'general' }, idle: { working: null } } });
  olu.peer.setPresence({ st: 'away' });
  olu.peer.publish({ t: 'agent', b: { id: 'mute', name: 'Mute', handle: 'mute', runtime: 'codex', replyIn: 'channel' } }); // no bridge running
  bea = (await openRemote()).makePeer({ code, transport: rec.transport, creator: me.pub });
  await bea.peer.start();
  bea.peer.publish({ t: 'profile', b: { name: 'Bea', handle: 'bea' } });
  await until(
    () =>
      !!state().profiles.get(olu.kp.pub) &&
      !!state().profiles.get(bea.kp.pub) &&
      !!state().agents.get(agentKey(me.pub, 'scout')) &&
      !!state().agents.get(agentKey(olu.kp.pub, 'mute')),
    'everyone to sync',
  );
  await until(() => [...(getPeer(code)?.presence.values() ?? [])].some((p) => p.pub === bea.kp.pub && p.st === 'online'), 'Bea’s presence');
  await until(() => [...(getPeer(code)?.presence.values() ?? [])].some((p) => p.pub === olu.kp.pub && p.st === 'away'), 'Olu’s presence');
  await until(() => [...(getPeer(code)?.presence.values() ?? [])].some((p) => p.bridge), 'my bridge’s presence');
});

afterAll(() => {
  olu.peer.leave();
  laptop.peer.leave();
  bea.peer.leave();
  for (const w of app().workspaces) getPeer(w.code)?.leave();
});

describe('people and agents', () => {
  it('describes humans: me, others, roles and presence', () => {
    const peer = getPeer(code);
    expect(personFor(state(), peer, me.pub, me.pub)).toMatchObject({ name: 'Ada', handle: 'ada', kind: 'human', self: true, presence: 'online', creator: true, admin: true });
    expect(personFor(state(), peer, olu.kp.pub, me.pub)).toMatchObject({ name: 'Olu', self: false, presence: 'away', creator: false, banned: false });
    const stranger = keyFromPhrase(newRecoveryPhrase()).pub;
    expect(personFor(undefined, undefined, stranger, me.pub)).toMatchObject({ name: fingerprint(stranger), handle: stranger.slice(0, 8), presence: 'offline' });
  });

  it('describes agents: settings, owner and whether their bridge is up', () => {
    const peer = getPeer(code);
    expect(personFor(state(), peer, agentKey(me.pub, 'scout'), me.pub)).toMatchObject({
      kind: 'agent',
      name: 'Scout',
      runtime: 'copilot',
      owner: { name: 'You', self: true },
      presence: 'online',
      working: true,
      prefs: { discoverable: true },
    });
    expect(personFor(state(), peer, agentKey(me.pub, 'idle'), me.pub)).toMatchObject({ name: 'idle', presence: 'online', working: false, prefs: undefined });
    expect(personFor(state(), peer, agentKey(olu.kp.pub, 'x'), me.pub)).toMatchObject({ owner: { name: 'Olu', self: false }, presence: 'offline' });
    expect(personFor(state(), undefined, agentKey('nobody', 'x'), me.pub)).toMatchObject({ owner: { name: 'Someone' } });
  });

  it('counts other people online, not my tabs or my bridge', () => {
    expect(othersOnline(getPeer(code), me.pub)).toBe(2);
    expect(personFor(state(), getPeer(code), bea.kp.pub, me.pub).presence).toBe('online');
    expect(othersOnline(undefined, me.pub)).toBe(0);
  });

  it('lists everyone: people before agents, online first, then by name', () => {
    const r = roster(state(), getPeer(code), me.pub).map((p) => p.name);
    expect(r).toEqual(['Ada', 'Bea', 'Olu', 'Scout', 'Mute']);
    expect(roster(undefined, undefined, me.pub)).toEqual([]);
    // Someone whose profile hasn't synced yet still sees themselves first among the offline.
    const newcomer = keyFromPhrase(newRecoveryPhrase()).pub;
    expect(roster(state(), getPeer(code), newcomer).map((p) => p.pub)).toContain(newcomer);
  });

  it('keys messages by author, agent or human', () => {
    expect(authorKey({ a: me.pub, ag: 'scout' })).toBe(agentKey(me.pub, 'scout'));
    expect(authorKey({ a: me.pub })).toBe(me.pub);
  });
});

describe('conversations', () => {
  it('names channels, DMs, agent chats and guest DMs', () => {
    const s = state();
    expect(channelTitle(s, 'general', me.pub)).toBe('general');
    expect(channelTitle(s, 'unknown-channel', me.pub)).toBe('unknown-channel');
    expect(channelTitle(s, dmChannel(me.pub, olu.kp.pub), me.pub)).toBe('Olu');
    expect(channelTitle(s, dmChannel(me.pub, me.pub), me.pub)).toBe('Ada');
    const stranger = keyFromPhrase(newRecoveryPhrase()).pub;
    expect(channelTitle(undefined, dmChannel(me.pub, stranger), me.pub)).toBe(fingerprint(stranger));
    expect(channelTitle(s, agentDmChannel(me.pub, 'scout'), me.pub)).toBe('Scout');
    expect(channelTitle(s, agentDmChannel(me.pub, 'gone'), me.pub)).toBe('gone');
    expect(channelTitle(s, 'adm:', me.pub)).toBe('');
    expect(channelTitle(s, 'adm:' + me.pub, me.pub)).toBe(''); // a hand-typed address missing the agent
    expect(channelTitle(s, guestDmChannel(olu.kp.pub, me.pub, 'scout'), me.pub)).toBe('Olu ↔ Scout');
  });

  it('counts unread messages and the ones for me', async () => {
    const dm = dmChannel(olu.kp.pub, me.pub);
    olu.peer.publish({ t: 'msg', ch: 'general', b: { text: 'hi all' } });
    olu.peer.publish({ t: 'msg', ch: 'general', b: { text: 'hey @ada' } });
    const gone = olu.peer.publish({ t: 'msg', ch: 'general', b: { text: 'oops' } });
    olu.peer.publish({ t: 'del', ch: 'general', b: { target: gone.id } });
    olu.peer.publish({ t: 'msg', ch: dm, to: me.pub, b: { text: 'psst' } });
    laptop.peer.publish({ t: 'msg', ch: agentDmChannel(me.pub, 'scout'), to: me.pub, ag: 'scout', b: { text: 'ok?', approval: { req: 'r1', title: 'edit', options: [] } } });
    laptop.peer.publish({ t: 'msg', ch: agentDmChannel(me.pub, 'scout'), to: me.pub, ag: 'scout', b: { text: 'done' } });
    app().publish(code, { t: 'msg', ch: 'general', b: { text: 'mine' } });
    await until(() => (state().channelMsgs.get(dm)?.length ?? 0) === 1 && (state().channelMsgs.get(agentDmChannel(me.pub, 'scout'))?.length ?? 0) === 2, 'the messages');
    await until(() => state().msgs.get(gone.id)?.deleted === true, 'the deletion');
    const rec = app().workspaces.find((w) => w.code === code);
    expect(unread(state(), undefined, 'general', me.pub, 'ada')).toEqual({ n: 2, m: 1 });
    expect(unread(state(), rec, dm, me.pub, 'ada')).toEqual({ n: 1, m: 1 });
    expect(unread(state(), rec, agentDmChannel(me.pub, 'scout'), me.pub, 'ada')).toEqual({ n: 2, m: 1 });
    expect(unread(state(), rec, 'nothing-here', me.pub, 'ada')).toEqual({ n: 0, m: 0 });
    app().markRead(code, 'general');
    const read = app().workspaces.find((w) => w.code === code);
    expect(unread(state(), read, 'general', me.pub, 'ada')).toEqual({ n: 0, m: 0 });
  });

  it('counts replies in threads I started or replied to, however old the thread, until the conversation is read', async () => {
    const mine = app().publish(code, { t: 'msg', ch: 'general', b: { text: 'my plan' } });
    const theirs = olu.peer.publish({ t: 'msg', ch: 'general', b: { text: 'their plan' } });
    const joined = olu.peer.publish({ t: 'msg', ch: 'general', b: { text: 'another' } });
    if (!mine) throw new Error('not published');
    app().publish(code, { t: 'msg', ch: 'general', b: { text: 'count me in', parent: joined.id } });
    await until(() => state().msgs.get(joined.id)?.replies.length === 1, 'my reply');
    app().markRead(code, 'general');
    // Replies from a later millisecond than the read mark: one in the same millisecond counts as read.
    const readAt = app().workspaces.find((w) => w.code === code)?.lastRead.general ?? 0;
    await until(() => Date.now() > readAt, 'the clock to move on');
    const reply = (parent: string, text: string, alsoInChannel?: boolean) =>
      bea.peer.publish({ t: 'msg', ch: 'general', b: { text, parent, ...(alsoInChannel ? { alsoInChannel } : {}) } });
    reply(mine.id, 'looks good');
    reply(joined.id, 'hey @ada');
    reply(mine.id, 'and here', true);
    reply(theirs.id, 'not my thread');
    await until(
      () => state().msgs.get(theirs.id)?.replies.length === 1 && state().msgs.get(mine.id)?.replies.length === 2 && state().msgs.get(joined.id)?.replies.length === 2,
      'the replies',
    );
    const rec = () => app().workspaces.find((w) => w.code === code);
    // The reply also sent to the channel counts once.
    expect(unread(state(), rec(), 'general', me.pub, 'ada')).toEqual({ n: 3, m: 1 });
    app().markRead(code, 'general');
    expect(unread(state(), rec(), 'general', me.pub, 'ada')).toEqual({ n: 0, m: 0 });
  });
});

describe('the tab icon’s state', () => {
  it('is calm without an identity', () => {
    expect(faviconStateOf({ ...app(), identity: null }, getPeer, true)).toEqual(CALM);
  });

  it('skips a workspace that hasn’t synced yet', () => {
    const s = app();
    const unsynced = { code: 'ZZZZZZZZ', name: 'Joining', transport: newNostrTransport(), creator: null, lastRead: {}, muted: [] };
    expect(faviconStateOf({ ...s, workspaces: [...s.workspaces, unsynced] }, getPeer, false).mentions).toBe(faviconStateOf(s, getPeer, false).mentions);
  });

  it('counts unread mentions across workspaces, skipping muted and on-screen conversations', () => {
    const dm = dmChannel(olu.kp.pub, me.pub);
    const s = app();
    const all = faviconStateOf(s, getPeer, false);
    expect(all.mentions).toBeGreaterThanOrEqual(2);
    expect(all.unread).toBe(true);
    useApp.setState({ route: { code, ch: dm } });
    expect(faviconStateOf(app(), getPeer, true).mentions).toBe(all.mentions - 1); // the DM is on screen
    app().toggleMute(code, agentDmChannel(me.pub, 'scout'));
    expect(faviconStateOf(app(), getPeer, false).mentions).toBe(all.mentions - 1);
    app().toggleMute(code, agentDmChannel(me.pub, 'scout'));
    useApp.setState({ route: {} });
  });

  it('shows calls nearby and mine, and being offline', async () => {
    olu.peer.setHuddle({ ch: 'general', mic: true, cam: false, screen: false }); // Olu has calls off: no room, no news
    expect(faviconStateOf(app(), getPeer, false).callNearby).toBe(false);
    useApp.setState({ huddle: { ...app().huddle, code, ch: 'general' } });
    expect(faviconStateOf(app(), getPeer, false).inCall).toBe(true);
    useApp.setState({ huddle: { ...app().huddle, code: null, ch: null } });
    useApp.setState({ online: false });
    expect(faviconStateOf(app(), getPeer, false).offline).toBe(true);
    useApp.setState({ online: true, route: { code } });
    expect(faviconStateOf(app(), getPeer, false).offline).toBe(false);
    expect(faviconStateOf(app(), () => undefined, false)).toMatchObject({ offline: false, callNearby: false });
    useApp.setState({ route: {} });
  });
});

describe('hooks', () => {
  it('give the current workspace, and refuse to run before onboarding', async () => {
    useApp.setState({ route: { code, ch: 'general' } });
    const { result } = await renderHook(() => useCurrent());
    expect(result.current).toMatchObject({ route: { code, ch: 'general' }, identity: { pub: me.pub } });
    expect(result.current.peer).toBe(getPeer(code));
    expect(() => needIdentity(null)).toThrow('needs an identity');
    expect(needIdentity(app().identity)).toBe(app().identity);
    useApp.setState({ route: {} });
    const home = await renderHook(() => useCurrent());
    expect(home.result.current.state).toBeUndefined();
  });

  it('follow a media query as the window changes', async () => {
    const { result, unmount } = await renderHook(() => useMedia('(max-width: 600px)'));
    expect(result.current).toBe(false);
    await page.viewport(500, 800);
    await until(() => result.current === true, 'the narrow layout');
    await page.viewport(1200, 800);
    await until(() => result.current === false, 'the wide layout');
    unmount();
  });
});

describe('a call nearby', () => {
  it('shows when someone is in a call I’m not in, in a workspace with calls', async () => {
    await app().updateSettings({ webrtc: true });
    const rec = app().workspaces.find((w) => w.code === code);
    if (!rec) throw new Error('no record');
    const caller = (await openRemote()).makePeer({ code, transport: rec.transport, creator: me.pub, webrtc: true });
    await caller.peer.start();
    caller.peer.setHuddle({ ch: 'general', mic: true, cam: false, screen: false });
    await until(() => faviconStateOf(app(), getPeer, false).callNearby, 'the call nearby', 30_000);
    useApp.setState({ huddle: { ...app().huddle, code, ch: 'general' } }); // that's my call too
    expect(faviconStateOf(app(), getPeer, false).callNearby).toBe(false);
    useApp.setState({ huddle: { ...app().huddle, code: null, ch: null } });
    caller.peer.leave();
  }, 40_000);
});

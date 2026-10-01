import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { commands } from 'vitest/browser';
import { agentDmChannel, dmChannel, inviteHash, keyFromPhrase, MAX_FILE_BYTES, newInviteCode, newNostrTransport, newRecoveryPhrase, sha256Buf } from '@yurt/protocol';
import { blobsDb, kv } from '../../../src/lib/db';
import { notificationsFor } from '../../../src/lib/notifications';
import { recentDiagnostics } from '../../../src/lib/diagnostics';
import { huddle } from '../../../src/lib/huddle';
import { getPeer } from '../../../src/lib/net';
import { useApp } from '../../../src/store';
import { openRemote, resetDb, until } from './harness';
import type { RemoteApi } from './remote';

// The real store, driven like the UI drives it, against the local relay and file server, with a second member
// (Olu) running real peers in his own frame.
const relay = inject('relayUrl');
const blossom = inject('blossomUrl');
const phrase = newRecoveryPhrase();
const me = keyFromPhrase(phrase);
const app = () => useApp.getState();
let remote: RemoteApi;
let relayCode = '';
let p2pCode = '';

/** Olu, joining one of my workspaces with its current invite. */
function olu(code: string, kp = keyFromPhrase(newRecoveryPhrase())) {
  const rec = app().workspaces.find((w) => w.code === code);
  if (!rec) throw new Error('no such workspace ' + code);
  const p = remote.makePeer({ code, transport: rec.transport, creator: rec.creator, kp });
  void p.peer.start();
  return p;
}

beforeAll(async () => {
  await resetDb();
  await commands.setPermissions([], location.origin);
  await app().init();
  await app().createIdentity(phrase, 'Ada', 'ada');
  remote = await openRemote();
});

afterAll(async () => {
  await huddle.leave();
  for (const w of app().workspaces) getPeer(w.code)?.leave();
  await commands.setPermissions([], location.origin);
});

describe('workspaces', () => {
  it('creates a relay workspace with its own servers, opens #general and remembers the settings', async () => {
    relayCode = await app().createWorkspace('  Team  ', { kind: 'nostr', relays: [relay], blossom: [blossom] });
    await until(() => app().route.code === relayCode && app().route.ch === 'general', '#general');
    expect(app().workspaces.find((w) => w.code === relayCode)).toMatchObject({ name: 'Team', creator: me.pub, blossom: [blossom] });
    expect(app().settings.lastNet?.nostr).toEqual({ relays: [relay], blossom: [blossom] });
    await until(() => app().states[relayCode]?.channels.has('general') === true, 'the workspace state');
  });

  it('creates a peer-to-peer workspace, and one without file servers', async () => {
    p2pCode = await app().createWorkspace('P2P', { kind: 'trystero', signal: { kind: 'nostr', urls: [relay] } });
    expect(app().workspaces.find((w) => w.code === p2pCode)?.transport.kind).toBe('trystero');
    const bare = await app().createWorkspace('Bare', { kind: 'nostr', relays: [relay], blossom: [] });
    expect(app().workspaces.find((w) => w.code === bare)?.blossom).toBeUndefined();
    await app().leaveWorkspace(bare);
  });

  it('joins only with a valid invite, and goes to a workspace it already has', async () => {
    expect(await app().joinWorkspace('#/w/' + newInviteCode())).toBe(false);
    app().go({});
    await until(() => !app().route.code, 'home');
    const t = app().workspaces.find((w) => w.code === relayCode)?.transport;
    if (t?.kind !== 'nostr') throw new Error('missing');
    expect(await app().joinWorkspace(inviteHash({ code: relayCode, transport: t }))).toBe(true);
    await until(() => app().route.code === relayCode, 'the workspace');
    expect(app().workspaces.filter((w) => w.code === relayCode)).toHaveLength(1);
  });

  it('learns a workspace’s creator and name when the invite didn’t carry them', async () => {
    const code = newInviteCode();
    const transport = newNostrTransport([relay]);
    const host = remote.makePeer({ code, transport });
    await host.peer.start();
    host.peer.publish({ t: 'ws.create', b: { name: 'Hosted' } });
    expect(await app().joinWorkspace(inviteHash({ code, transport }))).toBe(true);
    await until(() => app().workspaces.find((w) => w.code === code)?.creator === host.kp.pub, 'the creator');
    await until(() => app().workspaces.find((w) => w.code === code)?.name === 'Hosted', 'the name');
    host.peer.leave();
    await app().leaveWorkspace(code);
    await until(() => !app().route.code, 'home');
  });
});

describe('messages and files', () => {
  beforeAll(() => app().go({ code: relayCode, ch: 'general' }));

  it('sends text, thread replies and files uploaded to the workspace’s file server', async () => {
    await until(() => app().route.ch === 'general', 'the channel');
    expect(await app().send('hello', [])).toBe(true);
    const rootOf = () => [...(app().states[relayCode]?.msgs.values() ?? [])].find((m) => m.text === 'hello');
    await until(() => !!rootOf(), 'my message');
    expect(await app().send('in thread', [], rootOf()?.id)).toBe(true);
    await until(() => (rootOf()?.replies.length ?? 0) === 1, 'the thread reply');
    const file = new File([new Uint8Array([1, 2, 3])], 'a.bin');
    expect(await app().send('', [file])).toBe(true);
    await until(() => [...(app().states[relayCode]?.msgs.values() ?? [])].some((m) => m.files[0]?.name === 'a.bin' && !!m.files[0].blob), 'the file message');
    const typed = new File(['x'], 'note.txt', { type: 'text/plain' });
    expect(await app().send('typed', [typed])).toBe(true);
  });

  it('keeps the draft when there is nothing to send, a file is too big, or the upload fails', async () => {
    expect(await app().send('', [])).toBe(false);
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'huge.bin');
    expect(await app().send('x', [big])).toBe(false);
    expect(app().toasts.at(-1)?.title).toBe('huge.bin is over 25 MB');
    await app().updateConnection(relayCode, { kind: 'nostr', relays: [relay], blossom: ['http://127.0.0.1:9'] });
    expect(await app().send('x', [new File(['y'], 'b.txt')])).toBe(false);
    expect(app().toasts.at(-1)?.title).toBe('Couldn’t upload b.txt');
    await app().updateConnection(relayCode, { kind: 'nostr', relays: [relay], blossom: [] }); // back to the defaults
    expect(app().workspaces.find((w) => w.code === relayCode)?.blossom).toBeUndefined();
    app().go({});
    await until(() => !app().route.code, 'home');
    expect(await app().send('nowhere', [])).toBe(false);
    // A route still pointing at a workspace I just left: nothing is sent, so the draft stays.
    useApp.setState({ route: { code: newInviteCode(), ch: 'general' } });
    expect(await app().send('into the void', [])).toBe(false);
    useApp.setState({ route: {} });
  });

  it('sends files directly between members in a peer-to-peer workspace', async () => {
    app().go({ code: p2pCode, ch: 'general' });
    await until(() => app().route.code === p2pCode && app().states[p2pCode]?.channels.has('general') === true, 'the channel');
    expect(await app().send('', [new File(['p2p'], 'p.txt')])).toBe(true);
    const m = [...(app().states[p2pCode]?.msgs.values() ?? [])].find((x) => x.files[0]?.name === 'p.txt');
    expect(m?.files[0]?.blob).toBeUndefined();
  });

  it('fetches a member’s attachment: from the file server, or from them over WebRTC', async () => {
    // From the file server (relay workspace).
    const o = olu(relayCode);
    await until(() => o.peer.state.channels.has('general'), 'Olu to sync');
    const up = await remote.uploaded([blossom], 3000);
    o.peer.publish({ t: 'msg', ch: 'general', b: { text: 'file', files: [{ id: up.id, name: 'f.bin', size: up.size, type: 'application/octet-stream', blob: up.blob }] } });
    await until(() => [...(app().states[relayCode]?.msgs.values() ?? [])].some((m) => m.files[0]?.id === up.id), 'his message');
    expect(await app().fetchBlob(relayCode, up.id)).toBe(true);
    expect(app().blobVer[up.id]).toBe(1);
    // From Olu himself, over WebRTC (peer-to-peer workspace).
    const p = olu(p2pCode);
    await until(() => p.peer.peers.size > 0 && (getPeer(p2pCode)?.peers.size ?? 0) > 0, 'Olu to connect', 30_000);
    const own = await p.ownFile(200_000);
    p.peer.publish({ t: 'msg', ch: 'general', b: { text: 'big', files: [own] } });
    await until(() => [...(app().states[p2pCode]?.msgs.values() ?? [])].some((m) => m.files[0]?.id === own.id), 'his message');
    expect(await app().fetchBlob(p2pCode, own.id)).toBe(true);
    expect(app().blobProgress[own.id]).toBeGreaterThan(0);
    expect(await app().fetchBlob('NOWHERE1', 'x')).toBe(false);
    // A file whose server is gone can't be fetched: reported, not thrown.
    const lost = await remote.uploaded([blossom], 10);
    o.peer.publish({
      t: 'msg',
      ch: 'general',
      b: { text: 'lost', files: [{ id: lost.id, name: 'l.bin', size: 10, type: 'application/octet-stream', blob: { ...lost.blob, servers: ['http://127.0.0.1:9'] } }] },
    });
    await until(() => [...(app().states[relayCode]?.msgs.values() ?? [])].some((m) => m.files[0]?.id === lost.id), 'the lost file message');
    expect(await app().fetchBlob(relayCode, lost.id)).toBe(false);
    o.peer.leave();
    p.peer.leave();
  }, 60_000);

  it('keeps a banned member out of a peer-to-peer workspace’s room', async () => {
    const mallory = keyFromPhrase(newRecoveryPhrase());
    app().publish(p2pCode, { t: 'ban', b: { target: mallory.pub, on: true } });
    await until(() => app().states[p2pCode]?.bans.has(mallory.pub) === true, 'the ban');
    // Her own device (frame): a fresh peer id, as a separate person always has.
    const rec = app().workspaces.find((w) => w.code === p2pCode);
    if (!rec) throw new Error('missing');
    const m = (await openRemote()).makePeer({ code: p2pCode, transport: rec.transport, creator: rec.creator, kp: mallory });
    void m.peer.start();
    await until(() => recentDiagnostics().some((d) => d.code === p2pCode && d.kind === 'join'), 'the refused handshake', 30_000);
    expect([...(getPeer(p2pCode)?.peers.values() ?? [])].some((x) => x.pub === mallory.pub)).toBe(false);
    m.peer.leave();
  }, 40_000);

  it('creates channels with unique ids, and only inside a synced workspace', async () => {
    app().go({ code: relayCode, ch: 'general' });
    await until(() => app().route.code === relayCode, 'the workspace');
    expect(app().createChannel('Design Review', 'pixels')).toBe('design-review');
    await until(() => app().states[relayCode]?.channels.has('design-review') === true, 'the channel');
    expect(app().createChannel('design review', '')).toMatch(/^design-review-[a-z0-9]{1,3}$/);
    expect(app().createChannel('!!!', '')).toBe('channel');
    app().go({});
    await until(() => !app().route.code, 'home');
    expect(app().createChannel('nope', '')).toBeUndefined();
  });

  it('shows typing for a few seconds, and asks the bridge’s agents for approvals', async () => {
    app().setTyping('general'); // no workspace open: nothing to do
    app().go({ code: relayCode, ch: 'general' });
    await until(() => app().route.ch === 'general', 'the channel');
    app().setTyping('general');
    app().setTyping('general'); // typing again only restarts the timer
    expect(getPeer(relayCode)?.myPresence.typing).toBe('general');
    await until(() => getPeer(relayCode)?.myPresence.typing === null, 'typing to stop', 6_000);
    app().setTyping(null);
    app().go({ code: relayCode, ch: agentDmChannel(me.pub, 'scout') });
    await until(() => app().route.ch === agentDmChannel(me.pub, 'scout'), 'the agent chat');
    app().approve('req-1', 'allow');
    const sent = [...(getPeer(relayCode)?.events.values() ?? [])].find((e) => e.t === 'approve');
    expect(sent).toMatchObject({ ch: agentDmChannel(me.pub, 'scout'), to: me.pub, b: { req: 'req-1', option: 'allow' } });
    app().go({});
    await until(() => !app().route.code, 'home');
    app().approve('req-2', 'allow'); // no conversation open: nothing to approve in
  }, 15_000);

  it('marks conversations read (saved shortly after) and mutes them', async () => {
    app().markRead('NOWHERE1', 'general');
    app().toggleMute('NOWHERE1', 'general');
    app().markRead(relayCode, 'general');
    app().markRead(relayCode, 'random'); // saves once for both
    expect(app().workspaces.find((w) => w.code === relayCode)?.lastRead.random).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 700));
    const saved = (await kv.get('workspaces')) as { code: string; lastRead: Record<string, number> }[];
    expect(saved.find((w) => w.code === relayCode)?.lastRead.random).toBeGreaterThan(0);
    app().toggleMute(relayCode, 'general');
    expect(app().workspaces.find((w) => w.code === relayCode)?.muted).toContain('general');
    app().toggleMute(relayCode, 'general');
    expect(app().workspaces.find((w) => w.code === relayCode)?.muted).not.toContain('general');
    expect(app().publish('NOWHERE1', { t: 'msg', ch: 'general', b: { text: 'x' } })).toBeUndefined();
  });
});

describe('notifications', () => {
  it('stay quiet while turned off, and turn off again if the browser refuses', async () => {
    expect(await app().updateSettings({ notifications: true })).toBe(0);
    expect(app().settings.notifications).toBe(false); // the headless prompt is dismissed
    expect(((await kv.get('settings')) as { notifications: boolean }).notifications).toBe(false);
  });

  it('announce direct messages, mentions and approvals for me, and nothing else', async () => {
    await commands.setPermissions(['notifications'], location.origin);
    expect(await app().updateSettings({ notifications: true })).toBe(0);
    expect(app().settings.notifications).toBe(true);
    const o = olu(relayCode);
    await until(() => o.peer.state.channels.has('general') && o.peer.connected, 'Olu to sync');
    o.peer.publish({ t: 'profile', b: { name: 'Olu', handle: 'olu' } });
    app().go({ code: relayCode, ch: 'design-review' });
    await until(() => app().route.ch === 'design-review', 'another channel');
    const dm = dmChannel(o.kp.pub, me.pub);
    const said = (ch: string) => notificationsFor(relayCode, ch).map((n) => n.title + ': ' + n.body);
    o.peer.publish({ t: 'msg', ch: dm, to: me.pub, b: { text: 'a dm' } });
    o.peer.publish({ t: 'msg', ch: 'general', b: { text: 'hey @ada' } });
    o.peer.publish({ t: 'msg', ch: 'general', b: { text: 'not for you' } });
    o.peer.publish({ t: 'msg', ch: 'general', b: { text: 'old @ada' }, ts: Date.now() - 120_000 });
    o.peer.publish({ t: 'msg', ch: 'design-review', b: { text: '@ada you see this already' } });
    o.peer.publish({ t: 'react', ch: 'general', b: { target: 'x', icon: 'heart', on: true } });
    await until(() => said(dm).length === 1 && said('general').length === 1, 'the notifications');
    // My other device runs my agent: its approval request is for me; an agent I don't know still has a name.
    const mine = olu(relayCode, me);
    await until(() => mine.peer.connected, 'my other device');
    mine.peer.publish({ t: 'agent', b: { id: 'scout', name: 'Scout', handle: 'scout', runtime: 'copilot', replyIn: 'thread' } });
    const adm = agentDmChannel(me.pub, 'scout');
    mine.peer.publish({ t: 'msg', ch: adm, to: me.pub, ag: 'scout', b: { text: 'ok?', approval: { req: 'r9', title: 'edit a file', options: [] } } });
    mine.peer.publish({ t: 'msg', ch: 'general', ag: 'unknown-agent', b: { text: 'hi @ada from a stranger agent' } });
    mine.peer.publish({ t: 'msg', ch: 'general', b: { text: 'my own @ada from my laptop' } });
    await until(() => said(adm).length === 1 && said('general').length === 2, 'the approval and agent mention');
    // Someone without a profile yet.
    const anon = olu(relayCode);
    await until(() => anon.peer.connected, 'a member without a profile');
    const anonDm = dmChannel(anon.kp.pub, me.pub);
    anon.peer.publish({ t: 'msg', ch: anonDm, to: me.pub, b: { text: 'who am I' } });
    await until(() => said(anonDm).length === 1, 'their DM');
    expect(said(anonDm)).toEqual(['Someone: who am I']);
    anon.peer.leave();
    // A muted channel stays quiet; so does everything once the browser's permission is withdrawn.
    app().toggleMute(relayCode, 'general');
    o.peer.publish({ t: 'msg', ch: 'general', b: { text: 'muted @ada' } });
    app().toggleMute(relayCode, 'general');
    await commands.setPermissions([], location.origin);
    o.peer.publish({ t: 'msg', ch: dm, to: me.pub, b: { text: 'while not allowed' } });
    await until(() => [...(app().states[relayCode]?.msgs.values() ?? [])].some((m) => m.text === 'while not allowed'), 'the last message');
    await new Promise((r) => setTimeout(r, 300));
    expect(said(dm)).toEqual(['Olu: a dm']);
    expect(said('general')).toEqual(['Olu in #general: hey @ada', 'Agent in #general: hi @ada from a stranger agent']);
    expect(said(adm)).toEqual(['Scout needs you: edit a file']);
    // Clicking one opens its conversation; reading a conversation clears its notifications.
    notificationsFor(relayCode, dm)[0]?.dispatchEvent(new Event('click'));
    await until(() => app().route.ch === dm, 'the DM to open');
    app().markRead(relayCode, dm);
    expect(said(dm)).toEqual([]);
    o.peer.leave();
    mine.peer.leave();
  }, 45_000);
});

describe('keys and connections', () => {
  it('follow a key rotation by the creator, so new invites carry the newest key', async () => {
    const code = newInviteCode();
    const transport = newNostrTransport([relay]);
    const host = remote.makePeer({ code, transport });
    await host.peer.start();
    host.peer.publish({ t: 'ws.create', b: { name: 'Rotating' } });
    expect(await app().joinWorkspace(inviteHash({ code, transport, creator: host.kp.pub }))).toBe(true);
    await until(() => (app().states[code]?.profiles.size ?? 0) >= 1 && !!host.peer.state.profiles.get(me.pub), 'both to see each other');
    host.peer.rotate();
    await until(() => app().workspaces.find((w) => w.code === code)?.transport.key !== transport.key, 'the new key');
    host.peer.leave();
    await app().leaveWorkspace(code);
  });

  it('ignore the late state of a connection that was just replaced', async () => {
    const before = getPeer(relayCode);
    app().publish(relayCode, { t: 'msg', ch: 'general', b: { text: 'right before a reconnect' } });
    await app().updateConnection(relayCode, { kind: 'nostr', relays: [relay], blossom: [blossom] });
    expect(getPeer(relayCode)).not.toBe(before);
    await until(() => [...(app().states[relayCode]?.msgs.values() ?? [])].some((m) => m.text === 'right before a reconnect'), 'the new connection to load it');
  });

  it('refuse changes that don’t fit a workspace’s mode', async () => {
    await expect(app().updateConnection('NOWHERE1', { kind: 'nostr', relays: [relay], blossom: [] })).rejects.toThrow('Unknown workspace');
    await expect(app().updateConnection(relayCode, { kind: 'nostr', relays: [], blossom: [] })).rejects.toThrow('at least one relay');
    await expect(app().updateConnection(relayCode, { kind: 'trystero', signal: { kind: 'nostr', urls: [] } })).rejects.toThrow('relays and file servers');
    await expect(app().updateConnection(p2pCode, { kind: 'nostr', relays: [relay], blossom: [] })).rejects.toThrow('signaling');
  });

  it('move a peer-to-peer workspace to other signaling, and back to the default', async () => {
    await app().updateConnection(p2pCode, { kind: 'trystero', signal: { kind: 'torrent', urls: ['ws://127.0.0.1:9'] } });
    expect(app().workspaces.find((w) => w.code === p2pCode)?.transport).toMatchObject({ signal: { kind: 'torrent' } });
    await app().updateConnection(p2pCode, { kind: 'trystero', signal: { kind: 'nostr', urls: [] } });
    expect(app().workspaces.find((w) => w.code === p2pCode)?.transport).not.toHaveProperty('signal');
    await app().updateConnection(p2pCode, { kind: 'trystero', signal: { kind: 'nostr', urls: [relay] } });
  });

  it('reconnect only the workspaces a network setting affects', async () => {
    expect(await app().updateSettings({ theme: 'light' })).toBe(0);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(await app().updateSettings({ turn: 'default' })).toBe(1); // TURN: the peer-to-peer workspace
    expect(await app().updateSettings({ turn: 'default' })).toBe(0); // unchanged
    expect(await app().updateSettings({ webrtc: true })).toBe(1); // calls: the relay workspace
    expect(await app().updateSettings({ turnUrls: 'turn:x.example', turn: 'custom' })).toBe(2); // with calls on, both
    expect(await app().updateSettings({ turnUser: 'u' })).toBe(2);
    expect(await app().updateSettings({ turnPass: 'p' })).toBe(2);
  });

  it('leave a call in a workspace that reconnects', async () => {
    const peer = getPeer(relayCode);
    if (!peer) throw new Error('no peer');
    await huddle.join(peer, 'general');
    expect(huddle.view.ch).toBe('general');
    await app().updateConnection(relayCode, { kind: 'nostr', relays: [relay], blossom: [blossom] });
    expect(huddle.view.ch).toBeNull();
  });

  it('tells the bridge about a workspace’s agents, and its new network', async () => {
    app().setAgents('NOWHERE1', ['scout']);
    app().setAgents(relayCode, ['scout']); // bridge not connected: nothing is sent, nothing breaks
    useApp.setState({
      bridgeState: { version: '1', identity: null, agents: [], workspaces: [{ code: relayCode, name: 'Team', agents: [] }], runtimes: [], startOnLogin: false, allowedOrigins: [] },
    });
    await app().updateConnection(relayCode, { kind: 'nostr', relays: [relay], blossom: [blossom] });
    useApp.setState({ bridgeState: null });
  });

  it('renames me everywhere', async () => {
    await app().updateProfile('  Ada L ', ' AdaL ');
    expect(app().identity).toMatchObject({ name: 'Ada L', handle: 'adal' });
    await until(() => app().states[relayCode]?.profiles.get(me.pub)?.handle === 'adal', 'the new profile');
  });
});

describe('leaving', () => {
  it('drops a workspace’s history and the files only it used, and goes home', async () => {
    const shared = new File(['shared'], 's.txt');
    const own = new File(['own'], 'o.txt');
    app().go({ code: p2pCode, ch: 'general' });
    await until(() => app().route.code === p2pCode, 'p2p');
    await app().send('', [shared, own]);
    app().go({ code: relayCode, ch: 'general' });
    await until(() => app().route.code === relayCode, 'relay');
    await app().send('', [shared]);
    const [sharedId, ownId] = await Promise.all([shared, own].map(async (f) => sha256Buf(await f.arrayBuffer())));
    await until(() => [...(app().states[relayCode]?.msgs.values() ?? [])].some((m) => m.files.some((f) => f.id === sharedId)), 'the shared file in both');
    const peer = getPeer(p2pCode);
    if (!peer) throw new Error('no peer');
    await huddle.join(peer, 'general');
    await app().leaveWorkspace(p2pCode);
    expect(huddle.view.ch).toBeNull();
    expect(app().workspaces.map((w) => w.code)).not.toContain(p2pCode);
    expect(app().states[p2pCode]).toBeUndefined();
    expect(await blobsDb.get(ownId ?? '')).toBeNull();
    expect(await blobsDb.get(sharedId ?? '')).not.toBeNull();
    await until(() => !app().route.code, 'home');
  }, 30_000);
});

describe('screen state', () => {
  it('opens thread panels from the route and closes them when leaving the thread', async () => {
    app().setPanel({ type: 'members' });
    app().go({ code: relayCode, ch: 'general', thread: 'abc' });
    await until(() => app().panel.type === 'thread', 'the thread panel');
    expect(app().panel).toEqual({ type: 'thread', id: 'abc' });
    app().go({ code: relayCode, ch: 'general' });
    await until(() => app().panel.type === null, 'the panel to close');
    app().setPanel({ type: 'search' });
    app().go({ code: relayCode, ch: 'design-review' });
    await until(() => app().route.ch === 'design-review', 'another channel');
    expect(app().panel.type).toBe('search');
  });

  it('opens Settings where asked, falling back outside a workspace', async () => {
    app().openSettings('ws-network');
    expect(app()).toMatchObject({ dialog: 'settings', settingsSection: 'ws-network' });
    app().setDialog(null);
    app().openSettings();
    expect(app().settingsSection).toBe('ws-network');
    app().go({});
    await until(() => !app().route.code, 'home');
    app().openSettings('ws-agents');
    expect(app().settingsSection).toBe('profile');
    app().openSettings('preferences');
    expect(app().settingsSection).toBe('preferences');
  });

  it('shows at most three toasts, dismissing older ones properly', () => {
    const dismissed: number[] = [];
    for (let i = 0; i < 4; i++) app().toast({ title: 'T' + i, onDismiss: () => dismissed.push(i) });
    const titles = app().toasts.map((t) => t.title);
    expect(titles.slice(-3)).toEqual(['T1', 'T2', 'T3']);
    expect(dismissed).toContain(0);
    app().dismiss(-1);
    for (const t of app().toasts) app().dismiss(t.id);
    expect(app().toasts).toEqual([]);
  });
});

describe('when this device can’t save', () => {
  it('tells the user, instead of failing quietly', async () => {
    await new Promise<void>((res, rej) => {
      const r = indexedDB.open('yurt', 2); // a newer app version upgraded the database in another tab
      r.onsuccess = () => {
        r.result.close();
        res();
      };
      r.onerror = () => rej(r.error);
    });
    app().publish(relayCode, { t: 'msg', ch: 'general', b: { text: 'not saved here' } });
    await until(() => app().toasts.some((t) => t.tone === 'danger' && /save/i.test(t.title)), 'the error toast');
    expect(recentDiagnostics().some((d) => d.code === relayCode && d.kind === 'error')).toBe(true);
    await resetDb();
  });
});

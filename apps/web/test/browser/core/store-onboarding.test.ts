import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { inviteHash, keyFromPhrase, newInviteCode, newNostrTransport, newRecoveryPhrase, newTrysteroTransport } from '@yurt/protocol';
import { kv } from '../../../src/lib/db';
import { getPeer } from '../../../src/lib/net';
import { useApp } from '../../../src/store';
import { openRemote, resetDb, until } from './harness';
import type { RemoteApi } from './remote';

// Someone opens an invite link before they have an identity: the key waits in memory (never in the address
// bar or history) until onboarding finishes, then they join.
let remote: RemoteApi;
let owner: ReturnType<RemoteApi['makePeer']>;
const code = newInviteCode();
const transport = newNostrTransport([inject('relayUrl')]);
const phrase = newRecoveryPhrase();
// A workspace saved on this device without an identity (e.g. the identity was removed in devtools).
const saved = { code: newInviteCode(), name: 'Saved', transport: newTrysteroTransport({ kind: 'nostr', urls: [inject('relayUrl')] }), creator: null, lastRead: {}, muted: [] };

beforeAll(async () => {
  await resetDb();
  await kv.set('workspaces', [saved]);
  remote = await openRemote();
  owner = remote.makePeer({ code, transport });
  await owner.peer.start();
  owner.peer.publish({ t: 'ws.create', b: { name: 'Invited' } });
  owner.peer.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
  // A different workspace's link first, then a code-only link elsewhere: the first key must not survive that.
  location.hash = inviteHash({ code: newInviteCode(), transport: newNostrTransport([inject('relayUrl')]) });
  await useApp.getState().init();
});

afterAll(() => {
  owner.peer.leave();
  for (const w of useApp.getState().workspaces) getPeer(w.code)?.leave();
});

describe('an invite opened before onboarding', () => {
  it('waits without an identity, and leaves the address bar without the key', () => {
    expect(useApp.getState().identity).toBeNull();
    expect(location.hash).not.toContain('/k/');
    expect(useApp.getState().workspaces.map((w) => w.code)).toEqual([saved.code]);
    expect(getPeer(saved.code)).toBeUndefined(); // nothing connects before there's someone to connect as
  });

  it('does nothing that needs an identity, and says so where it must', async () => {
    const app = useApp.getState();
    expect(await app.updateSettings({ turn: 'default' })).toBe(1); // reconnecting it still connects nothing
    expect(getPeer(saved.code)).toBeUndefined();
    await expect(app.createWorkspace('No one', { kind: 'nostr', relays: [inject('relayUrl')], blossom: [] })).rejects.toThrow('Create your identity');
    await app.updateProfile('Nobody', 'nobody');
    expect(useApp.getState().identity).toBeNull();
    const route = useApp.getState().route;
    useApp.setState({ route: { code: saved.code, ch: 'general' } });
    expect(await app.send('hello', [])).toBe(false);
    app.approve('r', 'allow');
    useApp.setState({ route });
  });

  it('is forgotten when the route moves to another workspace', async () => {
    const elsewhere = newInviteCode();
    location.hash = '#/w/' + elsewhere;
    await until(() => useApp.getState().route.code === elsewhere, 'the new route');
  });

  it('joins the workspace of the last invite once onboarding finishes', async () => {
    location.hash = inviteHash({ code, transport, creator: owner.kp.pub });
    await until(() => useApp.getState().route.code === code, 'the invite route');
    expect(location.hash).toBe('#/w/' + code);
    await useApp.getState().createIdentity(phrase, '  Bea  ', ' BEA ');
    const s = useApp.getState();
    expect(s.identity).toMatchObject({ ...keyFromPhrase(phrase), name: 'Bea', handle: 'bea' });
    expect(s.workspaces.map((w) => [w.code, w.creator])).toEqual([
      [saved.code, null],
      [code, owner.kp.pub],
    ]);
    expect(getPeer(saved.code)).toBeDefined(); // and now everything saved connects
    expect(await kv.get('identity')).toMatchObject({ phrase, name: 'Bea' });
    await until(() => useApp.getState().states[code]?.name === 'Invited', 'the workspace to sync');
    await until(() => useApp.getState().workspaces[1]?.name === 'Invited', 'the record to take its name');
    await until(() => owner.peer.state.profiles.get(keyFromPhrase(phrase).pub)?.handle === 'bea', 'the owner to see my profile');
  });
});

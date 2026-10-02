import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { keyFromPhrase, newInviteCode, newNostrTransport, newRecoveryPhrase, newWorkspaceKey } from '@yurt/protocol';
import { kv } from '../../../src/lib/db';
import { getPeer } from '../../../src/lib/net';
import { useApp } from '../../../src/store';
import { resetDb, until } from './harness';

// Starting the app on a device with data from an older version: some of it partial or corrupt.
const phrase = newRecoveryPhrase();
const relayWs = {
  code: newInviteCode(),
  name: 'Relays',
  transport: { key: newWorkspaceKey(), relays: [inject('relayUrl')] },
  creator: null,
  lastRead: {},
  muted: [],
};
const damaged = {
  code: newInviteCode(),
  name: 'Damaged',
  transport: newNostrTransport([inject('relayUrl')]),
  creator: 'x',
  lastRead: { general: 'soon' },
  muted: [1],
};
const stranger = newInviteCode();

beforeAll(async () => {
  await resetDb();
  await kv.set('identity', { phrase, name: 'Ada', handle: 'ada', pub: 'stale', sec: 'stale' });
  await kv.set('workspaces', [relayWs, null, { name: 'no code' }, damaged]);
  await kv.set('settings', { theme: 'light', lastNet: { relays: ['wss://old.example'], blossom: [] }, webrtc: false, turn: 7 });
  location.hash = '#/w/' + stranger; // a pasted code-only link: no key, so it can't be joined
  await useApp.getState().init({ clockMs: 100 }); // the real interval, ticking fast
});

afterAll(() => {
  for (const w of useApp.getState().workspaces) getPeer(w.code)?.leave();
});

describe('starting up', () => {
  it('loads what can be used and repairs the rest', () => {
    const s = useApp.getState();
    expect(s.ready).toBe(true);
    expect(s.identity).toMatchObject({ ...keyFromPhrase(phrase), name: 'Ada', handle: 'ada' });
    expect(s.workspaces.map((w) => w.code)).toEqual([relayWs.code, damaged.code]);
    expect(s.workspaces[1]).toMatchObject({ creator: null, lastRead: {}, muted: [] });
    expect(s.settings).toMatchObject({ theme: 'light', webrtc: false, turn: 'off', lastNet: { relays: ['wss://old.example'] } });
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('connects every saved workspace and publishes my profile once it syncs', async () => {
    const peer = getPeer(relayWs.code);
    await until(() => !!peer?.connected, 'the relay');
    await until(() => peer?.state.profiles.get(keyFromPhrase(phrase).pub)?.name === 'Ada', 'my profile in the workspace');
    expect(getPeer(damaged.code)).toBeDefined();
  });

  it('explains a link it can’t join, then goes home', async () => {
    await until(() => useApp.getState().toasts.some((t) => t.title === 'This link can’t be joined'), 'the explanation');
    expect(useApp.getState().route).toEqual({});
  });

  it('just goes home for an in-app link to a workspace I’m not in', async () => {
    const before = useApp.getState().toasts.length;
    location.hash = '#/w/' + newInviteCode();
    await until(() => location.hash === '#/', 'home');
    expect(useApp.getState().toasts.length).toBe(before);
  });

  it('follows the network going away and coming back', async () => {
    // The browser's own events (taking the real network away would also cut this test page from its runner).
    window.dispatchEvent(new Event('offline'));
    expect(useApp.getState().online).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(useApp.getState().online).toBe(true);
  });

  it('refreshes presence when the tab’s visibility or the window’s focus changes', async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getPeer(relayWs.code)?.myPresence.st).toBe('online');
    window.parent.focus(); // the test runner's page: as good as another app in front
    await until(() => getPeer(relayWs.code)?.myPresence.st === 'away', 'away');
    window.focus();
    await until(() => getPeer(relayWs.code)?.myPresence.st === 'online', 'back online');
  });

  it('toasts a call that couldn’t start, since there is no call view to show it in', async () => {
    const peer = getPeer(relayWs.code);
    if (!peer) throw new Error('no peer');
    const { huddle } = await import('../../../src/lib/huddle');
    await huddle.join(peer, 'general'); // calls are turned off on this device
    await until(() => useApp.getState().toasts.some((t) => t.title === 'Couldn’t join the huddle'), 'the toast');
    expect(huddle.view.error).toBeUndefined();
  });

  it('keeps time-based views current', async () => {
    const before = useApp.getState().clock;
    await until(() => useApp.getState().clock > before, 'the clock to tick');
  });
});

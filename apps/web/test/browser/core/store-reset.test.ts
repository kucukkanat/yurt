import { beforeAll, describe, expect, inject, it } from 'vitest';
import { newRecoveryPhrase } from '@yurt/protocol';
import { blobsDb, eventsDb, kv } from '../../../src/lib/db';
import { huddle } from '../../../src/lib/huddle';
import { getPeer } from '../../../src/lib/net';
import { useApp } from '../../../src/store';
import { resetDb, until } from './harness';

const app = () => useApp.getState();
let code = '';

beforeAll(async () => {
  await resetDb();
  await app().init();
  await app().createIdentity(newRecoveryPhrase(), 'Ada', 'ada');
  await app().updateSettings({ theme: 'light', webrtc: true });
  code = await app().createWorkspace('Doomed', { kind: 'nostr', relays: [inject('relayUrl')], blossom: [] });
  await app().send('', [new File(['bytes'], 'f.txt')]);
  await kv.set('bridgeToken', 'tok');
  const peer = getPeer(code);
  if (!peer) throw new Error('no peer');
  await huddle.join(peer, 'general');
});

describe('resetting the device', () => {
  it('wipes everything and starts over as a first visit, in place', async () => {
    expect(huddle.view.ch).toBe('general');
    app().setDialog('settings');
    await app().resetDevice();
    expect(huddle.view.ch).toBeNull();
    expect(getPeer(code)).toBeUndefined();
    expect(app()).toMatchObject({ ready: true, identity: null, workspaces: [], states: {}, route: {}, dialog: null, toasts: [] });
    expect(app().settings.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(location.hash).toBe('#/');
    for (const k of ['identity', 'workspaces', 'settings', 'bridgeToken']) expect(await kv.get(k)).toBeUndefined();
    expect(await eventsDb.byWs(code)).toEqual([]);
    const ids = await new Promise<IDBValidKey[]>((res) => {
      const r = indexedDB.open('yurt', 1);
      r.onsuccess = () => {
        const q = r.result.transaction('blobs').objectStore('blobs').getAllKeys();
        q.onsuccess = () => {
          r.result.close();
          res(q.result);
        };
      };
    });
    expect(ids).toEqual([]);
    expect(await blobsDb.get('anything')).toBeNull();
  });

  it('can onboard again right away', async () => {
    await app().createIdentity(newRecoveryPhrase(), 'Bea', 'bea');
    const again = await app().createWorkspace('Again', { kind: 'nostr', relays: [inject('relayUrl')], blossom: [] });
    await until(() => app().states[again]?.name === 'Again', 'the new workspace');
    expect(app().workspaces.map((w) => w.name)).toEqual(['Again']);
    getPeer(again)?.leave();
  });
});

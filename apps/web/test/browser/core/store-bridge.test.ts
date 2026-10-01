import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { commands } from 'vitest/browser';
import { newRecoveryPhrase } from '@yurt/protocol';
import { bridge } from '../../../src/lib/bridge';
import { getPeer } from '../../../src/lib/net';
import { useApp } from '../../../src/store';
import { resetDb, until } from './harness';

// The store and the real test bridge: the bridge runs its own peer per workspace, and must follow the app even
// when changes happened while it was off.
const app = () => useApp.getState();
const onBridge = () => new Set(app().bridgeState?.workspaces.map((w) => w.code));
let kept = '';
let left = '';

beforeAll(async () => {
  await resetDb();
  bridge.url = inject('bridgeUrl');
  await commands.bridgeAllowOrigin(location.origin);
  await app().init();
  await app().createIdentity(newRecoveryPhrase(), 'Ada', 'ada');
  kept = await app().createWorkspace('Kept', { kind: 'nostr', relays: [inject('relayUrl')], blossom: [] });
  left = await app().createWorkspace('Left', { kind: 'nostr', relays: [inject('relayUrl')], blossom: [] });
});

afterAll(async () => {
  for (const w of app().workspaces) getPeer(w.code)?.leave();
  await bridge.forget();
});

describe('the bridge and the app', () => {
  it('pairs, and the store follows the bridge’s status and state', async () => {
    bridge.start();
    await until(() => app().bridgeStatus === 'unpaired', 'the bridge');
    expect(await bridge.pair(await commands.bridgePairingCode())).toBe(true);
    await until(() => app().bridgeStatus === 'connected' && !!app().bridgeState, 'connected with state');
    app().setAgents(kept, []);
    app().setAgents(left, []);
    await until(() => onBridge().has(kept) && onBridge().has(left), 'both workspaces on the bridge');
  });

  it('catches the bridge up on reconnect: leaves what I left, and re-sends the rest', async () => {
    bridge.stop(); // the bridge goes away…
    await until(() => app().bridgeStatus === 'off', 'off');
    await app().leaveWorkspace(left); // …while I leave a workspace it still runs
    await bridge.autoStart({ phrase: app().identity?.phrase ?? '', name: 'Ada', handle: 'ada' });
    await until(() => app().bridgeStatus === 'connected' && !!app().bridgeState, 'reconnected');
    await until(() => !onBridge().has(left) && onBridge().has(kept), 'the left workspace gone from the bridge');
  });

  it('moves the bridge’s peer when a workspace’s relays change', async () => {
    await app().updateConnection(kept, { kind: 'nostr', relays: [inject('relayUrl'), 'ws://127.0.0.1:9'], blossom: [] });
    await until(() => app().bridgeState?.workspaces.some((w) => w.code === kept) === true, 'still on the bridge');
  });
});

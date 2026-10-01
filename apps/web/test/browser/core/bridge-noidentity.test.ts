import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { commands } from 'vitest/browser';
import { bridge } from '../../../src/lib/bridge';
import { resetDb, until } from './harness';

// Pairing from the bridge's own setup before this browser has an identity: nothing to share yet, still connected.
beforeAll(async () => {
  await resetDb();
  bridge.url = inject('bridgeUrl');
  await commands.bridgeAllowOrigin(location.origin);
});
afterAll(() => bridge.forget());

it('pairs and reconnects without an identity to share', async () => {
  bridge.start();
  await until(() => bridge.status === 'unpaired', 'the bridge');
  expect(await bridge.pair(await commands.bridgePairingCode())).toBe(true);
  await until(() => bridge.status === 'connected', 'connected');
  bridge.stop();
  bridge.start(); // the saved token, no identity
  await until(() => bridge.status === 'connected', 'connected again');
});

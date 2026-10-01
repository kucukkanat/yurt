import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { commands } from 'vitest/browser';
import { newRecoveryPhrase } from '@yurt/protocol';
import { bridge, type BridgeStatus } from '../../../src/lib/bridge';
import { kv } from '../../../src/lib/db';
import { resetDb, until } from './harness';

// The real yurt-bridge server from bridge-setup.ts, on its own port: pairing, tokens and state are the actual protocol.
const id = { phrase: newRecoveryPhrase(), name: 'Bea', handle: 'bea' };
const statuses: BridgeStatus[] = [];
const unsubscribe = bridge.subscribe((s) => statuses.push(s));

beforeAll(async () => {
  await resetDb();
  bridge.url = inject('bridgeUrl');
});
afterAll(async () => {
  unsubscribe();
  await bridge.forget();
});

describe('the local bridge client', () => {
  it('doesn’t dial the bridge until agents are asked for, or the browser paired before', async () => {
    await bridge.autoStart(id);
    expect(bridge.status).toBe('off');
  });

  it('reports a bridge that refuses this page as missing, and keeps retrying', async () => {
    bridge.start();
    bridge.start(); // already dialling: no second socket
    await until(() => bridge.status === 'missing', 'the refusal');
    await commands.bridgeAllowOrigin(location.origin); // the user allows this web app in the bridge
    await until(() => bridge.status === 'unpaired', 'a retry that reaches the bridge', 10_000);
  });

  it('pairs only with the code the bridge shows, then shares the identity', async () => {
    const code = await commands.bridgePairingCode();
    expect(await bridge.pair(code === '000000' ? '000001' : '000000')).toBe(false);
    expect(await bridge.pair(code)).toBe(true);
    await until(() => bridge.status === 'connected' && bridge.state?.identity?.handle === 'bea', 'the bridge to learn who I am');
    expect(await kv.get('bridgeToken')).toEqual(expect.any(String));
    bridge.setIdentity({ ...id, name: 'Bea B', handle: 'beab' });
    await until(() => bridge.state?.identity?.handle === 'beab', 'the renamed identity');
  });

  it('reconnects with the saved token, without pairing again', async () => {
    bridge.stop();
    expect(bridge.status).toBe('off');
    bridge.stop(); // nothing left to stop
    await bridge.autoStart(id);
    // A pairing started before the connection is up hears only hello and state, then gives up.
    const pairing = bridge.pair('123456');
    await until(() => bridge.status === 'connected', 'the token to be accepted');
    expect(await pairing).toBe(false);
  }, 20_000);

  it('ignores another program on the bridge’s port', async () => {
    bridge.stop();
    bridge.url = inject('foreignWsUrl'); // a real server speaking something else
    bridge.start();
    await new Promise((r) => setTimeout(r, 500));
    expect(bridge.status).toBe('connecting');
    expect(bridge.state).toBeNull();
    bridge.stop();
  });

  it('keeps retrying an address it can’t even dial, until stopped', async () => {
    bridge.url = 'ftp://127.0.0.1/'; // not a WebSocket scheme: the browser refuses to even create the socket
    bridge.start();
    expect(bridge.status).toBe('connecting');
    bridge.stop();
    expect(bridge.status).toBe('off');
    bridge.url = inject('bridgeUrl');
  });

  it('forgets the pairing', async () => {
    await bridge.forget();
    expect(await kv.get('bridgeToken')).toBeUndefined();
    expect(bridge.status).toBe('off');
    expect(statuses).toContain('connected');
  });
});

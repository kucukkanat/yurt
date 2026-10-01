import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { identityBackup, keyFromPhrase, newRecoveryPhrase } from '@yurt/protocol';
import { kv } from '../../../src/lib/db';
import { backupConfig, ledgerFromText, ledgerOf } from '../../../src/lib/backup';
import { recentDiagnostics } from '../../../src/lib/diagnostics';
import { getPeer } from '../../../src/lib/net';
import { useApp } from '../../../src/store';
import { resetDb, until } from './harness';

const app = () => useApp.getState();
const phrase = newRecoveryPhrase();
const local = () => [inject('relayUrl')];
/** The backup as any device with the phrase reads it from the relay. */
async function backedUp() {
  const b = identityBackup(keyFromPhrase(phrase).sec, local());
  try {
    return ledgerFromText(await b.load());
  } finally {
    b.close();
  }
}
const eventually = (check: () => Promise<void>) => vi.waitFor(check, { timeout: 15_000, interval: 50 });
/** A fresh device: everything wiped, then the same recovery phrase imported. */
async function importOnFreshDevice() {
  await app().resetDevice();
  expect(app().workspaces).toEqual([]);
  await app().createIdentity(phrase, 'Ada', 'ada');
}

let code = '';

beforeAll(async () => {
  await resetDb();
  await app().init();
});

describe('the workspace backup', () => {
  it('keeps the workspaces an identity joins on its relays, encrypted', async () => {
    await app().createIdentity(phrase, 'Ada', 'ada');
    code = await app().createWorkspace('Kept', { kind: 'nostr', relays: local(), blossom: [] });
    await eventually(async () => expect((await backedUp())[code]?.ws?.name).toBe('Kept'));
    // Its history on the relay too, so the next device has something to read back.
    await until(() => getPeer(code)?.queued.size === 0, 'the workspace’s events on the relay');
  });

  it('brings them back, connected, when the phrase is imported on another device', async () => {
    await importOnFreshDevice();
    await until(() => app().workspaces.some((w) => w.code === code), 'the restored workspace');
    expect(app().toasts.map((t) => t.title)).toContain('Restored a workspace from your backup');
    await until(() => app().states[code]?.name === 'Kept', 'the restored workspace’s history');
  });

  it('doesn’t bring back a workspace that was left', async () => {
    await app().leaveWorkspace(code);
    await eventually(async () => expect((await backedUp())[code]?.ws).toBeNull());
    await importOnFreshDevice();
    // Synced once this device's ledger has the remote "left" in it.
    await eventually(async () => expect(ledgerOf(await kv.get('backup'))[code]).toMatchObject({ ws: null }));
    expect(app().workspaces).toEqual([]);
  });

  it('reports a sync no relay answered, without replacing the backup, and syncs once back online', async () => {
    backupConfig.relays = ['ws://127.0.0.1:1'];
    const offline = await app().createWorkspace('Offline', { kind: 'nostr', relays: local(), blossom: [] });
    await until(() => recentDiagnostics().some((d) => d.code === 'backup' && d.detail.includes('No relay answered')), 'the failed sync');
    expect((await backedUp())[offline]).toBeUndefined();
    backupConfig.relays = local();
    window.dispatchEvent(new Event('online'));
    await eventually(async () => expect((await backedUp())[offline]?.ws?.name).toBe('Offline'));
  });
});

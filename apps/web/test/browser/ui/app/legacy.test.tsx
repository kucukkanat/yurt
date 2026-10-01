import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { newInviteCode } from '@yurt/protocol';
import { expectText, kv, startApp, until, useApp } from '../app';

const code = newInviteCode();

describe('a workspace from before invite keys', () => {
  it('warns that its short code can be guessed, and sends people to a new workspace', async () => {
    // What an older version of the app stored: a peer-to-peer workspace with no key (signaling kept local here).
    await startApp({
      as: 'Ada',
      seed: () =>
        kv.set('workspaces', [
          { code, name: 'Old team', transport: { kind: 'trystero', signal: { kind: 'nostr', urls: ['ws://127.0.0.1:9'] } }, creator: null, lastRead: {}, muted: [] },
        ]),
    });
    useApp.getState().go({ code });
    // Nothing synced yet: no channels to open. Its settings still explain the risk.
    await expect.element(page.getByText('Syncs when a member is online')).toBeVisible();
    useApp.getState().openSettings('ws-general');
    await expect.element(page.getByTestId('legacy-invite')).toBeVisible();
    await page.getByTestId('settings-nav-ws-network').click();
    await expectText(page.getByTestId('connection-legacy'), /Legacy code-only workspace/);
    await page.getByTestId('settings-nav-ws-general').click();
    await page.getByRole('button', { name: 'New workspace' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Create or join a workspace' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    // Once a channel exists (here, made on this device), every conversation carries the warning.
    useApp.getState().publish(code, { t: 'ch.create', b: { id: 'general', name: 'general' } });
    await until(() => useApp.getState().route.ch === 'general');
    await expect.element(page.getByTestId('legacy-warning')).toBeVisible();
  });
});

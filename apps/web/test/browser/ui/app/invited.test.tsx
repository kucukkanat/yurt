import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { formatCode, inviteHash, keyFromPhrase, newInviteCode, newNostrTransport, newRecoveryPhrase } from '@yurt/protocol';
import { member, relayUrl, startApp, until, useApp } from '../app';

describe('opening an invite link on a new device', () => {
  it('welcomes you to the workspace, then restores your identity and joins it', async () => {
    const code = newInviteCode();
    const transport = newNostrTransport([relayUrl()]);
    const bo = await member(code, 'Bo', undefined, { transport, creator: null });
    bo.publish({ t: 'ws.create', b: { name: 'Bo’s place' } });
    bo.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    const s = await startApp({ hash: inviteHash({ code, transport, creator: bo.who.pub }) });
    await expect.element(s.getByRole('heading', { name: 'You’re invited.' })).toBeVisible();
    await expect.element(s.getByText(formatCode(code))).toBeVisible();
    // The key left the address bar at once.
    expect(location.hash).not.toContain('/k/');
    await s.getByRole('textbox', { name: 'Display name' }).fill('Ada');
    await s.getByRole('button', { name: /Continue/ }).click();
    await expect.element(s.getByRole('button', { name: /Join workspace/ })).toBeVisible();
    await s.getByRole('button', { name: 'Back' }).click();
    // Restore instead: the phrase I already have, and a name typed on this step.
    const phrase = newRecoveryPhrase();
    await s.getByRole('button', { name: 'I have a recovery phrase' }).click();
    await s.getByRole('textbox', { name: 'Recovery phrase' }).fill('  ' + phrase.toUpperCase() + '  ');
    await page.getByRole('textbox', { name: 'Display name' }).fill('Ada Restored');
    await s.getByRole('button', { name: 'Restore identity' }).click();
    await until(() => useApp.getState().identity?.pub === keyFromPhrase(phrase).pub);
    await until(() => useApp.getState().workspaces.some((w) => w.code === code));
    await until(() => useApp.getState().route.ch === 'general');
    expect(useApp.getState().identity?.name).toBe('Ada Restored');
  });
});

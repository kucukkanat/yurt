import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { JoinClient, keyFromPhrase, newRecoveryPhrase, parseInvite, isJoinInvite, type JoinInvite, type KeyPair } from '@yurt/protocol';
import { createWorkspace, expectText, getPeer, member, startApp, until, useApp } from '../app';

const panel = (name: string) => page.getByRole('complementary', { name });
const key = () => keyFromPhrase(newRecoveryPhrase());

/** Someone with the link asks to join, like the app does; resolves with the key once an admin lets them in. */
function ask(invite: JoinInvite, kp: KeyPair, name: string): { granted: () => string | null; client: JoinClient } {
  let got: string | null = null;
  const client = new JoinClient({ invite, kp, who: { name, handle: name.toLowerCase() }, onGranted: (k) => (got = k), retryMs: 100 });
  return { granted: () => got, client };
}

describe('letting people in', () => {
  it('makes an invite link that carries no key, and lets the admin answer requests', async () => {
    await startApp({ as: 'Ada' });
    const code = await createWorkspace('Door');
    useApp.getState().setDialog('invite');
    await page.getByTestId('invite-create').click();
    const field = page.getByTestId('invite-link');
    await expect.element(field).toBeVisible();
    const link = (field.element() as HTMLInputElement).value;
    expect(link).toContain('/j/');
    expect(link).not.toContain(useApp.getState().workspaces[0]?.transport.key);
    const invite = parseInvite(link);
    if (!invite || !isJoinInvite(invite)) throw new Error('not a join link');
    useApp.getState().setDialog(null);

    // Cy asks; I'm told, review, and turn Cy away.
    const cy = ask(invite, key(), 'Cy');
    await expect.element(page.getByTestId('join-toast')).toBeVisible();
    await page.getByTestId('join-toast').getByRole('button', { name: 'Review' }).click();
    await expectText(panel('Members').getByTestId('join-request'), /Cy/);
    await panel('Members').getByTestId('join-decline').click();
    await expect.element(panel('Members').getByTestId('join-requests')).not.toBeInTheDocument();
    cy.client.leave();
    expect(cy.granted()).toBeNull();

    // Di asks and is let in: Di gets the workspace key.
    const di = ask(invite, key(), 'Di');
    await expectText(panel('Members').getByTestId('join-request'), /Di/);
    await panel('Members').getByTestId('join-admit').click();
    await until(() => di.granted() !== null);
    expect(di.granted()).toBe(getPeer(code)?.inviteKey);

    // Answering someone who never asked says why it didn't work.
    useApp.getState().admit(code, key().pub, true);
    await expect.element(page.getByText('Couldn’t let them in')).toBeVisible();
    useApp.getState().admit(code, key().pub, false);
    await expect.element(page.getByText('Couldn’t turn them away')).toBeVisible();
  });

  it('lists other members’ open links for an admin to revoke, and revokes my own', async () => {
    const code = useApp.getState().route.code ?? '';
    const bo = await member(code, 'Bo');
    bo.publish({ t: 'invite', b: { jk: 'B'.repeat(43), on: true } });
    await until(() => !!useApp.getState().states[code]?.invites.has('B'.repeat(43)));
    useApp.getState().openSettings('ws-general');
    await expectText(page.getByTestId('invite-others'), /By Bo · never expires/);
    await page.getByTestId('invite-revoke-other').click();
    await expect.element(page.getByTestId('invite-others')).not.toBeInTheDocument();
    await page.getByTestId('invite-revoke').click();
    await expect.element(page.getByTestId('invite-create')).toBeVisible();
  });

  it('rotates the key after a second click', async () => {
    const code = useApp.getState().route.code ?? '';
    const before = getPeer(code)?.inviteKey;
    await page.getByTestId('rotate-key').click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByTestId('rotate-key').click();
    await page.getByTestId('rotate-key-confirm').click();
    await expect.element(page.getByTestId('rotated')).toBeVisible();
    await until(() => getPeer(code)?.inviteKey !== before);
    useApp.getState().setDialog(null);
    // A workspace this device isn't in: nothing to rotate or answer, and it says so.
    expect(useApp.getState().rotateKey('NOSUCHWS')).toBe(false);
    await expect.element(page.getByText('The key wasn’t rotated')).toBeVisible();
  });
});

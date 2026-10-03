import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { formatCode, inviteHash, keyFromPhrase, newInviteCode, newNostrTransport, newRecoveryPhrase, type BridgeState } from '@yurt/protocol';
import { createWorkspace, expectText, getPeer, me, member, relayUrl, startApp, until, useApp } from '../app';

const panel = (name: string) => page.getByRole('complementary', { name });
const agentBody = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, handle: id, runtime: 'copilot', replyIn: 'thread', ...extra });

describe('being a member of someone else’s workspace', () => {
  it('joins a workspace whose name hasn’t arrived, from a link without its creator', async () => {
    await startApp({ as: 'Ada' });
    const code = newInviteCode();
    const transport = newNostrTransport([relayUrl()]);
    // Bo's workspace, with a channel but no ws.create (so no name) yet.
    const bo = await member(code, 'Bo', undefined, { transport, creator: null });
    bo.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    await useApp.getState().joinWorkspace(inviteHash({ code, transport }));
    await until(() => !!useApp.getState().states[code]?.channels.has('general'));
    await until(() => useApp.getState().route.ch === 'general');
    const fallback = formatCode(code);
    await page.getByTestId('ws-menu-button').click();
    await page.getByTestId('ws-menu').getByRole('button', { name: 'Invite people' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Invite to ' + fallback })).toBeVisible();
    // No creator known: no link to check answers against yet.
    await expect.element(page.getByText('Invite links appear once the workspace has synced.')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    useApp.getState().openSettings('ws-general');
    await expect.element(page.getByRole('heading', { name: fallback + ' · General' })).toBeVisible();
    await page.getByTestId('settings-nav-ws-agents').click();
    const bs = { version: '1', agents: [{ id: 'scout', name: 'Scout', handle: 'scout', runtime: 'copilot', status: 'idle' }], workspaces: [] };
    useApp.setState({ bridgeStatus: 'connected', bridgeState: bs as unknown as BridgeState });
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('checkbox', { name: 'Scout' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.element(page.getByText('1 agent joins', { exact: true })).toBeVisible();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('checkbox', { name: 'Scout' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.element(page.getByText('Agents removed from', { exact: true })).toBeVisible();
    useApp.setState({ bridgeStatus: 'missing', bridgeState: null });
    await userEvent.keyboard('{Escape}');
    // Others' agents: one working right now, one whose owner never published a profile.
    const boBridge = await member(code, 'bo-bridge', bo.who, { profile: false });
    boBridge.publish({ t: 'agent', b: agentBody('scout', 'Scout') });
    boBridge.setPresence({ st: 'online', bridge: true, agents: { scout: { working: 'general' } } });
    const anon = await member(code, 'anon', keyFromPhrase(newRecoveryPhrase()), { profile: false });
    anon.publish({ t: 'agent', b: agentBody('ghost', 'Ghost', { discoverable: true }) });
    await until(() => useApp.getState().states[code]?.agents.size === 2);
    await page.getByRole('button', { name: /^Members: / }).click();
    await expect.element(panel('Members').getByText('Bo’s · working')).toBeVisible();
    await expect.element(panel('Members').getByText('Creator')).not.toBeInTheDocument(); // no creator known
    useApp.getState().setDialog('jump');
    await page.getByRole('textbox', { name: 'Jump to' }).fill('ghost');
    await expect.element(page.getByRole('option', { name: /Someone’s agent · discoverable/ })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    // Bo steps away: his profile says so.
    bo.setPresence({ st: 'away' });
    useApp.getState().setPanel({ type: 'profile', id: bo.who.pub });
    await expectText(panel('Profile'), /@bo · Away/);
  });

  it('closes what only makes sense inside a conversation when the route moves away', async () => {
    const code = useApp.getState().route.code ?? '';
    useApp.getState().setPanel({ type: 'pinned' });
    useApp.getState().go({ code }); // no channel for a moment (then #general again)
    await until(() => useApp.getState().route.ch === 'general');
    await page.getByTestId('channel-settings').click();
    useApp.getState().go({ code }); // the channel settings dialog has no channel to show
    await until(() => useApp.getState().route.ch === 'general');
    useApp.getState().setDialog(null);
    useApp.getState().setDialog('invite');
    useApp.getState().go({}); // leaving the workspace route empties the invite dialog
    await until(() => !useApp.getState().route.code);
    useApp.getState().setDialog(null);
    useApp.getState().openSettings('ws-general');
    useApp.getState().go({ code });
    await until(() => useApp.getState().route.code === code);
    useApp.getState().openSettings('ws-general');
    useApp.getState().go({}); // the workspace sections disappear; the window falls back to Profile
    await expect.element(page.getByTestId('settings-section-profile')).toBeVisible();
    await page.getByTestId('settings-nav-connection').click();
    await expect.element(page.getByText('These apply to every workspace on this device.', { exact: true })).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });

  it('as an admin with an outdated invite: locked out, and a ban can’t rotate the key', async () => {
    const code = newInviteCode();
    const transport = newNostrTransport([relayUrl()]);
    const bo = await member(code, 'Bo', undefined, { transport, creator: null });
    bo.publish({ t: 'ws.create', b: { name: 'Bo’s place' } });
    bo.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    bo.publish({ t: 'role', b: { target: me().pub, admin: true } });
    const dee = await member(code, 'Dee', undefined, { transport, creator: bo.who.pub });
    await until(() => dee.state.profiles.size === 2);
    const oldInvite = inviteHash({ code, transport, creator: bo.who.pub });
    bo.rotate(); // without me: I'm not a member yet
    await useApp.getState().joinWorkspace(oldInvite);
    await until(() => !!getPeer(code)?.lockedOut, 15_000);
    await until(() => useApp.getState().route.ch === 'general');
    await expect.element(page.getByTestId('removed-banner')).toBeVisible();
    // I'm an admin there: Members lists me as one.
    await page.getByRole('button', { name: /^Members: / }).click();
    await expect.element(panel('Members').getByText('Admin', { exact: true })).toBeVisible();
    useApp.getState().setPanel({ type: 'profile', id: dee.who.pub });
    await page.getByTestId('ban-button').click();
    await page.getByTestId('ban-confirm').click();
    await expect.element(page.getByText('Banned, but the key wasn’t rotated')).toBeVisible();
    await expect.element(page.getByText('This device no longer holds the current workspace key.')).toBeVisible();
  });

  it('shows a placeholder initial for a workspace named without letters', async () => {
    await createWorkspace('-');
    await expect.element(page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: '-', exact: true })).toHaveTextContent('Y');
  });
});

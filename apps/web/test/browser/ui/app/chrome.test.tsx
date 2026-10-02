import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { inviteHash, type BridgeState, type WsTransport } from '@yurt/protocol';
import { createWorkspace, expectText, me, member, startApp, until, useApp } from '../app';

let code = '';
let other = '';
let bo: Awaited<ReturnType<typeof member>>;
const state = () => useApp.getState().states[code];
const sidebar = () => page.getByRole('complementary', { name: 'Workspace' });
const rail = () => page.getByRole('navigation', { name: 'Workspaces' });
const convs = () => page.getByRole('navigation', { name: 'Channels and messages' });
const agentBody = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, handle: id, runtime: 'copilot', replyIn: 'thread', ...extra });

describe('the app chrome', () => {
  it('creates and joins workspaces from the rail', async () => {
    await startApp({ as: 'Ada' });
    code = await createWorkspace('Northwind');
    await rail().getByRole('button', { name: 'Create or join a workspace' }).click();
    const dlg = page.getByRole('dialog', { name: 'Create or join a workspace' });
    await dlg.getByRole('textbox', { name: 'Workspace name' }).fill('Side Project');
    await dlg.getByRole('button', { name: 'Create workspace' }).click();
    await expect.element(dlg).not.toBeInTheDocument();
    // From the list, not the route: the route follows `hashchange`, which a slow machine delivers after the dialog closes.
    other = useApp.getState().workspaces.find((w) => w.name === 'Side Project')?.code ?? '';
    expect(other).not.toBe('');
    await until(() => useApp.getState().route.code === other);
    // Joining by link from the same dialog.
    await rail().getByRole('button', { name: 'Create or join a workspace' }).click();
    await dlg.getByRole('tab', { name: 'Join with a link' }).click();
    const t = useApp.getState().workspaces.find((w) => w.code === code)?.transport as WsTransport & { key: string };
    await dlg.getByTestId('join-link').fill(location.origin + location.pathname + inviteHash({ code, transport: t }));
    await dlg.getByRole('button', { name: 'Join workspace' }).click();
    await expect.element(dlg).not.toBeInTheDocument();
    await until(() => useApp.getState().route.code === code);
  });

  it('marks unread messages and mentions on other workspaces’ rail buttons', async () => {
    bo = await member(code, 'Bo');
    useApp.getState().go({ code: other, ch: 'general' });
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'quiet news' } });
    await expect.element(rail().getByRole('button', { name: 'Northwind', exact: true })).toBeVisible();
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'ping @ada' } });
    await expect.element(rail().getByRole('button', { name: 'Northwind, 1 mentions' })).toBeVisible();
    await rail().getByRole('button', { name: 'Northwind, 1 mentions' }).click();
    await until(() => useApp.getState().route.code === code);
  });

  it('bolds unread channels with mention badges, and sets how much a conversation alerts', async () => {
    await createChannel('random', 'Off topic');
    useApp.getState().go({ code, ch: 'general' });
    await bo.say({ t: 'msg', ch: 'random', b: { text: 'in random' } });
    await bo.say({ t: 'msg', ch: 'random', b: { text: 'hey @ada' } });
    const random = convs().getByRole('button', { name: /random/ });
    await expectText(random, /random1/);
    // Set it to alert nothing from its settings: no bold or badge.
    useApp.getState().go({ code, ch: 'random' });
    await page.getByTestId('channel-settings').click();
    const dlg = page.getByRole('dialog', { name: '#random' });
    await expect.element(dlg.getByTestId('alert-level-mentions')).toBeChecked(); // a channel's default
    await dlg.getByTestId('alert-level-none').click();
    await dlg.getByRole('textbox', { name: 'Name' }).fill('Random Talk');
    await expect.element(dlg.getByRole('textbox', { name: 'Name' })).toHaveValue('random-talk');
    await dlg.getByRole('textbox', { name: 'Topic' }).fill('Anything goes');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await until(() => state()?.channels.get('random')?.name === 'random-talk');
    await expect.element(page.getByTestId('quiet-mark')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Notifications: Nothing' })).toBeVisible();
    await expect.element(page.getByText('Anything goes')).toBeVisible();
    useApp.getState().go({ code, ch: 'general' });
    await bo.say({ t: 'msg', ch: 'random', b: { text: 'muted ping @ada' } });
    await expect
      .poll(() =>
        convs()
          .getByRole('button', { name: /random-talk/ })
          .element()
          .textContent?.trim(),
      )
      .toBe('random-talk');
    // Settings with an empty name keep the old one; Cancel changes nothing.
    useApp.getState().go({ code, ch: 'random' });
    await page.getByTestId('channel-settings').click();
    const renamed = page.getByRole('dialog', { name: '#random-talk' });
    await renamed.getByRole('textbox', { name: 'Name' }).fill('');
    await renamed.getByRole('button', { name: 'Save' }).click();
    await page.getByTestId('channel-settings').click();
    await page.getByRole('dialog', { name: '#random-talk' }).getByRole('button', { name: 'Cancel' }).click();
    // In a DM there's no channel to set up: the dialog doesn't open.
    useApp.getState().go({ code, ch: 'dm:' + [me().pub, bo.who.pub].sort().join(':') });
    useApp.getState().setDialog('channelSettings');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    useApp.getState().setDialog(null);
    // A DM alerts on every message by default; from its header's bell it can alert on mentions only: still bold, no badge.
    const dm = 'dm:' + [me().pub, bo.who.pub].sort().join(':');
    await page.getByTestId('alerts-button').click();
    const alerts = page.getByRole('dialog', { name: 'Notifications' });
    await expect.element(alerts.getByText('Bo', { exact: true })).toBeVisible();
    await expect.element(alerts.getByTestId('alert-level-all')).toBeChecked();
    await alerts.getByTestId('alert-level-mentions').click();
    await until(() => state()?.levels.get(me().pub)?.get(dm) === 'mentions');
    await alerts.getByTestId('alerts-done').click();
    await expect.element(alerts).not.toBeInTheDocument();
    useApp.getState().go({ code, ch: 'general' });
    await bo.say({ t: 'msg', ch: dm, to: me().pub, b: { text: 'no rush' } });
    const dmRow = convs().getByRole('button', { name: /^Bo/ });
    await expect.poll(() => getComputedStyle(dmRow.getByText('Bo', { exact: true }).element()).fontWeight).toBe('700');
    expect(dmRow.element().textContent).not.toMatch(/\d/); // bold, but no badge
    // The dialog has nothing to show outside a conversation.
    useApp.setState({ route: { code } });
    useApp.getState().setDialog('alerts');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    useApp.getState().setDialog(null);
    useApp.getState().go({ code, ch: 'general' });
  });

  it('opens everything from the workspace menu and the mode chip', async () => {
    const menuButton = page.getByTestId('ws-menu-button');
    await menuButton.click();
    await expectText(page.getByTestId('ws-online'), /1 other member online/);
    await page.getByTestId('ws-menu').getByRole('button', { name: 'Invite people' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Invite to Northwind' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await menuButton.click();
    await page.getByTestId('ws-menu').getByRole('button', { name: 'New channel' }).click();
    await expect.element(page.getByRole('dialog', { name: 'New channel' })).toBeVisible();
    await page.getByRole('dialog', { name: 'New channel' }).getByRole('button', { name: 'Cancel' }).click();
    const shortcuts: [string, string][] = [
      ['menu-settings', 'ws-general'],
      ['menu-connection', 'ws-network'],
      ['menu-leave', 'ws-general'],
    ];
    for (const [id, section] of shortcuts) {
      await menuButton.click();
      await page.getByTestId(id).click();
      await expect.element(page.getByTestId('settings-section-' + section)).toBeVisible();
      await userEvent.keyboard('{Escape}');
    }
    await menuButton.click();
    await menuButton.click(); // its own toggle closes it
    await expect.element(page.getByTestId('ws-menu')).not.toBeInTheDocument();
    await menuButton.click();
    await page.getByTestId('ws-menu').hover();
    await page.getByRole('main').hover(); // the pointer leaving closes it too
    await expect.element(page.getByTestId('ws-menu')).not.toBeInTheDocument();
    const cy = await member(code, 'Cy');
    await menuButton.click();
    await expectText(page.getByTestId('ws-online'), /2 other members online/);
    await menuButton.click();
    cy.leave();
  });

  it('adds from the section headers and opens your profile and the bridge from the bottom', async () => {
    await sidebar().getByRole('button', { name: 'New channel' }).click();
    await expect.element(page.getByRole('dialog', { name: 'New channel' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await sidebar().getByRole('button', { name: 'New direct message' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Jump to' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await sidebar().getByRole('button', { name: 'Add agent' }).click();
    await expect.element(page.getByTestId('settings-section-ws-agents')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await sidebar()
      .getByRole('button', { name: /^Local agent daemon: Agents off/ })
      .click();
    await expect.element(page.getByTestId('bridge-section')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    // The daemon line follows the bridge.
    useApp.setState({ bridgeStatus: 'connecting' });
    await expect.element(sidebar().getByRole('button', { name: 'Local agent daemon: Looking for bridge' })).toBeVisible();
    const bs = (n: number) => ({ version: '0.3.0', agents: Array.from({ length: n }, (_, i) => ({ id: 'a' + i })), workspaces: [] }) as unknown as BridgeState;
    useApp.setState({ bridgeStatus: 'connected', bridgeState: bs(1) });
    await expectText(sidebar().getByRole('button', { name: /^Local agent daemon: Agents ready/ }), /1 agent/);
    useApp.setState({ bridgeState: bs(2) });
    await expectText(sidebar().getByRole('button', { name: /^Local agent daemon: Agents ready/ }), /2 agents/);
    useApp.setState({ bridgeStatus: 'missing', bridgeState: null });
    await page.getByTestId('me-row').click();
    await expect.element(page.getByTestId('settings-section-profile')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await rail().getByTestId('settings-button').click();
    await expect.element(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });

  it('jumps anywhere with ⌘K: channels, people, agents and other workspaces', async () => {
    bo.publish({ t: 'agent', b: agentBody('scout', 'Scout') });
    bo.publish({ t: 'agent', b: agentBody('harvey', 'Harvey', { discoverable: true }) });
    const mine = await member(code, 'bridge', me(), { profile: false });
    mine.publish({ t: 'agent', b: agentBody('mine', 'Mine') });
    await until(() => state()?.agents.size === 3);
    await page.getByRole('button', { name: /Jump to…/ }).click();
    const box = page.getByRole('textbox', { name: 'Jump to' });
    const results = page.getByRole('listbox', { name: 'Results' });
    await expectText(results, /general/);
    await expectText(results, /Ada \(you\)/);
    await expectText(results, /Your agent · private chat/);
    await expectText(results, /Bo’s agent · discoverable/);
    await expectText(results, /Workspace · /);
    expect(results.element().textContent ?? '').not.toContain('Scout');
    await box.fill('zzz');
    await expect.element(page.getByText('No match for “zzz”.')).toBeVisible();
    await userEvent.keyboard('{Enter}'); // nothing to choose
    await box.fill('anything goes'); // matches a channel's topic
    await expect.element(results.getByRole('option', { name: /random-talk/ })).toBeVisible();
    await box.fill('o');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{ArrowUp}{ArrowUp}');
    await results.getByRole('option').nth(1).hover();
    await expect.element(results.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    for (let i = 0; i < 20; i++) await userEvent.keyboard('{ArrowDown}'); // stops at the last
    await box.fill('bo');
    await userEvent.keyboard('{Enter}');
    await until(() => useApp.getState().route.ch?.startsWith('dm:') === true);
    await page.getByRole('button', { name: /Jump to…/ }).click();
    await box.fill('harvey');
    await results.getByRole('option', { name: /Harvey/ }).click();
    await until(() => useApp.getState().route.ch?.startsWith('gdm:') === true);
    await page.getByRole('button', { name: /Jump to…/ }).click();
    await box.fill('mine');
    await userEvent.keyboard('{Enter}');
    await until(() => useApp.getState().route.ch?.startsWith('adm:') === true);
    await page.getByRole('button', { name: /Jump to…/ }).click();
    await box.fill('side');
    await userEvent.keyboard('{Enter}');
    await until(() => useApp.getState().route.code === other);
    // Outside a workspace, only workspaces are listed.
    useApp.getState().go({});
    useApp.getState().setDialog('jump');
    await expect.element(results.getByRole('option', { name: /Northwind/ })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    useApp.getState().go({ code, ch: 'general' });
  });

  it('lays out for a narrow screen', async () => {
    await page.viewport(400, 800);
    await expect.element(rail()).not.toBeInTheDocument();
    await page.getByRole('main').getByRole('button', { name: 'Open sidebar' }).click();
    await expect.element(rail()).toBeVisible();
    await page.getByRole('button', { name: 'Close sidebar' }).click({ position: { x: 380, y: 400 } }); // beside the drawer
    await expect.element(rail()).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Add agent' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await page.getByRole('button', { name: /^Members: / }).click();
    await expect.element(page.getByRole('complementary', { name: 'Members' })).toBeVisible();
    await page.getByRole('complementary', { name: 'Members' }).getByRole('button', { name: 'Close (Esc)' }).click();
    useApp.getState().go({});
    await expect.element(page.getByRole('main').getByRole('button', { name: 'Open sidebar' })).toBeVisible();
    await page.viewport(1280, 860);
  });
});

async function createChannel(name: string, topic: string) {
  await sidebar().getByRole('button', { name: 'New channel' }).click();
  const dlg = page.getByRole('dialog', { name: 'New channel' });
  await expect.element(dlg.getByRole('button', { name: 'Create channel' })).toBeDisabled();
  await dlg.getByRole('textbox', { name: 'Name' }).fill('Ran Dom');
  await expect.element(dlg.getByRole('textbox', { name: 'Name' })).toHaveValue('ran-dom');
  await dlg.getByRole('textbox', { name: 'Name' }).fill(name);
  await dlg.getByRole('textbox', { name: /^Topic/ }).fill(topic);
  await dlg.getByRole('button', { name: 'Create channel' }).click();
  await until(() => useApp.getState().route.ch === name);
}

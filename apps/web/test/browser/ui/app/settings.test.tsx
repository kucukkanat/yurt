import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { BridgeState } from '@yurt/protocol';
import { bridge } from '../../../../src/lib/bridge';
import { createWorkspace, expectText, getPeer, localNet, relayUrl, startApp, until, useApp } from '../app';

let code = '';
const dlg = () => page.getByRole('dialog', { name: 'Settings' });
const open = (id: string) => page.getByTestId('settings-nav-' + id).click();
const section = (id: string) => page.getByTestId('settings-section-' + id);
const toast = (title: string) => expect.element(page.getByText(title, { exact: true })).toBeVisible();

describe('Settings', () => {
  it('edits the profile', async () => {
    await startApp({ as: 'Ada' });
    code = await createWorkspace('Northwind');
    await page.getByTestId('me-row').click();
    await expect.element(section('profile')).toBeVisible();
    const name = dlg().getByRole('textbox', { name: 'Display name' });
    await name.fill('');
    await expect.element(dlg().getByRole('button', { name: 'Save profile' })).toBeDisabled();
    await name.fill('Ada L');
    await dlg().getByRole('textbox', { name: 'Handle' }).fill('Ada L!');
    await expect.element(dlg().getByRole('textbox', { name: 'Handle' })).toHaveValue('adal');
    await dlg().getByRole('button', { name: 'Save profile' }).click();
    await toast('Profile updated in every workspace');
    await until(() => useApp.getState().identity?.handle === 'adal');
  });

  it('shows the recovery phrase and asks twice before signing out', async () => {
    await open('identity');
    await dlg().getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect.element(dlg().getByText('12.')).toBeVisible();
    await dlg().getByRole('button', { name: 'Copy', exact: true }).click();
    await toast('Couldn’t copy recovery phrase');
    await dlg().getByRole('button', { name: 'Hide phrase' }).click();
    await dlg().getByRole('button', { name: 'Sign out of this device' }).click();
    await expect.element(dlg().getByRole('button', { name: 'Erase this device' })).toBeVisible();
    await dlg().getByRole('button', { name: 'Keep everything' }).click();
    await expect.element(dlg().getByRole('button', { name: 'Sign out of this device' })).toBeVisible();
  });

  it('switches theme and tries notifications', async () => {
    await open('preferences');
    await dlg().getByRole('radio', { name: 'Light' }).click();
    await until(() => document.documentElement.dataset.theme === 'light');
    await dlg().getByRole('radio', { name: 'Dark' }).click();
    await until(() => document.documentElement.dataset.theme === 'dark');
    // This headless Chromium blocks notifications: the switch says so and stays off.
    expect(Notification.permission).toBe('denied');
    await expect.element(dlg().getByRole('switch', { name: 'Notifications' })).toBeDisabled();
    await expect.element(dlg().getByText('Blocked in browser settings for this site.')).toBeVisible();
    // Haptics: on by default, and a switch away.
    const haptics = dlg().getByRole('switch', { name: 'Haptic feedback' });
    await expect.element(haptics).toBeChecked();
    await haptics.click();
    await until(() => !useApp.getState().settings.haptics);
    await haptics.click();
    // Sound: on by default, and a switch away.
    const sound = dlg().getByRole('switch', { name: 'Sound', exact: true });
    await expect.element(sound).toBeChecked();
    await sound.click();
    await until(() => !useApp.getState().settings.sound);
    await sound.click();
  });

  it('explains installing', async () => {
    await open('app');
    // A desktop browser tab that hasn't offered installing: the browser's menu does it.
    await expect.element(page.getByTestId('app-install-menu')).toBeVisible();
    useApp.setState({ installable: true }); // the browser offered it
    await page.getByTestId('app-install').click(); // the offer was already used up elsewhere: nothing happens
    useApp.setState({ installable: false });
  });

  it('saves calls and TURN for this device, reconnecting what needs it', async () => {
    await open('connection');
    await expect.element(section('connection').getByText(/This workspace’s own relays and file servers/)).toBeVisible();
    const save = page.getByTestId('network-save');
    await expect.element(save).toBeDisabled();
    await page.getByTestId('turn-custom').click();
    await page.getByTestId('turn-urls').fill('turn:turn.example.com:3478');
    await page.getByTestId('turn-user').fill('u');
    await page.getByTestId('turn-pass').fill('p');
    await page.getByTestId('turn-default').click();
    await page.getByTestId('turn-off').click();
    await page.getByTestId('webrtc-switch').click();
    const before = getPeer(code);
    await save.click();
    await toast('Connection settings saved');
    await expect.element(page.getByText('Reconnected 1 workspace.')).toBeVisible();
    expect(getPeer(code)).not.toBe(before);
    // Two relay workspaces both reconnect for the calls switch.
    await useApp.getState().createWorkspace('Second', localNet());
    useApp.getState().go({ code });
    useApp.getState().openSettings('connection');
    await page.getByTestId('webrtc-switch').click();
    await save.click();
    await expect.element(page.getByText('Reconnected 2 workspaces.')).toBeVisible();
    // TURN alone touches no relay workspace while calls are off.
    await page.getByTestId('turn-default').click();
    await save.click();
    await expect.poll(() => page.getByText('Connection settings saved', { exact: true }).elements().length).toBeGreaterThan(0);
  });

  it('walks through bridge setup: install steps, pairing, and a connected bridge', async () => {
    await open('agents');
    await expect.element(page.getByTestId('bridge-install')).toBeVisible();
    await dlg().getByRole('button', { name: 'Copy', exact: true }).click();
    await toast('Couldn’t copy command');
    // The bridge answered but this browser isn't paired yet.
    useApp.setState({ bridgeStatus: 'unpaired' });
    const pin = dlg().getByRole('textbox', { name: 'Pairing code' });
    await expect.element(pin).toBeVisible();
    await expect.element(dlg().getByRole('button', { name: 'Pair' })).toBeDisabled();
    await pin.fill('123 45');
    await expect.element(dlg().getByRole('button', { name: 'Pair' })).toBeDisabled();
    await pin.fill('123 456');
    bridge.pairTimeoutMs = 300; // the real pairing timeout, ticking fast
    await dlg().getByRole('button', { name: 'Pair' }).click(); // no bridge socket open here: the attempt times out
    await expect.element(dlg().getByText('That code didn’t match. Check the bridge page for the current one.')).toBeVisible();
    // Connected: version and agents, and a way to forget it.
    const bs: BridgeState = {
      version: '0.1.0',
      agents: [
        {
          id: 'scout',
          name: 'Scout',
          handle: 'scout',
          runtime: 'copilot',
          model: 'gpt-5',
          workdir: '/w',
          instructions: '',
          autoApprove: [],
          contextSize: 20,
          respondTo: { mentions: true, replies: false },
          postIn: { thread: true, channel: false },
          discoverable: false,
          status: 'idle',
        },
      ],
      workspaces: [{ code, name: 'Northwind', agents: ['scout'] }],
    } as unknown as BridgeState;
    useApp.setState({ bridgeStatus: 'connected', bridgeState: bs });
    await expectText(page.getByTestId('bridge-status'), /yurt-bridge 0\.1\.0 on this machine · 1 agent/);
    await page.getByTestId('bridge-forget').click();
    await until(() => useApp.getState().bridgeStatus === 'off');
    // Back to 'missing' before any bridge section mounts again: 'off' makes it dial 127.0.0.1:7717 (the user's own bridge).
    useApp.setState({ bridgeStatus: 'missing' });
    await expect.element(page.getByTestId('bridge-install')).toBeVisible();
  });

  it('shows the workspace: name, invite, and a two-step leave', async () => {
    await open('ws-general');
    await expect.element(page.getByTestId('invite-link')).toBeVisible();
    // Where the browser has a share sheet, the link can go straight to it. (Not pressed here: opening the system sheet
    // brings headless Chromium down on macOS.)
    await expect.element(page.getByTestId('invite-share')).toBeVisible();
    await page.getByTestId('ws-leave').click();
    await dlg().getByRole('button', { name: 'Stay' }).click();
    await expect.element(page.getByTestId('ws-leave')).toBeVisible();
  });

  it('edits relays and file servers, with status per relay and validation', async () => {
    await open('ws-network');
    const relayState = (url: string) => () => document.querySelector('[data-relay="' + url + '"]')?.getAttribute('data-connected');
    await expect.poll(relayState(relayUrl())).toBe('true');
    const relays = page.getByTestId('connection-relays');
    await relays.fill('nope');
    await page.getByTestId('connection-blossom').fill('ftp://x');
    await page.getByTestId('connection-save').click();
    await expect.element(dlg().getByText('Not a ws:// or wss:// relay: nope')).toBeVisible();
    await expect.element(dlg().getByText('Not an http(s) server: ftp://x')).toBeVisible();
    await relays.fill('');
    await page.getByTestId('connection-save').click();
    await expect.element(dlg().getByText('Add at least one ws:// or wss:// relay.')).toBeVisible();
    await relays.fill(relayUrl() + ', ws://127.0.0.1:9');
    await page.getByTestId('connection-blossom').fill('');
    await page.getByTestId('connection-save').click();
    await toast('Network settings saved');
    // Poll-refreshed status: the unreachable relay shows as disconnected.
    await expect.poll(relayState('ws://127.0.0.1:9')).toBe('false');
    await relays.fill(relayUrl());
    await page.getByTestId('connection-save').click();
    await dlg()
      .getByRole('button', { name: /Calls and TURN on this device/ })
      .click();
    await expect.element(section('connection')).toBeVisible();
  });

  it('picks which bridge agents join this workspace', async () => {
    await open('ws-agents');
    await expect.element(page.getByTestId('ws-agents-nobridge')).toBeVisible();
    const agent = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
      id,
      name,
      handle: id,
      runtime: 'copilot',
      workdir: '/w',
      instructions: '',
      autoApprove: [],
      contextSize: 20,
      respondTo: { mentions: true, replies: true },
      postIn: { thread: true, channel: true },
      discoverable: true,
      status: 'idle',
      ...extra,
    });
    const bs = { version: '0.2.0', agents: [agent('scout', 'Scout', { model: 'gpt-5' }), agent('rex', 'Rex')], workspaces: [{ code, name: 'Northwind', agents: ['scout'] }] };
    useApp.setState({ bridgeStatus: 'connected', bridgeState: bs as unknown as BridgeState });
    await expectText(dlg(), /copilot · gpt-5 · answers @mentions and replies · posts in thread \+ channel · discoverable/);
    await expect.element(dlg().getByRole('checkbox', { name: 'Scout' })).toBeChecked();
    await dlg().getByRole('checkbox', { name: 'Rex' }).click();
    await dlg().getByRole('button', { name: 'Save', exact: true }).click();
    await toast('2 agents join Northwind');
    await dlg().getByRole('checkbox', { name: 'Rex' }).click();
    await dlg().getByRole('button', { name: 'Save', exact: true }).click();
    await toast('1 agent joins Northwind');
    await dlg().getByRole('checkbox', { name: 'Scout' }).click();
    await dlg().getByRole('button', { name: 'Save', exact: true }).click();
    await toast('Agents removed from Northwind');
    // The bridge saved a new list (e.g. from another device): unsaved picks follow it.
    useApp.setState({ bridgeState: { ...bs, workspaces: [{ code, name: 'Northwind', agents: ['rex'] }] } as unknown as BridgeState });
    await expect.element(dlg().getByRole('checkbox', { name: 'Rex' })).toBeChecked();
    useApp.setState({ bridgeState: { ...bs, agents: [] } as unknown as BridgeState });
    await expect.element(dlg().getByText(/No agents yet/)).toBeVisible();
  });

  it('leaves the workspace', async () => {
    await open('ws-general');
    await page.getByTestId('ws-leave').click();
    await page.getByTestId('ws-leave-confirm').click();
    await until(() => !useApp.getState().workspaces.some((w) => w.code === code));
    await expect.element(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
  });
});

describe('Settings outside a workspace and on a narrow screen', () => {
  it('lists sections first, then one section with a way back', async () => {
    await page.viewport(400, 800);
    useApp.getState().openSettings('ws-network'); // no workspace open: falls back to Profile
    await expect.element(page.getByTestId('settings-nav-profile')).toBeVisible();
    await expect.element(page.getByTestId('settings-nav-ws-general')).not.toBeInTheDocument();
    await page.getByTestId('settings-nav-preferences').click();
    await expect.element(section('preferences')).toBeVisible();
    await page.getByTestId('settings-back').click();
    await expect.element(page.getByTestId('settings-nav-identity')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    useApp.getState().openSettings('app'); // asked for by name (the install hint's "How"): straight there
    await expect.element(section('app')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await page.viewport(1280, 860);
  });
});

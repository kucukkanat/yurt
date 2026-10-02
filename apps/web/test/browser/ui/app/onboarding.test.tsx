import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { inviteHash, newInviteCode, newNostrTransport, newRecoveryPhrase } from '@yurt/protocol';
import { blossomUrl, expectText, relayUrl, startApp, until, useApp } from '../app';

describe('onboarding, then the home screen', () => {
  it('asks for a name, offers restore, shows the phrase, and creates the identity', async () => {
    const s = await startApp();
    await expect.element(s.getByRole('heading', { name: 'Team chat with no server in the middle.' })).toBeVisible();
    await s.getByRole('button', { name: /Continue/ }).click();
    await expect.element(s.getByText('Tell people who you are.')).toBeVisible();

    // Restore: a bad phrase, then a good one without a name; back to the start.
    await s.getByRole('button', { name: 'I have a recovery phrase' }).click();
    await expect.element(s.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await expect.element(s.getByRole('textbox', { name: 'Recovery phrase' })).toHaveFocus();
    await s.getByRole('textbox', { name: 'Recovery phrase' }).fill('not twelve words');
    await s.getByRole('button', { name: 'Restore identity' }).click();
    await expectText(s.getByRole('alert'), /That isn’t a valid 12-word phrase/);
    await s.getByRole('textbox', { name: 'Recovery phrase' }).fill(newRecoveryPhrase());
    await s.getByRole('button', { name: 'Restore identity' }).click();
    await expect.element(s.getByRole('alert')).toHaveTextContent('Add your display name too.');
    await s.getByRole('button', { name: 'Back' }).click();

    // The handle follows the name until edited; a new key changes the fingerprint.
    await s.getByRole('textbox', { name: 'Display name' }).fill('Ada Lovelace');
    await expect.element(s.getByRole('textbox', { name: 'Handle' })).toHaveValue('ada-lovelace');
    await s.getByRole('textbox', { name: 'Handle' }).fill('Ada!');
    await expect.element(s.getByRole('textbox', { name: 'Handle' })).toHaveValue('ada');
    const before = s.container.textContent;
    await s.getByRole('button', { name: 'Make a new key' }).click();
    await expect.poll(() => s.container.textContent).not.toBe(before);

    // The phrase: twelve words, copy, back and forward, then confirm saved.
    await s.getByRole('button', { name: /Continue/ }).click();
    await expect.element(s.getByRole('heading', { name: 'Save these 12 words.' })).toBeVisible();
    expect(s.getByRole('listitem').elements()).toHaveLength(12);
    // Headless Chromium grants no clipboard permission: the failure is reported, not swallowed.
    await s.getByRole('button', { name: 'Copy phrase' }).click();
    await expect.element(s.getByText('Couldn’t copy recovery phrase')).toBeVisible();
    await s.getByRole('button', { name: 'Back' }).click();
    await s.getByRole('button', { name: /Continue/ }).click();
    const start = s.getByRole('button', { name: /Start chatting/ });
    await expect.element(start).toBeDisabled();
    await s.getByRole('checkbox', { name: 'I saved my recovery phrase somewhere safe' }).click();
    await start.click();
    await expect.element(s.getByRole('heading', { name: 'Start your first workspace.' })).toBeVisible();
    expect(useApp.getState().identity).toMatchObject({ name: 'Ada Lovelace', handle: 'ada' });
  });

  it('checks the create form and opens its network settings', async () => {
    await expect.element(page.getByRole('tablist', { name: 'Create or join' })).toBeVisible();
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect.element(page.getByText('Give it a name people will recognize.')).toBeVisible();
    await expect.element(page.getByText(/anyone with it can read the history/)).toBeVisible();
    await expectText(page.getByTestId('create-net-summary'), /Relays: wss:\/\/nos\.lol · Files: default servers/);
    // Both fields validate; a bad URL opens the section with an error.
    await page.getByTestId('create-net-toggle').click();
    await page.getByTestId('create-relays').fill('bad');
    await page.getByTestId('create-blossom').fill('ftp://x');
    await page.getByTestId('create-net-toggle').click(); // closed: the error reopens it
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Northwind');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect.element(page.getByText('Not a ws:// or wss:// relay: bad')).toBeVisible();
    await expect.element(page.getByText('Not an http(s) server: ftp://x')).toBeVisible();
    await page.getByTestId('create-relays').fill(relayUrl());
    await page.getByTestId('create-blossom').fill(blossomUrl());
    await expect.element(page.getByTestId('create-net-summary')).toHaveTextContent('Relays: ' + relayUrl() + ' · Files: ' + blossomUrl());
  });

  it('creates the workspace and lands in #general', async () => {
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect.element(page.getByRole('heading', { name: /general/ })).toBeVisible();
    const code = useApp.getState().route.code ?? '';
    expect(useApp.getState().workspaces.find((w) => w.code === code)?.transport).toMatchObject({ relays: [relayUrl()] });
    // The next create form starts from these settings.
    expect(useApp.getState().settings.lastNet).toEqual({ relays: [relayUrl()], blossom: [blossomUrl()] });
  });

  it('lists workspaces at home, joins by link, and explains a link that can’t be joined', async () => {
    useApp.getState().go({});
    await expect.element(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
    await page.getByRole('tab', { name: 'Join with a link' }).click();
    await page.getByTestId('join-link').fill('K7QX2MPD');
    await page.getByRole('button', { name: 'Join workspace' }).click();
    await expect.element(page.getByText(/Paste the whole invite link/)).toBeVisible();
    await page.getByRole('tab', { name: 'Start a workspace' }).click();
    await page.getByRole('tab', { name: 'Join with a link' }).click();
    // Real links to workspaces nobody else is in: the joining screen while history would arrive.
    const lost = inviteHash({ code: newInviteCode(), transport: newNostrTransport(['ws://127.0.0.1:9']) });
    await page.getByTestId('join-link').fill(location.origin + location.pathname + lost);
    await page.getByRole('button', { name: 'Join workspace' }).click();
    await expect.element(page.getByText(/^Fetching /)).toBeVisible();
    await expect.element(page.getByText('Connecting to relays. Keep this tab open; it retries on its own.')).toBeVisible();
    await useApp.getState().joinWorkspace(inviteHash({ code: newInviteCode(), transport: newNostrTransport([relayUrl()]) }));
    await expect.element(page.getByText('Downloading encrypted history from relays.')).toBeVisible();
    // Back home: every workspace is listed; picking one opens it.
    useApp.getState().go({});
    await page
      .getByRole('main')
      .getByRole('button', { name: /Northwind/ })
      .click();
    await until(() => useApp.getState().route.ch === 'general');
    useApp.getState().go({});
    await expect.element(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
    await page.getByRole('button', { name: 'Set up', exact: true }).click();
    await expect.poll(() => [useApp.getState().dialog, useApp.getState().settingsSection]).toEqual(['settings', 'agents']);
    await expect.element(page.getByTestId('bridge-section')).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });
});

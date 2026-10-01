import { test, expect, type Page } from '@playwright/test';
import { createWorkspace, inviteLink, onboard, pointAtLocalRelay, RELAY, BLOSSOM } from './helpers';

test('relay workspace keeps encrypted history for members who join after everyone left', async ({ browser }) => {
  const actx = await browser.newContext();
  const a = await actx.newPage();
  await pointAtLocalRelay(a);
  await onboard(a, 'Ada', 'Start chatting');
  await createWorkspace(a, 'Relay', 'relays');
  await a.getByRole('button', { name: 'Invite people' }).first().click();
  await expect(a.getByRole('button', { name: 'Copy code' })).toHaveCount(0); // relay invites are link-only
  await a.getByTestId('invite-link').press('Escape');
  const link = await inviteLink(a);
  expect(link).toMatch(/#\/w\/[A-Z0-9]{8}\/k\/[A-Za-z0-9_-]{43}\/n\//);

  // Calls need the explicit WebRTC opt-in in relay workspaces.
  await expect(a.getByTestId('huddle-button')).toBeDisabled();

  const composer = a.getByRole('textbox', { name: 'Message #general' });
  await a.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('file kept on blossom') });
  await composer.fill('kept on the relay');
  await composer.press('Enter');
  await expect(a.getByText('kept on the relay')).toBeVisible();
  await expect(a.getByText('Sends when you reconnect')).toHaveCount(0, { timeout: 15_000 });
  await actx.close(); // nobody from the workspace is online any more

  const b = await (await browser.newContext()).newPage();
  await b.goto(link);
  await onboard(b, 'Bo', 'Join workspace');
  await expect(b.getByText('kept on the relay')).toBeVisible({ timeout: 30_000 });
  // The attachment comes from Blossom, decrypted in the browser: nobody who has it is online.
  const download = b.getByRole('link', { name: 'Download notes.txt' });
  await expect(download).toBeVisible({ timeout: 30_000 });
  expect(await download.evaluate((a: HTMLAnchorElement) => fetch(a.href).then((r) => r.text()))).toBe('file kept on blossom');
  await expect(b).not.toHaveURL(/\/k\//); // the key doesn't linger in the address bar
});

test('the WebRTC switch enables calls in relay workspaces', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await pointAtLocalRelay(page);
  await onboard(page, 'Di', 'Start chatting');
  await page.getByLabel('Workspace name').fill('Calls ' + Date.now());
  await page.getByText('Encrypted on Nostr relays').click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByTestId('huddle-button')).toBeDisabled();
  await page.getByTestId('settings-button').click();
  await page.getByTestId('settings-nav-connection').click();
  await page.getByTestId('webrtc-switch').click();
  await page.getByTestId('network-save').click();
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByTestId('huddle-button')).toBeEnabled();
});

test('bare codes and keyless links are refused', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('./#/w/K7QX2MPD');
  await onboard(page, 'Cy', 'Join workspace');
  await expect(page.getByText('This link can’t be joined')).toBeVisible();
  await expect(page).not.toHaveURL(/K7QX2MPD/);
});

async function relayWorkspace(page: Page, who: string) {
  await pointAtLocalRelay(page);
  await onboard(page, who, 'Start chatting');
  await page.getByLabel('Workspace name').fill('Relay ' + Date.now());
  await page.getByText('Encrypted on Nostr relays').click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/#\/w\/[A-Z0-9]{8}\/c\/general/);
}

async function openConnection(page: Page) {
  await page.locator('[aria-haspopup="menu"]').click();
  await page.getByTestId('menu-connection').click();
}

test('one Settings: a single button, "you" sections outside a workspace, device connection without mode tabs', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await pointAtLocalRelay(page);
  await onboard(page, 'Ed', 'Start chatting');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(1);
  await page.getByTestId('settings-button').click();
  // Not in a workspace: only the "you" group.
  for (const id of ['profile', 'identity', 'preferences', 'connection', 'agents']) await expect(page.getByTestId('settings-nav-' + id)).toBeVisible();
  await expect(page.getByTestId('settings-nav-ws-general')).toHaveCount(0);
  await page.getByTestId('settings-nav-preferences').click();
  await page.getByText('Light', { exact: true }).click();
  await page.getByTestId('settings-nav-connection').click();
  const device = page.getByTestId('network-device');
  await expect(device.getByRole('tab')).toHaveCount(0);
  await expect(device.getByTestId('turn-off')).toBeChecked();
  await expect(device.getByTestId('settings-relays')).toHaveCount(0);
  await device.getByTestId('turn-default').click();
  await page.getByTestId('network-save').click();
  await expect(page.getByText('Connection settings saved')).toBeVisible();
  // Saving the device connection leaves other sections' settings alone.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('settings-nav-agents').click();
  await expect(page.getByTestId('bridge-install')).toBeVisible(); // no bridge runs in the test
});

test('inside a workspace, Settings adds its own group for its mode, and the workspace menu jumps into it', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await relayWorkspace(page, 'Lu');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(1);
  await expect(page.getByTestId('mode-chip').first()).toHaveText('Nostr relays');
  await page.locator('[aria-haspopup="menu"]').click();
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings-section-ws-general')).toBeVisible();
  await expect(page.getByTestId('ws-mode')).toContainText('fixed');
  await expect(page.getByTestId('invite-link')).toHaveValue(/\/k\//);
  await page.getByTestId('settings-nav-ws-network').click();
  await expect(page.getByTestId('connection-kind')).toHaveText('Nostr relays');
  await expect(page.getByTestId('ws-signal')).toHaveCount(0);
  await expect(page.getByTestId('turn-fields')).toHaveCount(0); // device settings live under "you"
  await page.getByTestId('settings-nav-ws-agents').click();
  await expect(page.getByTestId('ws-agents-nobridge')).toBeVisible();
  await page.getByTestId('settings-nav-ws-general').press('Escape');

  // The sidebar's "Add agent" and your own row open the right sections.
  await page.getByRole('button', { name: 'Add agent' }).first().click();
  await expect(page.getByTestId('settings-section-ws-agents')).toBeVisible();
  await page.keyboard.press('Escape'); // like a user: focus is already inside the dialog
  await page.getByTestId('me-row').click();
  await expect(page.getByTestId('settings-section-profile')).toBeVisible();
  await page.keyboard.press('Escape'); // like a user: focus is already inside the dialog

  // Leaving happens in General, with a confirmation.
  await page.locator('[aria-haspopup="menu"]').click();
  await page.getByTestId('menu-leave').click();
  await page.getByTestId('ws-leave').click();
  await page.getByTestId('ws-leave-confirm').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Workspace name')).toBeVisible();
});

test('Settings on a narrow screen: list, section, back', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 420, height: 800 } })).newPage();
  await pointAtLocalRelay(page);
  await onboard(page, 'Mo', 'Start chatting');
  // On a phone-sized screen the rail lives in the drawer.
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByTestId('settings-button').click();
  await page.getByTestId('settings-nav-identity').click();
  await expect(page.getByTestId('settings-section-identity')).toBeVisible();
  await expect(page.getByTestId('settings-nav-profile')).toHaveCount(0);
  await page.getByTestId('settings-back').click();
  await expect(page.getByTestId('settings-nav-profile')).toBeVisible();
});

test('a relay workspace’s network settings show live relay status and edit relays; the invite link follows', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await relayWorkspace(page, 'Fa');
  await openConnection(page);
  await expect(page.getByTestId('connection-kind')).toHaveText('Nostr relays');
  await expect(page.getByTestId('ws-signal')).toHaveCount(0);
  await expect(page.getByTestId('connection-note')).toContainText('at least one relay in common');
  await expect(page.locator(`[data-testid=relay-status][data-relay="${RELAY}"]`)).toHaveAttribute('data-connected', 'true');

  const dead = 'ws://127.0.0.1:7779'; // nothing listens here
  await page.getByTestId('connection-relays').fill('nope');
  await page.getByTestId('connection-save').click();
  await expect(page.getByText('Not a ws:// or wss:// relay: nope')).toBeVisible();
  await page.getByTestId('connection-relays').fill(`${RELAY}, ${dead}`);
  await page.getByTestId('connection-save').click();
  await expect(page.getByText('Network settings saved')).toBeVisible();
  await expect(page.locator(`[data-testid=relay-status][data-relay="${RELAY}"]`)).toHaveAttribute('data-connected', 'true');
  await expect(page.locator(`[data-testid=relay-status][data-relay="${dead}"]`)).toHaveAttribute('data-connected', 'false');
  await expect(page.locator(`[data-testid=relay-status][data-relay="${dead}"]`)).toContainText('Disconnected');
  await page.getByTestId('connection-relays').press('Escape');

  await page.getByRole('button', { name: 'Invite people' }).first().click();
  expect(decodeURIComponent(await page.getByTestId('invite-link').inputValue())).toContain(dead);
  await page.getByTestId('invite-link').press('Escape');
  // Still connected after the reconnect: a message goes out through the live relay.
  const composer = page.getByRole('textbox', { name: 'Message #general' });
  await composer.fill('after the relay change');
  await composer.press('Enter');
  await expect(page.getByText('after the relay change')).toBeVisible();
});

test('a peer-to-peer workspace’s network settings show only WebRTC: signaling goes into the invite link', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await pointAtLocalRelay(page);
  await onboard(page, 'Gu', 'Start chatting');
  await page.getByLabel('Workspace name').fill('P2P ' + Date.now());
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/#\/w\/[A-Z0-9]{8}\/c\/general/);
  await openConnection(page);
  await expect(page.getByTestId('connection-kind')).toHaveText('Peer-to-peer (WebRTC)');
  await expect(page.getByTestId('connection-relay-list')).toHaveCount(0);
  await expect(page.getByTestId('ws-signal-nostr')).toBeChecked();
  await expect(page.getByTestId('ws-signal-urls')).toHaveValue('wss://nos.lol');
  await expect(page.getByTestId('turn-fields')).toHaveCount(0); // device settings live under "you"

  await page.getByTestId('ws-signal-torrent').click();
  await page.getByTestId('ws-signal-urls').fill('wss://tracker.example');
  await page.getByTestId('connection-save').click();
  await expect(page.getByText('Network settings saved')).toBeVisible();
  await page.getByTestId('ws-signal-urls').press('Escape');
  await page.getByRole('button', { name: 'Invite people' }).first().click();
  expect(decodeURIComponent(await page.getByTestId('invite-link').inputValue())).toContain('/s/torrent,wss://tracker.example');
});

test('a composer draft stays in its channel', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await relayWorkspace(page, 'Gu');
  await page.getByRole('textbox', { name: 'Message #general' }).fill('draft meant for general');
  await page.getByRole('button', { name: 'New channel' }).first().click();
  await page.getByLabel('Name', { exact: true }).fill('random');
  await page.getByRole('button', { name: 'Create channel' }).click();
  const other = page.getByRole('textbox', { name: 'Message #random' });
  await expect(other).toHaveValue('');
  await other.press('Enter');
  await expect(page.getByText('draft meant for general')).toHaveCount(0);
});

test('a failed upload keeps the text and the attachment in the composer', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await relayWorkspace(page, 'Ha');
  await openConnection(page);
  await page.getByTestId('connection-blossom').fill('http://127.0.0.1:9'); // refuses connections
  await page.getByTestId('connection-save').click();
  await expect(page.getByText('Network settings saved')).toBeVisible();
  await page.getByTestId('connection-blossom').press('Escape');

  const composer = page.getByRole('textbox', { name: 'Message #general' });
  await page.locator('input[type=file]').setInputFiles({ name: 'lost.txt', mimeType: 'text/plain', buffer: Buffer.from('never uploaded') });
  await composer.fill('keep me');
  await composer.press('Enter');
  await expect(page.getByText('Couldn’t upload lost.txt')).toBeVisible();
  await expect(composer).toHaveValue('keep me');
  await expect(page.getByTestId('composer').getByText('lost.txt')).toBeVisible();
  await expect(page.locator('[data-mid]')).toHaveCount(0); // nothing was posted
});

test('banning in a relay workspace rotates the key: the removed member gets nothing new', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await relayWorkspace(a, 'Ada');
  await a.getByRole('button', { name: 'Invite people' }).first().click();
  const oldLink = await a.getByTestId('invite-link').inputValue();
  await a.getByTestId('invite-link').press('Escape');

  const join = async (name: string) => {
    const p = await (await browser.newContext()).newPage();
    await p.goto(oldLink);
    await onboard(p, name, 'Join workspace');
    return p;
  };
  const b = await join('Bo');
  const c = await join('Cy');
  const composer = (p: Page) => p.getByRole('textbox', { name: 'Message #general' });
  await composer(c).fill('hi from cy');
  await composer(c).press('Enter');
  await expect(a.getByText('hi from cy')).toBeVisible({ timeout: 30_000 });
  await expect(b.getByText('hi from cy')).toBeVisible({ timeout: 30_000 });

  // A removes Cy: the ban asks for a second click, because the key rotation can't be undone.
  await a.getByRole('button', { name: /^Members:/ }).click();
  await a.getByRole('button', { name: /Cy/ }).first().click();
  await a.getByTestId('ban-button').click();
  await expect(a.getByTestId('ban-warning')).toBeVisible();
  await a.getByTestId('ban-confirm').click();
  await expect(a.getByText('Cy was removed')).toBeVisible();

  await composer(a).fill('after the ban');
  await composer(a).press('Enter');
  await expect(b.getByText('after the ban')).toBeVisible({ timeout: 30_000 });
  await expect(c.getByTestId('removed-banner')).toBeVisible({ timeout: 30_000 });
  await expect(c.getByText('after the ban')).toHaveCount(0);

  // New invites carry the new key; the old link no longer gets anyone into new conversations.
  await a.getByRole('button', { name: 'Invite people' }).first().click();
  const newLink = await a.getByTestId('invite-link').inputValue();
  expect(newLink.match(/\/k\/([^/]+)/)?.[1]).not.toBe(oldLink.match(/\/k\/([^/]+)/)?.[1]);
});

test('edit window: the Edit action counts down, then explains instead of doing nothing', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.clock.install();
  // A relay workspace, so the message is delivered (actions only show on delivered messages).
  await relayWorkspace(page, 'Hu');
  const composer = page.getByRole('textbox', { name: 'Message #general' });
  await composer.fill('typo in here');
  await composer.press('Enter');
  const msg = page.getByText('typo in here');
  await msg.hover();
  await expect(page.getByTestId('msg-edit')).toHaveAttribute('aria-label', /Edit · 15 min left/);
  await page.getByTestId('msg-edit').click();
  await expect(page.getByTestId('edit-time-left')).toHaveText(/15 min left/);
  await page.getByRole('textbox', { name: 'Edit message' }).press('Escape');

  await page.clock.fastForward('16:00');
  await msg.hover();
  await expect(page.getByTestId('msg-edit')).toHaveCount(0);
  await page.getByTestId('msg-edit-locked').click();
  await expect(page.getByText('This message can’t be changed anymore')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reply in thread' }).last()).toBeVisible();
  await composer.press('ArrowUp');
  await expect(page.getByText('Your last message can’t be edited anymore')).toBeVisible();
});

test('the tab icon shows unread messages on top of whatever favicon is set, and goes back when read', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await relayWorkspace(a, 'Ida');
  // Wait until nothing is decorated (relays connected, nothing unread): that's the page's own icon.
  await expect.poll(() => a.locator('link[rel~="icon"]').getAttribute('href'), { timeout: 30_000 }).toMatch(/^data:image\/svg/);
  const original = await a.locator('link[rel~="icon"]').getAttribute('href');
  await a.getByRole('button', { name: 'Invite people' }).first().click();
  const link = await a.getByTestId('invite-link').inputValue();
  await a.getByTestId('invite-link').press('Escape');
  const b = await (await browser.newContext()).newPage();
  await b.goto(link);
  await onboard(b, 'Jo', 'Join workspace');
  await expect(b.getByRole('textbox', { name: 'Message #general' })).toBeVisible({ timeout: 30_000 });

  // Ida looks at another channel while Jo writes in #general.
  await a.getByRole('button', { name: 'New channel' }).click();
  await a.getByLabel('Name').fill('side');
  await a.getByRole('button', { name: 'Create channel' }).click();
  await expect(a).toHaveURL(/\/c\/side/);
  const icon = () => a.locator('link[rel~="icon"]').getAttribute('href');
  const openGeneral = () =>
    a
      .getByRole('button', { name: /general/ })
      .first()
      .click();
  const say = async (text: string) => {
    const c = b.getByRole('textbox', { name: 'Message #general' });
    await c.fill(text);
    await c.press('Enter');
  };
  await say('unread one');
  await expect.poll(icon, { timeout: 30_000 }).toMatch(/^data:image\/png/);
  await openGeneral();
  await expect.poll(icon).toBe(original);

  // Swap the favicon: the badges now decorate the new icon, and reading restores the new one.
  const custom = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Crect width='8' height='8' fill='%23f80'/%3E%3C/svg%3E";
  await a.evaluate((href) => {
    const l = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (l) l.href = href;
  }, custom);
  await a.getByRole('button', { name: /side/ }).first().click();
  await say('unread two');
  await expect.poll(icon, { timeout: 30_000 }).toMatch(/^data:image\/png/);
  await openGeneral();
  await expect.poll(icon).toBe(custom);
});

test('the create step sets the new workspace’s own network settings for the chosen mode', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await pointAtLocalRelay(page);
  await onboard(page, 'Ky', 'Start chatting');

  // Peer-to-peer: collapsed by default with a summary of the defaults; expand to pick trackers.
  await page.getByLabel('Workspace name').fill('Trackers ' + Date.now());
  await expect(page.getByTestId('create-net-summary')).toHaveText('Signaling: Nostr relays · wss://nos.lol');
  await expect(page.getByTestId('create-signal-urls')).toHaveCount(0);
  await page.getByTestId('create-net-toggle').click();
  await page.getByTestId('create-signal-torrent').click();
  await page.getByTestId('create-signal-urls').fill('not a url');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('Not a ws:// or wss:// server: not')).toBeVisible();
  await page.getByTestId('create-signal-urls').fill('wss://tracker.example');
  await expect(page.getByTestId('create-net-summary')).toHaveText('Signaling: BitTorrent trackers · wss://tracker.example');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/#\/w\/[A-Z0-9]{8}\/c\/general/);
  await page.getByRole('button', { name: 'Invite people' }).first().click();
  expect(decodeURIComponent(await page.getByTestId('invite-link').inputValue())).toContain('/s/torrent,wss://tracker.example');
  await page.getByTestId('invite-link').press('Escape');
  await openConnection(page);
  await expect(page.getByTestId('ws-signal-torrent')).toBeChecked();
  await expect(page.getByTestId('ws-signal-urls')).toHaveValue('wss://tracker.example');
  await expect(page.getByTestId('connection-relay-list')).toHaveCount(0); // only this workspace's mode
  await page.getByTestId('ws-signal-urls').press('Escape');

  // Relay workspace: its relays and file servers come from the same step.
  await page.getByRole('button', { name: 'Create or join a workspace' }).click();
  await page.getByLabel('Workspace name').fill('Relays ' + Date.now());
  await page.getByText('Encrypted on Nostr relays').click();
  await expect(page.getByTestId('create-net-summary')).toHaveText(`Relays: ${RELAY} · Files: ${BLOSSOM}`);
  await page.getByTestId('create-net-toggle').click();
  await page.getByTestId('create-relays').fill(`${RELAY}, ws://127.0.0.1:7779`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/#\/w\/[A-Z0-9]{8}\/c\/general/);
  await openConnection(page);
  await expect(page.getByTestId('connection-kind')).toHaveText('Nostr relays');
  await expect(page.getByTestId('connection-relays')).toHaveValue(`${RELAY}, ws://127.0.0.1:7779`);
  await expect(page.getByTestId('connection-blossom')).toHaveValue(BLOSSOM);
  await expect(page.getByTestId('ws-signal')).toHaveCount(0);
  await page.getByTestId('connection-relays').press('Escape');

  // The next workspace starts from what was used last in each mode.
  await page.getByRole('button', { name: 'Create or join a workspace' }).click();
  await expect(page.getByTestId('create-net-summary')).toHaveText('Signaling: BitTorrent trackers · wss://tracker.example');
  await page.getByText('Encrypted on Nostr relays').click();
  await expect(page.getByTestId('create-net-summary')).toHaveText(`Relays: ${RELAY}, ws://127.0.0.1:7779 · Files: ${BLOSSOM}`);
});

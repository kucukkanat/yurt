import { test, expect, type Page } from '@playwright/test';

const RELAY = 'ws://127.0.0.1:7777'; // local relay and Blossom server, started by playwright.config.ts
const BLOSSOM = 'http://127.0.0.1:7778';

async function onboard(page: Page, name: string, finish: 'Start chatting' | 'Join workspace') {
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('I saved my recovery phrase somewhere safe').click();
  await page.getByRole('button', { name: finish }).click();
}

/** Point new relay workspaces at the local relay and file server, through the same IndexedDB settings the Settings dialog writes. */
async function useLocalRelay(page: Page) {
  await page.goto('./');
  await page.evaluate(({ relays, servers }) => new Promise<void>((res, rej) => {
    const r = indexedDB.open('yurt', 1);
    r.onsuccess = () => {
      const t = r.result.transaction('kv', 'readwrite');
      const kv = t.objectStore('kv');
      const get = kv.get('settings');
      get.onsuccess = () => kv.put({ ...(get.result || {}), relays, blossom: servers }, 'settings');
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    };
    r.onerror = () => rej(r.error);
  }), { relays: RELAY, servers: BLOSSOM });
  await page.reload();
}

test('relay workspace keeps encrypted history for members who join after everyone left', async ({ browser }) => {
  const actx = await browser.newContext();
  const a = await actx.newPage();
  await useLocalRelay(a);
  await onboard(a, 'Ada', 'Start chatting');
  await a.getByLabel('Workspace name').fill('Relay ' + Date.now());
  await a.getByText('Encrypted on Nostr relays').click();
  await a.getByRole('button', { name: 'Create workspace' }).click();
  await expect(a).toHaveURL(/#\/w\/[A-Z0-9]{8}\/c\/general/);

  await a.getByRole('button', { name: 'Invite people' }).first().click();
  const link = await a.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/#\/w\/[A-Z0-9]{8}\/k\/[A-Za-z0-9_-]{43}\/n\//);
  await expect(a.getByRole('button', { name: 'Copy code' })).toHaveCount(0);
  await a.getByTestId('invite-link').press('Escape'); // the dialog handles Escape when focus is inside it
  await expect(a.getByRole('dialog')).toHaveCount(0);

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
  await useLocalRelay(page);
  await onboard(page, 'Di', 'Start chatting');
  await page.getByLabel('Workspace name').fill('Calls ' + Date.now());
  await page.getByText('Encrypted on Nostr relays').click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByTestId('huddle-button')).toBeDisabled();
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('tab', { name: 'Network' }).click();
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
  await useLocalRelay(page);
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

test('Network settings: Nostr and WebRTC sections, URL checks, and saving leaves other tabs alone', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await useLocalRelay(page);
  await onboard(page, 'Ed', 'Start chatting');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  // The Network form is seeded when the dialog opens; a theme change after that must survive its save.
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await page.getByText('Light', { exact: true }).click();
  await page.getByRole('tab', { name: 'Network' }).click();

  const nostr = page.getByTestId('network-nostr');
  await expect(nostr.getByRole('heading')).toHaveText('Nostr (relay workspaces)');
  await expect(nostr.getByTestId('settings-relays')).toHaveValue(RELAY);
  await expect(nostr.getByTestId('blossom-servers')).toHaveValue(BLOSSOM);
  await expect(nostr.getByTestId('webrtc-switch')).toBeVisible();
  const webrtc = page.getByTestId('network-webrtc');
  await expect(webrtc.getByRole('heading')).toHaveText('WebRTC (peer-to-peer workspaces and calls)');
  await expect(webrtc.getByTestId('turn-off')).toBeChecked();

  await nostr.getByTestId('settings-relays').fill('https://not-a-relay.example');
  await page.getByTestId('network-save').click();
  await expect(page.getByText('Not a ws:// or wss:// relay: https://not-a-relay.example')).toBeVisible();
  await nostr.getByTestId('settings-relays').fill(RELAY);
  await page.getByTestId('network-save').click();
  await expect(page.getByText('Network settings saved')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('Connection view shows live relay status and edits relays; the invite link follows', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await relayWorkspace(page, 'Fa');
  await openConnection(page);
  await expect(page.getByTestId('connection-kind')).toHaveText('Encrypted on Nostr relays');
  await expect(page.getByTestId('connection-note')).toContainText('at least one relay in common');
  await expect(page.locator(`[data-testid=relay-status][data-relay="${RELAY}"]`)).toHaveAttribute('data-connected', 'true');

  const dead = 'ws://127.0.0.1:7779'; // nothing listens here
  await page.getByTestId('connection-relays').fill('nope');
  await page.getByTestId('connection-save').click();
  await expect(page.getByText('Not a ws:// or wss:// relay: nope')).toBeVisible();
  await page.getByTestId('connection-relays').fill(`${RELAY}, ${dead}`);
  await page.getByTestId('connection-save').click();
  await expect(page.getByText('Connection updated')).toBeVisible();
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
  await expect(page.getByText('Connection updated')).toBeVisible();
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

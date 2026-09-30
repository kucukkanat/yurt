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
  await page.getByRole('button', { name: 'Save network settings' }).click();
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

import { expect, type Page } from '@playwright/test';

// The local relay and Blossom server started by playwright.config.ts.
export const RELAY = 'ws://127.0.0.1:7777';
export const BLOSSOM = 'http://127.0.0.1:7778';

/** Creates an identity in the onboarding flow, then either starts a workspace or joins the one in the URL. */
export async function onboard(page: Page, name: string, finish: 'Start chatting' | 'Join workspace' = 'Start chatting') {
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('I saved my recovery phrase somewhere safe').click();
  await page.getByRole('button', { name: finish }).click();
}

/** Points new relay workspaces at the local relay and file server, through the same IndexedDB settings the Settings dialog writes. */
export async function pointAtLocalRelay(page: Page) {
  await page.goto('./');
  await page.evaluate(
    ({ relays, servers }) =>
      new Promise<void>((res, rej) => {
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
      }),
    { relays: RELAY, servers: BLOSSOM },
  );
  await page.reload();
}

/** Creates a workspace from the onboarding/home form and waits for its #general. */
export async function createWorkspace(page: Page, name: string, mode: 'p2p' | 'relays' = 'p2p') {
  await page.getByLabel('Workspace name').fill(name + ' ' + Date.now());
  if (mode === 'relays') await page.getByText('Encrypted on Nostr relays').click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/#\/w\/[A-Z0-9]{8}\/c\/general/);
}

/** Reads the invite link from the Invite dialog, then closes it with Escape (handled while focus is inside). */
export async function inviteLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Invite people' }).first().click();
  const link = await page.getByTestId('invite-link').inputValue();
  await page.getByTestId('invite-link').press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return link;
}

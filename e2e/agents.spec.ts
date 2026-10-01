import { test, expect, type Page } from '@playwright/test';
// Node's WebSocket for the in-process peer below (same polyfill as the protocol tests).
import '../packages/protocol/test/setup';
import { WorkspacePeer, keyFromPhrase, newRecoveryPhrase, parseInvite, guestDmChannel, type Ev, type PeerStore } from '../packages/protocol/src';

const RELAY = 'ws://127.0.0.1:7777'; // local relay, started by playwright.config.ts

async function onboard(page: Page, name: string) {
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('I saved my recovery phrase somewhere safe').click();
  await page.getByRole('button', { name: 'Start chatting' }).click();
}

/** Point new relay workspaces at the local relay, through the same IndexedDB settings the Settings dialog writes. */
async function useLocalRelay(page: Page) {
  await page.goto('./');
  await page.evaluate(
    (relays) =>
      new Promise<void>((res, rej) => {
        const r = indexedDB.open('yurt', 1);
        r.onsuccess = () => {
          const t = r.result.transaction('kv', 'readwrite');
          const kv = t.objectStore('kv');
          const get = kv.get('settings');
          get.onsuccess = () => kv.put({ ...(get.result || {}), relays }, 'settings');
          t.oncomplete = () => res();
          t.onerror = () => rej(t.error);
        };
        r.onerror = () => rej(r.error);
      }),
    RELAY,
  );
  await page.reload();
}

const memStore = (): PeerStore => {
  const evs = new Map<string, Ev>();
  let mark = 0;
  return {
    getBlob: async () => null,
    putBlob: async () => {},
    load: async () => [...evs.values()],
    save: async (xs) => {
      xs.forEach((e) => evs.set(e.id, e));
    },
    loadMark: async () => mark,
    saveMark: async (_ws, m) => {
      mark = m;
    },
  };
};

// Olu's agents are announced by a real WorkspacePeer in this process, the way yurt-bridge does it:
// Harvey is discoverable, Mute is not. Bea, in the browser, should only be able to DM Harvey.
test('members can find and DM discoverable agents, and are told the owner can read along', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await useLocalRelay(page);
  await onboard(page, 'Bea');
  await page.getByLabel('Workspace name').fill('Agents ' + Date.now());
  await page.getByText('Encrypted on Nostr relays').click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/#\/w\/[A-Z0-9]{8}\/c\/general/);
  await page.getByRole('button', { name: 'Invite people' }).first().click();
  const invite = parseInvite(await page.getByTestId('invite-link').inputValue());
  await page.getByTestId('invite-link').press('Escape');
  if (!invite) throw new Error('no invite link');

  const olu = keyFromPhrase(newRecoveryPhrase());
  const owner = new WorkspacePeer({ code: invite.code, kp: olu, selfId: olu.pub.slice(0, 20), transport: invite.transport, creator: invite.creator, store: memStore() });
  await owner.start();
  try {
    await expect.poll(() => owner.connected && owner.state.channels.has('general'), { timeout: 30_000 }).toBe(true);
    owner.publish({ t: 'profile', b: { name: 'Olu', handle: 'olu' } });
    for (const [id, name, discoverable] of [
      ['harvey', 'Harvey', true],
      ['mute', 'Mute', false],
    ] as const) {
      owner.publish({
        t: 'agent',
        b: { id, name, handle: id, runtime: 'copilot', replyIn: 'thread', respondTo: { mentions: true, replies: true }, postIn: { thread: true, channel: true }, discoverable },
      });
      owner.publish({ t: 'msg', ch: 'general', ag: id, b: { text: name + ' says hi' } });
    }

    // ⌘K lists the discoverable agent only.
    await expect(page.getByText('Mute says hi')).toBeVisible();
    await page.getByRole('button', { name: /Jump to/ }).click();
    const jump = page.getByRole('textbox', { name: 'Jump to' });
    await jump.fill('mute');
    await expect(page.getByRole('option')).toHaveCount(0);
    await jump.fill('harvey');
    await expect(page.getByRole('option', { name: /Harvey.*Olu’s agent · discoverable/ })).toBeVisible();
    await jump.press('Escape');

    // The profile says how to reach a non-discoverable agent, and offers a DM with a discoverable one.
    await page.getByRole('button', { name: 'Open profile: Mute' }).first().click();
    await expect(page.getByTestId('agent-not-discoverable')).toBeVisible();
    await expect(page.getByTestId('agent-message')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open profile: Harvey' }).first().click();
    await expect(page.getByTestId('agent-prefs')).toHaveText('answers @mentions and replies · posts in thread + channel · discoverable');
    await page.getByTestId('agent-message').click();

    await expect(page.getByTestId('guest-dm-notice')).toHaveText('Conversations with Harvey are visible to Olu, who runs it.');
    const composer = page.getByRole('textbox', { name: 'Message Harvey' });
    await composer.fill('hi harvey');
    await composer.press('Enter');

    // It reaches the owner (where the bridge would run Harvey), and Harvey's answer comes back.
    const fromBea = () => [...owner.state.msgs.values()].find((m) => m.text === 'hi harvey');
    await expect.poll(fromBea, { timeout: 30_000 }).toBeTruthy();
    const bea = fromBea();
    expect(bea?.ch).toBe(guestDmChannel(bea?.a ?? '', olu.pub, 'harvey'));
    owner.publish({ t: 'msg', ch: bea?.ch, to: bea?.a, ag: 'harvey', b: { text: 'hello Bea, Harvey here' } });
    await expect(page.getByText('hello Bea, Harvey here')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Channels and messages' }).getByText('Harvey (Olu’s agent)')).toBeVisible();
  } finally {
    owner.leave();
  }
});

import { test, expect } from '@playwright/test';
import { checkPage, createWorkspace, inviteLink, letIn, onboard, pointAtLocalRelay } from './helpers';
// Node's WebSocket for the in-process peer below (same polyfill as the protocol tests).
import '../packages/protocol/test/setup';
import { memStore } from '../packages/protocol/test/util';
import { WorkspacePeer, JoinClient, keyFromPhrase, newRecoveryPhrase, parseInvite, isJoinInvite, guestDmChannel } from '../packages/protocol/src';

// Olu's agents are announced by a real WorkspacePeer in this process, the way yurt-bridge does it:
// Harvey is discoverable, Mute is not. Bea, in the browser, should only be able to DM Harvey.
test('members can find and DM discoverable agents, and are told the owner can read along', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await pointAtLocalRelay(page);
  await onboard(page, 'Bea');
  await createWorkspace(page, 'Agents');
  const invite = parseInvite(await inviteLink(page));
  if (!invite || !isJoinInvite(invite)) throw new Error('no invite link');

  // Olu asks to join with the link, like the app does, and Bea lets him in.
  const olu = keyFromPhrase(newRecoveryPhrase());
  const key = new Promise<string>((resolve) => new JoinClient({ invite, kp: olu, who: { name: 'Olu', handle: 'olu' }, onGranted: resolve }));
  await letIn(page, 'Olu');
  const owner = new WorkspacePeer({
    code: invite.code,
    kp: olu,
    transport: { key: await key, relays: invite.relays },
    creator: invite.creator,
    store: memStore().store,
    onError: (m) => {
      throw new Error(m);
    },
  });
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
    await checkPage(page, 'jump dialog › discoverable agent');
    await jump.press('Escape');

    // The profile says how to reach a non-discoverable agent, and offers a DM with a discoverable one.
    await page.getByRole('button', { name: 'Open profile: Mute' }).first().click();
    await expect(page.getByTestId('agent-not-discoverable')).toBeVisible();
    await expect(page.getByTestId('agent-message')).toHaveCount(0);
    await checkPage(page, 'profile › agent, not discoverable');
    await page.getByRole('button', { name: 'Open profile: Harvey' }).first().click();
    await expect(page.getByTestId('agent-prefs')).toHaveText('answers @mentions and replies · posts in thread + channel · discoverable');
    await checkPage(page, 'profile › agent, discoverable');
    await page.getByTestId('agent-message').click();

    await expect(page.getByTestId('guest-dm-notice')).toHaveText('Conversations with Harvey are visible to Olu, who runs it.');
    const composer = page.getByRole('textbox', { name: 'Message Harvey' });
    await composer.fill('hi harvey');
    await composer.press('Enter');

    // It reaches the owner (where the bridge would run Harvey), and Harvey's answer comes back.
    const fromBea = () => [...owner.state.msgs.values()].find((m) => m.text === 'hi harvey');
    await expect.poll(fromBea, { timeout: 30_000 }).toBeTruthy();
    const bea = fromBea();
    if (!bea) throw new Error('Bea’s message never reached the owner');
    expect(bea.ch).toBe(guestDmChannel(bea.a, olu.pub, 'harvey'));
    owner.publish({ t: 'msg', ch: bea.ch, to: bea.a, ag: 'harvey', b: { text: 'hello Bea, Harvey here' } });
    await expect(page.getByText('hello Bea, Harvey here')).toBeVisible();
    await checkPage(page, 'guest DM › with the agent’s answer');
    await expect(page.getByRole('navigation', { name: 'Channels and messages' }).getByText('Harvey (Olu’s agent)')).toBeVisible();
  } finally {
    owner.leave();
  }
});

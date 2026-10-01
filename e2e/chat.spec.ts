import { test, expect } from '@playwright/test';
import { checkPage, createWorkspace, inviteLink, onboard } from './helpers';

test('two peers create, join, sync history and chat', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  await a.goto('./');
  await onboard(a, 'Ada', 'Start chatting');
  await createWorkspace(a, 'E2E');
  const link = await inviteLink(a);
  // New peer-to-peer workspaces signal over wss://nos.lol by default, so the link carries that too.
  expect(link).toMatch(/#\/w\/[A-Z0-9]{8}\/k\/[A-Za-z0-9_-]{43}\/s\/nostr%2Cwss%3A%2F%2Fnos\.lol\/o\/[0-9a-f]{64}$/); // link-only: the key lets people in; /o/ pins the creator

  // Written before anyone else is here: must arrive through history sync.
  const composerA = a.getByRole('textbox', { name: 'Message #general' });
  await composerA.fill('first, before you joined');
  await composerA.press('Enter');

  await b.goto(link);
  await onboard(b, 'Bo', 'Join workspace');
  await expect(b.getByText('first, before you joined')).toBeVisible();

  await composerA.fill('hello from ada');
  await composerA.press('Enter');
  await expect(b.getByText('hello from ada')).toBeVisible();

  const composerB = b.getByRole('textbox', { name: 'Message #general' });
  await composerB.fill('ping from bo @ada');
  // Enter would pick from the @-mention menu once Ada's profile has synced; close it first.
  await composerB.press('Escape');
  await composerB.press('Enter');
  await expect(a.getByText('ping from bo')).toBeVisible();

  // Reactions and threads replicate too.
  await a.getByText('ping from bo').first().hover();
  await a.getByRole('button', { name: 'Reply in thread' }).click();
  const thread = a.getByRole('textbox', { name: 'Reply in thread' });
  await thread.fill('threaded reply');
  await thread.press('Enter');
  await expect(b.getByRole('button', { name: /1 reply/ })).toBeVisible();
  await checkPage(a, 'peer-to-peer › thread open');
  await checkPage(b, 'peer-to-peer › channel with a reply count');
});

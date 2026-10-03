import { test, expect } from '@playwright/test';
import { checkPage, createWorkspace, inviteLink, joinVia, onboard, pointAtLocalRelay } from './helpers';

test('two members create, join, get history and chat', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  await pointAtLocalRelay(a);
  await onboard(a, 'Ada', 'Start chatting');
  await createWorkspace(a, 'E2E');
  const link = await inviteLink(a);
  // The link carries a join key (never the workspace key), the workspace's relays, and /o/ to pin the creator.
  expect(link).toMatch(/#\/w\/[A-Z0-9]{8}\/j\/[A-Za-z0-9_-]{43}\/n\/ws%3A%2F%2F127\.0\.0\.1%3A7777\/o\/[0-9a-f]{64}$/);

  // Written before anyone else is here: must arrive from the relay's history.
  const composerA = a.getByRole('textbox', { name: 'Message #general' });
  await composerA.fill('first, before you joined');
  await composerA.press('Enter');

  await joinVia(a, b, link, 'Bo');
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
  await checkPage(a, 'chat › thread open');
  await checkPage(b, 'chat › channel with a reply count');
});

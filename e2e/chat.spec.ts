import { test, expect, type Page } from '@playwright/test';

async function onboard(page: Page, name: string, finish: 'Start chatting' | 'Join workspace') {
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('I saved my recovery phrase somewhere safe').click();
  await page.getByRole('button', { name: finish }).click();
}

test('two peers create, join, sync history and chat', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  await a.goto('./');
  await onboard(a, 'Ada', 'Start chatting');
  await a.getByLabel('Workspace name').fill('E2E ' + Date.now());
  await a.getByRole('button', { name: 'Create workspace' }).click();
  await expect(a).toHaveURL(/#\/w\/[A-Z0-9]{8}\/c\/general/);
  const code = a.url().match(/#\/w\/([A-Z0-9]{8})/)![1];

  // Written before anyone else is here: must arrive through history sync.
  const composerA = a.getByRole('textbox', { name: 'Message #general' });
  await composerA.fill('first, before you joined');
  await composerA.press('Enter');

  await b.goto('./#/w/' + code);
  await onboard(b, 'Bo', 'Join workspace');
  await expect(b.getByText('first, before you joined')).toBeVisible();

  await composerA.fill('hello from ada');
  await composerA.press('Enter');
  await expect(b.getByText('hello from ada')).toBeVisible();

  const composerB = b.getByRole('textbox', { name: 'Message #general' });
  await composerB.fill('ping from bo @ada');
  await composerB.press('Enter');
  await expect(a.getByText('ping from bo')).toBeVisible();

  // Reactions and threads replicate too.
  await a.getByText('ping from bo').first().hover();
  await a.getByRole('button', { name: 'Reply in thread' }).click();
  const thread = a.getByRole('textbox', { name: 'Reply in thread' });
  await thread.fill('threaded reply');
  await thread.press('Enter');
  await expect(b.getByRole('button', { name: /1 reply/ })).toBeVisible();
});

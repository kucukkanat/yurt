import { test, expect, type Page } from '@playwright/test';
import { checkPage, createWorkspace, inviteLink, onboard, pointAtLocalRelay } from './helpers';

// Collaboration between two people: tasks, polls, a shared doc and a board, as users do it.

async function twoMembers(browser: import('@playwright/test').Browser): Promise<[Page, Page]> {
  const a = await (await browser.newContext()).newPage();
  await pointAtLocalRelay(a);
  await onboard(a, 'Ada');
  await createWorkspace(a, 'Collab');
  const link = await inviteLink(a);
  const b = await (await browser.newContext()).newPage();
  await b.goto(link);
  await onboard(b, 'Bo', 'Join workspace');
  await expect(b.getByRole('textbox', { name: 'Message #general' })).toBeVisible();
  return [a, b];
}

async function create(page: Page, kind: 'Task' | 'Poll' | 'Doc' | 'Board', fill: (d: ReturnType<Page['getByRole']>) => Promise<void>) {
  const hub = page.getByRole('complementary', { name: 'Hub' });
  if (!(await hub.isVisible())) await page.getByTestId('hub-button').click();
  await hub.getByRole('button', { name: kind, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await fill(dialog);
  await dialog.getByTestId('collab-create').click();
  await expect(dialog).toHaveCount(0);
}

test('members plan together: tasks, polls, a doc and a board', async ({ browser }) => {
  const mode = 'relays';
  const [a, b] = await twoMembers(browser);

  // A task for Bo, from Ada's hub.
  await create(a, 'Task', async (d) => {
    await d.getByLabel('Title').fill('Book the venue');
    await d.getByLabel('Assignee').selectOption({ label: 'Bo' });
  });
  await checkPage(a, mode + ' › hub with a task');
  await b.getByTestId('hub-button').click();
  const bHub = b.getByRole('complementary', { name: 'Hub' });
  await expect(bHub.getByText('Yours and your agents’ · 1')).toBeVisible();
  await bHub.getByRole('checkbox', { name: 'Done: Book the venue' }).click();
  await expect(a.getByRole('complementary', { name: 'Hub' }).getByText('Done · 1')).toBeVisible();

  // A poll in the channel: Bo votes, Ada sees it.
  await create(a, 'Poll', async (d) => {
    await d.getByLabel('Question').fill('Where to?');
    await d.getByTestId('poll-options').fill('Lisbon\nOslo');
  });
  await b.getByTestId('poll').getByTestId('poll-option-0').click();
  await expect(a.getByTestId('poll').getByTestId('poll-status')).toHaveText('1 vote');
  await checkPage(b, mode + ' › poll');

  // A doc both write in.
  await create(a, 'Doc', async (d) => {
    await d.getByLabel('Title').fill('Plan');
  });
  await a.getByTestId('doc-text').fill('Goals: ship in May');
  await b.getByRole('complementary', { name: 'Hub' }).getByRole('tab', { name: /Docs/ }).click();
  await b.getByRole('button', { name: /Plan/ }).first().click();
  await expect(b.getByTestId('doc-text')).toHaveValue('Goals: ship in May');
  await b.getByTestId('doc-text').fill('Goals: ship in May\nBudget: small');
  await expect(a.getByTestId('doc-text')).toHaveValue('Goals: ship in May\nBudget: small');
  await checkPage(a, mode + ' › doc');

  // A board with a note from each.
  await create(a, 'Board', async (d) => {
    await d.getByLabel('Title').fill('Ideas');
  });
  await a.getByTestId('board-add').click();
  await a.getByRole('textbox', { name: 'Note' }).fill('Rooftop dinner');
  await a.getByTestId('board').click({ position: { x: 400, y: 380 } });
  await b.getByRole('button', { name: 'Back to docs' }).click();
  await b.getByRole('button', { name: /Ideas/ }).first().click();
  await expect(b.getByRole('textbox', { name: 'Note' })).toHaveValue('Rooftop dinner');
  await checkPage(b, mode + ' › board');
});

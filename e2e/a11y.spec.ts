import { test, expect, type Page } from '@playwright/test';
import { checkPage, createWorkspace, inviteLink, letIn, onboard, pointAtLocalRelay } from './helpers';

// Every screen, in both themes (contrast differs), must pass axe (WCAG 2.1 A/AA + best practices) and html-validate.
// checkPage uses soft assertions, so one run lists every failing screen.

const SETTINGS = ['profile', 'identity', 'preferences', 'connection', 'agents', 'ws-general', 'ws-network', 'ws-agents'];

async function walkSettings(page: Page, prefix: string) {
  await page.getByTestId('settings-button').click();
  for (const id of SETTINGS) {
    await page.getByTestId('settings-nav-' + id).click();
    await expect(page.getByTestId('settings-section-' + id)).toBeVisible();
    await checkPage(page, prefix + 'settings › ' + id);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe.configure({ timeout: 300_000 });

for (const theme of ['dark', 'light'] as const) {
  test(`every screen is accessible and valid HTML (${theme})`, async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await pointAtLocalRelay(page, { theme });
    await checkPage(page, 'onboarding › name');
    await page.getByLabel('Display name').fill('Ada');
    await page.getByRole('button', { name: 'Continue' }).click();
    await checkPage(page, 'onboarding › recovery phrase');
    await page.getByText('I saved my recovery phrase somewhere safe').click();
    await page.getByRole('button', { name: 'Start chatting' }).click();
    await expect(page.getByLabel('Workspace name')).toBeVisible();
    await checkPage(page, 'home › create workspace');

    await createWorkspace(page, 'A11y');
    await checkPage(page, 'channel › empty');
    const composer = page.getByRole('textbox', { name: 'Message #general' });
    await composer.fill('hello there');
    await composer.press('Enter');
    await expect(page.getByText('hello there')).toBeVisible();
    // Delivered (no longer queued) before checking: the page must look the same on every run.
    await expect(page.getByText('Sends when you reconnect')).toHaveCount(0, { timeout: 15_000 });
    await checkPage(page, 'channel › with a message');

    await page.getByText('hello there').hover();
    await page.getByRole('button', { name: 'Reply in thread' }).click();
    const reply = page.getByRole('textbox', { name: 'Reply in thread' });
    await reply.fill('in the thread');
    await reply.press('Enter');
    await expect(page.getByText('in the thread')).toBeVisible();
    await checkPage(page, 'thread panel');

    await page.getByRole('button', { name: /^Members/ }).click();
    await checkPage(page, 'members panel');
    await page.getByRole('button', { name: 'Search' }).click();
    await checkPage(page, 'search panel');
    await page.getByRole('button', { name: /^Pinned/ }).click();
    await checkPage(page, 'pinned panel');

    await page.getByRole('button', { name: 'Open profile: Ada' }).first().click();
    await checkPage(page, 'profile panel (you)');
    await page.getByRole('button', { name: 'Notes to self' }).click();
    await expect(page.getByRole('textbox', { name: /^Message/ })).toBeVisible();
    await checkPage(page, 'DM › notes to self');
    await page.getByRole('button', { name: 'general', exact: true }).click();

    await page.getByRole('button', { name: /Jump to/ }).click();
    await checkPage(page, 'jump dialog');
    await page.keyboard.press('Escape');
    await page.getByTestId('ws-menu-button').click();
    await checkPage(page, 'workspace menu');
    await page.getByTestId('ws-menu').getByText('New channel').click();
    await checkPage(page, 'new channel dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Invite people' }).first().click();
    await checkPage(page, 'invite dialog');
    await page.keyboard.press('Escape');

    await walkSettings(page, '');

    // A second member: joining, then a DM between the two.
    const link = await inviteLink(page);
    const b = await (await browser.newContext()).newPage();
    await pointAtLocalRelay(b, { theme });
    await b.goto(link);
    await checkPage(b, 'join › onboarding');
    await onboard(b, 'Bo', 'Join workspace');
    await expect(b.getByTestId('join-pending')).toBeVisible();
    await checkPage(b, 'join › waiting to be let in');
    await page.getByRole('button', { name: /^Members/ }).first().click();
    await expect(page.getByTestId('join-request')).toBeVisible({ timeout: 30_000 });
    await checkPage(page, 'members › someone asks to join');
    await page.getByRole('button', { name: 'Close (Esc)' }).click();
    await letIn(page, 'Bo');
    await expect(b.getByText('hello there')).toBeVisible({ timeout: 30_000 });
    await checkPage(b, 'joined channel (someone else’s message)');
    await b.getByRole('button', { name: 'Open profile: Ada' }).first().click();
    await checkPage(b, 'profile panel (someone else)');
    await b.getByRole('button', { name: 'Message', exact: true }).click();
    await checkPage(b, 'DM › empty');
  });
}

test('narrow screens are accessible and valid HTML', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 420, height: 800 } })).newPage();
  await pointAtLocalRelay(page);
  await onboard(page, 'Mo', 'Start chatting');
  await createWorkspace(page, 'Narrow');
  await checkPage(page, 'narrow › channel');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await checkPage(page, 'narrow › drawer');
  await page.getByTestId('settings-button').click();
  await checkPage(page, 'narrow › settings list');
  for (const id of SETTINGS) {
    await page.getByTestId('settings-nav-' + id).click();
    await expect(page.getByTestId('settings-section-' + id)).toBeVisible();
    await checkPage(page, 'narrow › settings › ' + id);
    await page.getByTestId('settings-back').click();
  }
});

// Regression: toasts used to close when their progress bar's CSS animation ended, and reduced motion sets every
// animation to 0 ms, so people who reduce motion never saw a toast (errors included).
test('toasts stay up for their full time with reduced motion', async ({ browser }) => {
  const page = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
  await page.clock.install();
  await pointAtLocalRelay(page);
  await onboard(page, 'Rae', 'Start chatting');
  await page.getByTestId('settings-button').click();
  await page.getByTestId('settings-nav-connection').click();
  await page.getByTestId('network-device').getByTestId('turn-default').click(); // Save needs a change
  await page.getByTestId('network-save').click();
  const toast = page.getByText('Connection settings saved');
  await expect(toast).toBeVisible();
  await page.clock.fastForward(3000); // the toast lasts 4 s
  await expect(toast).toBeVisible();
  await page.clock.fastForward(1500);
  await expect(toast).toHaveCount(0);
});

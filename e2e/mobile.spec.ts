import { test, expect, type Locator, type Page } from '@playwright/test';
import { checkPage, createWorkspace, onboard, pointAtLocalRelay } from './helpers';

// On a phone (the "phone" project: Pixel 7, touch screen): real touch input through Chromium's DevTools protocol, the
// same events a finger makes, so the browser decides what's a scroll, a swipe and a long-press.

/** A finger: down at the first point, held `holdMs`, moved through the rest, lifted. */
async function finger(page: Page, points: [number, number][], holdMs = 0) {
  const cdp = await page.context().newCDPSession(page);
  const [first, ...rest] = points;
  if (!first) throw new Error('a gesture needs a point');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first[0], y: first[1] }] });
  if (holdMs) await page.waitForTimeout(holdMs);
  for (const [x, y] of rest) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
/** A horizontal swipe across `el` from `x0` to `x1` (page coordinates), at its vertical middle. */
async function swipe(page: Page, el: Locator, x0: number, x1: number) {
  const box = await el.boundingBox();
  if (!box) throw new Error('nothing to swipe');
  const y = box.y + Math.min(box.height / 2, 20);
  await finger(
    page,
    Array.from({ length: 9 }, (_, i): [number, number] => [x0 + ((x1 - x0) * i) / 8, y]),
  );
}

test('long-press, swipes and the drawer on a phone', async ({ page }) => {
  await pointAtLocalRelay(page);
  await onboard(page, 'Ada', 'Start chatting');
  await createWorkspace(page, 'Pocket', 'relays');
  const composer = page.getByRole('textbox', { name: 'Message #general' });
  await composer.fill('hello on a phone');
  await composer.press('Enter');
  const message = page.getByRole('article').filter({ hasText: 'hello on a phone' });
  await expect(message).toBeVisible();

  // Long-press: the actions sheet instead of a hover bar.
  const box = await message.boundingBox();
  if (!box) throw new Error('no message');
  await finger(page, [[box.x + 80, box.y + 15]], 700);
  const sheet = page.getByRole('dialog', { name: 'Message actions' });
  await expect(sheet).toBeVisible();
  await checkPage(page, 'phone › message actions');
  await page.getByTestId('sheet-cancel').tap();
  await expect(sheet).toHaveCount(0);

  // Swipe a message right: its thread, full screen. Swipe that away again.
  await swipe(page, message, box.x + 60, box.x + 260);
  const thread = page.getByRole('complementary', { name: 'Thread' });
  await expect(thread).toBeVisible();
  await swipe(page, thread.getByRole('article').first(), 40, 300);
  await expect(thread).toHaveCount(0);

  // From the left edge: the sidebar. Swipe it back.
  await swipe(page, page.getByTestId('main'), 4, 260);
  const drawer = page.getByTestId('drawer');
  await expect(drawer).toBeVisible();
  await checkPage(page, 'phone › sidebar');
  await swipe(page, drawer, 300, 40);
  await expect(drawer).toHaveCount(0);
});

test('explains installing on a phone', async ({ page }) => {
  await page.goto('./');
  await onboard(page, 'Ada', 'Start chatting');
  // Once per device, the app suggests installing it; "How" opens Settings → App.
  await page.getByRole('button', { name: 'How' }).tap();
  await expect(page.getByTestId('app-section')).toBeVisible();
  await expect(page.getByTestId('app-install-menu').or(page.getByTestId('app-install'))).toBeVisible();
  await checkPage(page, 'phone › settings › app');
});

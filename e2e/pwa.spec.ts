import { test, expect, type Page } from '@playwright/test';
import { createWorkspace, inviteLink, onboard, pointAtLocalRelay } from './helpers';

// The installable app as GitHub Pages serves it: manifest and icons, the service worker's offline shell, and
// notifications shown through that worker.

const ready = (page: Page) => page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope));

const notifications = (page: Page) =>
  page.evaluate(async () =>
    (await navigator.serviceWorker.ready).getNotifications().then((ns) => ns.map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data as unknown }))),
  );

test('is installable: a manifest with the icons a home screen needs', async ({ page }) => {
  await page.goto('./');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await page.request.get(new URL(href ?? '', page.url()).href);
  const manifest: unknown = await res.json();
  const icon = (sizes: string, purpose?: string) => expect.objectContaining({ sizes, ...(purpose ? { purpose } : {}) });
  expect(manifest).toMatchObject({
    name: 'Yurt',
    display: 'standalone',
    start_url: './',
    icons: expect.arrayContaining([icon('192x192'), icon('512x512'), icon('512x512', 'maskable')]),
  });
  for (const file of ['pwa-64x64.png', 'pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png'])
    expect((await page.request.get(new URL(file, res.url()).href)).ok()).toBe(true);
  const touchIcon = await page.locator('link[rel=apple-touch-icon]').getAttribute('href');
  expect((await page.request.get(new URL(touchIcon ?? '', page.url()).href)).ok()).toBe(true);
});

test('starts offline once it has been opened', async ({ page, context }) => {
  await page.goto('./');
  await ready(page);
  await page.reload(); // now under the worker's control
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Display name')).toBeVisible(); // onboarding, from the cached shell
  await context.setOffline(false);
});

test('notifies through the service worker, and closes the notification once the conversation is read', async ({ browser }) => {
  const actx = await browser.newContext();
  await actx.grantPermissions(['notifications']);
  const a = await actx.newPage();
  await pointAtLocalRelay(a);
  await onboard(a, 'Ada', 'Start chatting');
  await createWorkspace(a, 'Ping');
  await ready(a);
  // Notifications on (Settings → Preferences), then away from #general.
  await a.getByTestId('me-row').click();
  await a.getByTestId('settings-nav-preferences').click();
  await a.getByRole('switch', { name: 'Notifications' }).click();
  await a.keyboard.press('Escape');
  await a.getByRole('button', { name: 'New channel' }).click();
  await a.getByLabel('Name').fill('side');
  await a.getByRole('button', { name: 'Create channel' }).click();
  await expect(a).toHaveURL(/\/c\/side/);

  const b = await (await browser.newContext()).newPage();
  await b.goto(await inviteLink(a));
  await onboard(b, 'Bo', 'Join workspace');
  const composer = b.getByRole('textbox', { name: 'Message #general' });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill('hey @ada, look');
  await composer.press('Enter');

  // Shown by the worker (the only way phones show them), tagged with the message.
  await expect
    .poll(() => notifications(a), { timeout: 30_000 })
    .toEqual([expect.objectContaining({ title: 'Bo in #general', body: 'hey @ada, look', data: expect.objectContaining({ ch: 'general' }) })]);
  await a
    .getByRole('button', { name: /general/ })
    .first()
    .click();
  await expect.poll(() => notifications(a)).toEqual([]);
});

test('keeps working where the worker can’t notify (Safari in a tab has no getNotifications)', async ({ page }) => {
  await page.addInitScript(() => {
    // Safari in a tab: a worker registration without the method.
    Reflect.deleteProperty(ServiceWorkerRegistration.prototype, 'getNotifications');
  });
  await pointAtLocalRelay(page);
  await onboard(page, 'Ada', 'Start chatting');
  await createWorkspace(page, 'Tab');
  await ready(page);
  // A new message marks the open conversation read, which closes its notifications: what crashed on iOS.
  const composer = page.getByRole('textbox', { name: 'Message #general' });
  await composer.fill('still here');
  await composer.press('Enter');
  await expect(page.getByText('still here')).toBeVisible();
  await expect(page.getByTestId('crash')).toHaveCount(0);
});

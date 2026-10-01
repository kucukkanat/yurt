import { afterAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { createWorkspace, startApp, until, useApp } from '../app';
import { adopt } from '../../../../src/lib/swClient';
import { announce, closeNotifications } from '../../../../src/lib/notifications';

// With a registered service worker, as in the installed app: notifications go through it. The worker is
// test/browser/fixtures/sw.js (the app's own only exists in the production build); the registration is Chromium's own.

let code = '';
let reg: ServiceWorkerRegistration;

afterAll(() => reg.unregister());

describe('with a service worker', () => {
  it('hands notifications to the worker once one is registered', async () => {
    await startApp({ as: 'Ada' });
    code = await createWorkspace('Northwind');
    reg = await navigator.serviceWorker.register('/test/browser/fixtures/sw.js', { scope: '/test/browser/fixtures/' });
    await until(() => !!reg.active, 10_000, 'the worker');
    adopt(reg);
    // Notifications aren't allowed in this browser: the worker shows nothing, and closing what's read still works.
    // (Headless Chromium never lets a worker show one; e2e/pwa.spec.ts sees the built app's worker do it.)
    await announce({ code, ch: 'general', title: 'Bo', body: 'hello', tag: code + ':1' }, () => {});
    closeNotifications(code, 'general');
    expect(await reg.getNotifications()).toEqual([]);
  });

  it('says when Yurt is already installed', async () => {
    useApp.setState({ standalone: true }); // what main.tsx finds at start in the installed app
    useApp.getState().setDialog(null);
    useApp.getState().openSettings('app');
    await expect.element(page.getByTestId('app-installed')).toBeVisible();
    useApp.setState({ standalone: false });
  });
});

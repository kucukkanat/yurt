import { Workbox } from 'workbox-window';
import { useApp } from '../store';
import { mayNotify } from './format';
import { setNotifier, type Notifier } from './notifications';
import { noticeDataOf, openOf } from './swLogic';

/*
 * The page's side of the service worker: registering it, offering a new version, and showing notifications through
 * it. It only runs in a built app with a worker (dev and unit tests have none), so it's
 * kept to wiring and checked end to end (e2e/pwa.spec.ts); the decisions live in tested modules.
 */

const ICON = 'pwa-192x192.png';
const BADGE = 'pwa-64x64.png';

/** Notifications through the worker: the only kind phones show (Android Chrome refuses `new Notification`). */
const workerNotifier = (reg: ServiceWorkerRegistration): Notifier => ({
  async show(n) {
    if (await mayNotify()) await reg.showNotification(n.title, { body: n.body, tag: n.tag, data: { code: n.code, ch: n.ch }, icon: ICON, badge: BADGE });
  },
  close(code, ch) {
    void reg.getNotifications().then((list) => {
      for (const x of list) {
        const d = noticeDataOf(x.data);
        if (d?.code === code && d.ch === ch) x.close();
      }
    });
  },
});

/** Registers the worker (production builds only: dev has none), and offers a reload when a new version is waiting. */
export async function startServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const wb = new Workbox(import.meta.env.BASE_URL + 'sw.js');
  wb.addEventListener('waiting', () =>
    useApp.getState().toast({
      title: 'A new version of Yurt is ready',
      actionLabel: 'Reload',
      duration: 0, // until answered: never interrupt someone mid-message
      onAction: () => {
        wb.addEventListener('controlling', () => location.reload());
        wb.messageSkipWaiting();
      },
    }),
  );
  // A notification clicked while the app is open: the worker asks this window to show the conversation.
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = openOf(e.data);
    if (d) useApp.getState().go(d);
  });
  const reg = await wb.register();
  if (reg) adopt(reg);
}

/** Shows notifications through a registered worker from now on. */
export function adopt(reg: ServiceWorkerRegistration) {
  setNotifier(workerNotifier(reg));
}

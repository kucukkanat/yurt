import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { conversationUrl, isSkipWaiting, noticeDataOf, openMessage } from './lib/swLogic';

/*
 * The service worker: caches the app shell so it starts offline, and opens the conversation a notification (shown by
 * the app through this worker) is about. Decisions live in lib/swLogic.ts (tested there); this
 * file only wires them to worker events, and is checked end to end (e2e/pwa.spec.ts).
 *
 * The app's TypeScript program uses the DOM library, which lacks the worker-only types, so the few used here are
 * declared below rather than mixing the WebWorker library into the whole app.
 */
interface WorkerEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface NotificationEventLike extends WorkerEvent {
  readonly notification: Notification;
}
interface WindowClientLike {
  focus(): Promise<unknown>;
  postMessage(message: unknown): void;
}
interface ServiceWorkerScope {
  readonly registration: ServiceWorkerRegistration;
  readonly clients: {
    matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'notificationclick', f: (e: NotificationEventLike) => void): void;
  addEventListener(type: 'message', f: (e: MessageEvent) => void): void;
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0];
}
declare const self: ServiceWorkerScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

// The app asks for this when the user accepts "Reload" on a new version (lib/swClient.ts).
self.addEventListener('message', (e) => {
  if (isSkipWaiting(e.data)) void self.skipWaiting();
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = noticeDataOf(e.notification.data);
  if (!d) return;
  e.waitUntil(
    windows().then(async (open) => {
      const w = open[0];
      if (!w) return self.clients.openWindow(conversationUrl(self.registration.scope, d));
      w.postMessage(openMessage(d));
      return w.focus();
    }),
  );
});

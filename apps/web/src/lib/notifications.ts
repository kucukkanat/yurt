import { notify } from './format';

/** A notification about one message; `tag` ("<code>:<message id>") keeps it to one per message. */
export interface Notice {
  code: string;
  ch: string;
  title: string;
  body: string;
  tag: string;
}

/** Shows notifications and closes a conversation's once it's read. */
export interface Notifier {
  show(n: Notice, open: () => void): Promise<void>;
  close(code: string, ch: string): void;
}

/**
 * Page notifications (`new Notification`), per conversation ("code/ch"), so opening one closes its notifications.
 * Used until the service worker takes over (lib/swClient.ts): phones only show notifications from a worker.
 */
const shown = new Map<string, Notification[]>();
const keyOf = (code: string, ch: string) => code + '/' + ch;
const pageNotifier: Notifier = {
  async show(n, open) {
    const shownNow = await notify(n.title, n.body, n.tag, open);
    if (!shownNow) return;
    const key = keyOf(n.code, n.ch);
    shown.set(key, [...(shown.get(key) ?? []), shownNow]);
  },
  close(code, ch) {
    const key = keyOf(code, ch);
    for (const x of shown.get(key) ?? []) x.close();
    shown.delete(key);
  },
};

let notifier = pageNotifier;
/** Hands notifications to the service worker once it's registered. */
export const setNotifier = (n: Notifier) => {
  notifier = n;
};

/** Shows a notification for a message (if permitted); clicking it runs `open`. */
export const announce = (n: Notice, open: () => void) => notifier.show(n, open);

/** Closes the notifications for a conversation the user is now reading. */
export const closeNotifications = (code: string, ch: string) => notifier.close(code, ch);

/** The page notifications on screen for a conversation, oldest first. */
export const notificationsFor = (code: string, ch: string): readonly Notification[] => [...(shown.get(keyOf(code, ch)) ?? [])];

import { notify } from './format';

/**
 * Desktop notifications this tab is showing, per conversation ("code/ch"). Opening the conversation closes them,
 * so the notification centre doesn't keep messages the user has already read.
 */
const shown = new Map<string, Notification[]>();
const keyOf = (code: string, ch: string) => code + '/' + ch;

/** Shows a notification for a message in `ch` (if permitted); clicking it runs `open`. */
export async function announce(code: string, ch: string, title: string, body: string, open: () => void): Promise<void> {
  const n = await notify(title, body, open);
  if (!n) return;
  const key = keyOf(code, ch);
  shown.set(key, [...(shown.get(key) ?? []), n]);
}

/** Closes the notifications for a conversation the user is now reading. */
export function closeNotifications(code: string, ch: string) {
  const key = keyOf(code, ch);
  for (const n of shown.get(key) ?? []) n.close();
  shown.delete(key);
}

/** The notifications on screen for a conversation, oldest first. */
export const notificationsFor = (code: string, ch: string): readonly Notification[] => [...(shown.get(keyOf(code, ch)) ?? [])];

/** An error's message for people: the message of an Error, or the thrown value itself. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function fmtBytes(n: number): string {
  return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
}

export function handleFrom(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 24) || 'me'
  );
}

/** Whether this browser can show notifications at all (iOS Safari outside a home-screen app can't). */
const canNotify = () => 'Notification' in window;

/** Asks for permission to notify (the browser only prompts while undecided); true when granted. */
export async function askNotifications(): Promise<boolean> {
  return canNotify() && (await Notification.requestPermission()) === 'granted';
}

/**
 * Shows a desktop notification if allowed, and returns it (null when not shown). Permission is read live
 * from the Permissions API: `Notification.permission` can lag behind a change made in the browser's settings.
 */
export async function notify(title: string, body: string, onClick?: () => void): Promise<Notification | null> {
  if (!canNotify() || (await navigator.permissions.query({ name: 'notifications' })).state !== 'granted') return null;
  const n = new Notification(title, { body, tag: title });
  n.onclick = () => {
    window.focus();
    onClick?.();
    n.close();
  };
  return n;
}

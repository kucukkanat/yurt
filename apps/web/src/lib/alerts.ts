/**
 * In-app signals for a message that alerts me (lib/notifications.ts Notice) in a conversation I'm not looking at: a
 * toast and a chime. The OS notification is decided separately (Settings → Notifications, browser permission).
 */

/** Chimes closer together than this are dropped: a burst of messages is one sound, not a ringtone. */
export const CHIME_GAP_MS = 2000;

/** How long a message toast stays (hover or focus pauses it). */
export const MESSAGE_TOAST_MS = 6000;

export interface AlertCtx {
  /** Focus mode: this device stays quiet. */
  focus: boolean;
  /** Settings → Sound. */
  sound: boolean;
  /** The message's conversation is the one on screen (only possible while the tab is hidden). */
  onScreen: boolean;
  /** An OS notification is going out for it, and makes its own sound (the tab is hidden, notifications are on). */
  osAlert: boolean;
}

/** Which in-app signals a Notice gets. */
export function inAppAlerts(c: AlertCtx): { toast: boolean; sound: boolean } {
  if (c.focus) return { toast: false, sound: false };
  return { toast: !c.onScreen, sound: c.sound && !c.osAlert };
}

/** A chime is due when the last one played long enough ago. */
export const chimeDue = (now: number, last: number) => now - last >= CHIME_GAP_MS;

/** One toast per conversation: a newer message replaces the older one's toast. */
export const messageToastKey = (code: string, ch: string) => 'msg:' + code + '/' + ch;

/** The tab title with the alerting unread count in front, like "(3) Yurt". */
export const titleWith = (base: string, alerting: number) => (alerting > 0 ? `(${alerting > 99 ? '99+' : alerting}) ${base}` : base);

/** The narrow screen's menu button names what waits elsewhere: a count for alerting messages, else that there's news. */
export function menuLabel(u: { m: number; n: boolean }): string {
  if (u.m > 0) return `Open sidebar, ${u.m} unread`;
  return u.n ? 'Open sidebar, new messages' : 'Open sidebar';
}

/** The count on the menu button: short enough for a small dot. */
export const menuCount = (m: number) => (m > 9 ? '9+' : String(m));

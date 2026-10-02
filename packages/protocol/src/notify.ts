import type { Msg, WsState } from './reduce';
import { mentions } from './reduce';

/** What a notification says, and the conversation it opens. */
export interface Notice {
  title: string;
  body: string;
  ch: string;
}

/**
 * Whether `m` is a reply in a thread `me` is in: one I started or replied to myself (my agents' replies are not mine).
 * Such replies reach me like a mention: they count as unread in their conversation and notify.
 */
export function inMyThread(m: Msg, s: WsState, me: string): boolean {
  const parent = m.parent === undefined ? undefined : s.msgs.get(m.parent);
  if (!parent) return false;
  const mine = (x: Msg | undefined) => !!x && x.a === me && !x.ag;
  return mine(parent) || parent.replies.some((id) => id !== m.id && mine(s.msgs.get(id)));
}

/**
 * Whether message `m` should notify `me`, and what the notification says: a DM, a private agent chat, an agent asking for approval, an
 * @mention of my handle, or a reply in a thread I'm in, never my own messages (my agents' are not mine), never in a muted conversation.
 * Freshness and "already looking at it" are the caller's to judge.
 */
export function noticeFor(m: Msg, s: WsState, me: string, muted: readonly string[]): Notice | null {
  if ((m.a === me && !m.ag) || m.deleted || muted.includes(m.ch)) return null;
  const direct = m.ch.startsWith('dm:') || m.ch.startsWith('adm:') || m.ch.startsWith('gdm:');
  const handle = s.profiles.get(me)?.handle.toLowerCase();
  if (!direct && !(handle && mentions(m.text).includes(handle)) && !inMyThread(m, s, me)) return null;
  const author = m.ag ? s.agents.get(m.a + '/' + m.ag)?.name || 'Agent' : s.profiles.get(m.a)?.name || 'Someone';
  if (m.approval) return { title: author + ' needs you', body: m.approval.title, ch: m.ch };
  // A channel message is only in the state when its channel is; the fallback just satisfies the types.
  const channel = s.channels.get(m.ch)?.name ?? m.ch;
  return { title: direct ? author : author + ' in #' + channel, body: m.text.slice(0, 140), ch: m.ch };
}

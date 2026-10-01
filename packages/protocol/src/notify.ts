import type { Msg, WsState } from './reduce';
import { mentions } from './reduce';

/** What a notification says, and the conversation it opens. */
export interface Notice {
  title: string;
  body: string;
  ch: string;
}

/**
 * Whether message `m` should notify `me`, and what the notification says: a DM, a private agent chat, an agent asking for approval, or an
 * @mention of my handle, never my own messages (my agents' are not mine), never in a muted conversation.
 * Freshness and "already looking at it" are the caller's to judge.
 */
export function noticeFor(m: Msg, s: WsState, me: string, muted: readonly string[]): Notice | null {
  if ((m.a === me && !m.ag) || m.deleted || muted.includes(m.ch)) return null;
  const direct = m.ch.startsWith('dm:') || m.ch.startsWith('adm:') || m.ch.startsWith('gdm:');
  const handle = s.profiles.get(me)?.handle.toLowerCase();
  if (!direct && !(handle && mentions(m.text).includes(handle))) return null;
  const author = m.ag ? s.agents.get(m.a + '/' + m.ag)?.name || 'Agent' : s.profiles.get(m.a)?.name || 'Someone';
  if (m.approval) return { title: author + ' needs you', body: m.approval.title, ch: m.ch };
  // A channel message is only in the state when its channel is; the fallback just satisfies the types.
  const channel = s.channels.get(m.ch)?.name ?? m.ch;
  return { title: direct ? author : author + ' in #' + channel, body: m.text.slice(0, 140), ch: m.ch };
}

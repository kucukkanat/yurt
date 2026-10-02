import type { Msg, WsState } from './reduce';
import { mentions } from './reduce';
import { isPrivateChannel } from './codes';
import type { NotifyLevel } from './schemas';

/** What a notification says, and the conversation it opens. */
export interface Notice {
  title: string;
  body: string;
  ch: string;
}

/**
 * How much conversation `ch` alerts `me`: my newest `notify` setting for it (synced across my devices), else the default:
 * every message in a private conversation (DM, agent chat), @mentions in a channel.
 */
export function levelOf(s: WsState, me: string, ch: string): NotifyLevel {
  return s.levels.get(me)?.get(ch) ?? (isPrivateChannel(ch) ? 'all' : 'mentions');
}

/**
 * Whether message `m` alerts `me` (whose handle is `handle`) at `level`: never my own (my agents' are not mine) or deleted ones;
 * at `all` every other message, at `mentions` an @mention of my handle or an agent asking for approval, at `none` nothing.
 */
export function alerts(m: Msg, me: string, handle: string | undefined, level: NotifyLevel): boolean {
  if ((m.a === me && !m.ag) || m.deleted || level === 'none') return false;
  if (level === 'all' || m.approval) return true;
  return !!handle && mentions(m.text).includes(handle.toLowerCase());
}

/**
 * Whether message `m` should notify `me`, and what the notification says, following the conversation's level (`levelOf`).
 * Freshness and "already looking at it" are the caller's to judge.
 */
export function noticeFor(m: Msg, s: WsState, me: string): Notice | null {
  if (!alerts(m, me, s.profiles.get(me)?.handle, levelOf(s, me, m.ch))) return null;
  const author = m.ag ? s.agents.get(m.a + '/' + m.ag)?.name || 'Agent' : s.profiles.get(m.a)?.name || 'Someone';
  if (m.approval) return { title: author + ' needs you', body: m.approval.title, ch: m.ch };
  if (isPrivateChannel(m.ch)) return { title: author, body: m.text.slice(0, 140), ch: m.ch };
  // A channel message is only in the state when its channel is; the fallback just satisfies the types.
  const channel = s.channels.get(m.ch)?.name ?? m.ch;
  return { title: author + ' in #' + channel, body: m.text.slice(0, 140), ch: m.ch };
}

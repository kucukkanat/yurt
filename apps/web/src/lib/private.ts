import { agentKey, agentPrefs, fingerprint, parseGuestDm, type WsState } from '@yurt/protocol';

export type AgentPrefs = ReturnType<typeof agentPrefs>;

/** One-to-one conversations with a person, or with someone else's agent: every message is for you. */
export const isDirect = (ch: string) => ch.startsWith('dm:') || ch.startsWith('gdm:');

/**
 * Who a private event in `ch` is addressed to when I write it. Reactions use this too, not the reacted
 * message's `to`: that is me when the message came from the other side, so it would never leave my devices.
 */
export function privateTarget(ch: string, me: string): string | undefined {
  if (ch.startsWith('dm:')) return ch.slice(3).split(':').find((k) => k !== me) || me;
  if (ch.startsWith('adm:')) return me;
  // A guest DM pairs the member with the agent's owner. Only the member writes here as a human (the owner's
  // side is the agent, posted by the bridge), so the conversation is read-only for the owner.
  return parseGuestDm(ch)?.owner;
}

/** "answers @mentions and replies · posts in thread + channel · discoverable" */
export function prefsLine(p: AgentPrefs): string {
  const when = [p.respondTo.mentions && '@mentions', p.respondTo.replies && 'replies'].filter(Boolean).join(' and ') || 'only private chats';
  const where = p.postIn.thread && p.postIn.channel ? 'thread + channel' : p.postIn.thread ? 'thread' : 'channel';
  return 'answers ' + when + ' · posts in ' + where + (p.discoverable ? ' · discoverable' : '');
}

/** The member talks to "Harvey (Ada’s agent)"; the owner sees who is talking to their agent: "Bea ↔ Harvey". */
export function guestDmTitle(state: WsState | undefined, ch: string, me: string): string | null {
  const g = parseGuestDm(ch);
  if (!g) return null;
  const name = (pub: string) => state?.profiles.get(pub)?.name || fingerprint(pub);
  const agent = state?.agents.get(agentKey(g.owner, g.agentId))?.name || g.agentId;
  return g.member === me ? agent + ' (' + name(g.owner) + '’s agent)' : name(g.member) + ' ↔ ' + agent;
}

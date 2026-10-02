import { useEffect, useState } from 'react';
import { agentKey, agentPrefs, fingerprint, liveAgents, members, mentions, type WsState, type WorkspacePeer, type Msg } from '@yurt/protocol';
import { isDirect, guestDmTitle, type AgentPrefs } from './lib/private';
export { prefsLine } from './lib/private';
import { useApp, type WsRecord, type AppState } from './store';
import { CALM, type FaviconState } from './lib/favicon';
import { getPeer } from './lib/net';
import { presenceNow } from './lib/visibility';
import { readUpTo } from './lib/collab';

export interface Person {
  id: string;
  pub: string;
  agentId?: string | undefined;
  name: string;
  handle: string;
  kind: 'human' | 'agent';
  self?: boolean | undefined;
  owner?: { name: string; self?: boolean | undefined } | undefined;
  presence?: 'online' | 'away' | 'offline' | undefined;
  working?: boolean | undefined;
  admin?: boolean | undefined;
  creator?: boolean | undefined;
  runtime?: string | undefined;
  banned?: boolean | undefined;
  /** Agents only: when it answers, where it posts, and whether other members can DM it. */
  prefs?: AgentPrefs | undefined;
  /** People: in focus mode. */
  focus?: boolean | undefined;
  /** Agents: the task or doc it's working on, by name. */
  workingOn?: string | undefined;
}

/** Workspace views only render after onboarding; reaching one without an identity is a bug, so it fails loudly. */
export function needIdentity<T>(identity: T | null): T {
  if (!identity) throw new Error('useCurrent needs an identity: render workspace views only after onboarding');
  return identity;
}

export function useCurrent() {
  const route = useApp((s) => s.route);
  const state = useApp((s) => (route.code ? s.states[route.code] : undefined));
  const rec = useApp((s) => s.workspaces.find((w) => w.code === route.code));
  const identity = needIdentity(useApp((s) => s.identity));
  useApp((s) => s.tick);
  return { route, state, rec, identity, peer: getPeer(route.code) };
}

export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}

function presenceOf(peer: WorkspacePeer | undefined, pub: string, me: string): 'online' | 'away' | 'offline' {
  if (pub === me) return presenceNow();
  let best: 'away' | 'offline' = 'offline';
  if (peer)
    for (const pr of peer.presence.values()) {
      if (pr.pub !== pub || pr.bridge) continue;
      if (pr.st === 'online') return 'online';
      best = 'away';
    }
  return best;
}

/** Someone (or I) turned on focus mode. */
function inFocus(peer: WorkspacePeer | undefined, pub: string, me: string): boolean {
  if (!peer) return false;
  if (pub === me) return !!peer.myPresence.focus;
  return [...peer.presence.values()].some((p) => p.pub === pub && !p.bridge && p.focus);
}

/** Other members online: distinct people, not sessions, so my own tabs and my bridge don't count. */
export function othersOnline(peer: WorkspacePeer | undefined, me: string): number {
  const pubs = new Set<string>();
  if (peer) for (const pr of peer.presence.values()) if (!pr.bridge && pr.pub !== me) pubs.add(pr.pub);
  return pubs.size;
}

function agentPresence(peer: WorkspacePeer | undefined, owner: string, id: string): { online: boolean; working: string | null; on: string | null } {
  if (peer)
    for (const pr of peer.presence.values()) {
      if (pr.pub === owner && pr.bridge && pr.agents && id in pr.agents) return { online: true, working: pr.agents[id]?.working || null, on: pr.agents[id]?.on || null };
    }
  return { online: false, working: null, on: null };
}

/** "the task “Ship it”" / "the doc “Spec”" for an agent's presence `on`, if the workspace has it. */
function onLabel(state: WsState | undefined, on: string | null): string | undefined {
  const task = on?.startsWith('task:') ? state?.tasks.get(on.slice(5)) : undefined;
  const doc = on?.startsWith('doc:') ? state?.docs.get(on.slice(4)) : undefined;
  return task ? 'task “' + task.title + '”' : doc ? '“' + doc.title + '”' : undefined;
}

/** "a/b/c" split at the first `sep`: ["a", "b/c"]; without one, ["a", ""]. */
const splitOnce = (s: string, sep: string): [string, string] => {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
};

/** A person or agent as the roster shows them (presence always known). */
export type Listed = Person & { presence: NonNullable<Person['presence']> };

export function personFor(state: WsState | undefined, peer: WorkspacePeer | undefined, key: string, me: string): Listed {
  const [pub, agentId] = splitOnce(key, '/');
  if (agentId) {
    const a = state?.agents.get(key);
    const owner = state?.profiles.get(pub);
    const pr = agentPresence(peer, pub, agentId);
    return {
      id: key,
      pub,
      agentId,
      name: a?.name || agentId,
      handle: a?.handle || agentId,
      kind: 'agent',
      runtime: a?.runtime,
      prefs: a ? agentPrefs(a) : undefined,
      owner: { name: pub === me ? 'You' : owner?.name || 'Someone', self: pub === me },
      presence: pr.online ? 'online' : 'offline',
      working: !!pr.working,
      workingOn: onLabel(state, pr.on),
    };
  }
  const p = state?.profiles.get(pub);
  return {
    id: key,
    pub,
    name: p?.name || fingerprint(pub),
    handle: p?.handle || pub.slice(0, 8),
    kind: 'human',
    self: pub === me,
    presence: presenceOf(peer, pub, me),
    admin: state?.admins.has(pub),
    creator: state?.creator === pub,
    banned: state?.bans.has(pub),
    focus: inFocus(peer, pub, me),
  };
}

export const authorKey = (m: Pick<Msg, 'a' | 'ag'>) => (m.ag ? agentKey(m.a, m.ag) : m.a);

const RANK = { online: 0, away: 1, offline: 2 } as const;
/** Online first, then by name. */
const byPresence = (xs: Listed[]) => [...xs].sort((a, b) => RANK[a.presence] - RANK[b.presence] || a.name.localeCompare(b.name));

/** Everyone in the workspace: people (me included, even before my profile syncs), then agents. */
export function roster(state: WsState | undefined, peer: WorkspacePeer | undefined, me: string): Listed[] {
  if (!state) return [];
  const people = members(state).map((k) => personFor(state, peer, k, me));
  if (!people.some((p) => p.pub === me)) people.unshift(personFor(state, peer, me, me));
  const agents = liveAgents(state).map((a) => personFor(state, peer, agentKey(a.owner, a.id), me));
  return [...byPresence(people), ...byPresence(agents)];
}

export function unread(state: WsState, rec: WsRecord | undefined, ch: string, me: string, handle: string) {
  // Read here, or on another of my devices (read marks sync privately).
  const last = readUpTo(rec?.lastRead[ch], state, me, ch);
  // Newest first, stopping at the first message already read.
  const newest = (state.channelMsgs.get(ch) ?? [])
    .map((id) => state.msgs.get(id))
    .filter((x): x is Msg => !!x)
    .reverse();
  let n = 0;
  let m = 0;
  for (const x of newest) {
    if (x.ts <= last) break;
    if ((x.a === me && !x.ag) || x.deleted) continue;
    n++;
    if (mentions(x.text).includes(handle) || isDirect(ch) || (ch.startsWith('adm:') && x.approval)) m++;
  }
  return { n, m };
}

export function channelTitle(state: WsState | undefined, ch: string, me: string): string {
  if (ch.startsWith('dm:')) {
    const other =
      ch
        .slice(3)
        .split(':')
        .find((k) => k !== me) || me;
    return state?.profiles.get(other)?.name || fingerprint(other);
  }
  if (ch.startsWith('adm:')) {
    const [owner, id] = splitOnce(ch.slice(4), ':');
    return state?.agents.get(owner + '/' + id)?.name || id;
  }
  const guest = guestDmTitle(state, ch, me);
  if (guest) return guest;
  return state?.channels.get(ch)?.name || ch;
}

/**
 * What the tab icon should show (see lib/favicon.ts): unread mentions and DMs across every workspace,
 * other unread messages, calls, and whether we're cut off. The channel on screen doesn't count while
 * I'm looking (visible and focused), matching the sidebar.
 */
/** A call is going on in this workspace that I'm not in. */
function callNearby(s: AppState, code: string, p: WorkspacePeer | undefined): boolean {
  if (!p) return false;
  for (const h of p.huddles.values()) if (h.ch && !(s.huddle.code === code && s.huddle.ch === h.ch)) return true;
  return false;
}

/** Mentions and whether anything is unread in a workspace, skipping muted conversations and the one on screen. */
function unreadIn(s: AppState, w: WsRecord, me: { pub: string; handle: string }, visible: boolean): { m: number; n: boolean } {
  const st = s.states[w.code];
  let m = 0;
  let n = false;
  if (st)
    for (const ch of st.channelMsgs.keys()) {
      if (w.muted.includes(ch) || (visible && s.route.code === w.code && s.route.ch === ch)) continue;
      const u = unread(st, w, ch, me.pub, me.handle);
      m += u.m;
      n ||= u.n > 0;
    }
  return { m, n };
}

/**
 * Unread across every workspace: `m` messages that alert me (the tab title, app badge and menu button count them),
 * `n` whether anything is unread. Skips muted conversations and, while `visible`, the one on screen.
 */
export function unreadEverywhere(s: AppState, visible: boolean): { m: number; n: boolean } {
  const me = s.identity;
  if (!me) return { m: 0, n: false };
  const counts = s.workspaces.map((w) => unreadIn(s, w, me, visible));
  return { m: counts.reduce((sum, c) => sum + c.m, 0), n: counts.some((c) => c.n) };
}

export function faviconStateOf(s: AppState, peerOf: (code: string) => WorkspacePeer | undefined, visible: boolean): FaviconState {
  if (!s.identity) return CALM;
  const { m: mentionCount, n: unreadAny } = unreadEverywhere(s, visible);
  const nearby = s.workspaces.some((w) => callNearby(s, w.code, peerOf(w.code)));
  const cur = s.route.code ? peerOf(s.route.code) : undefined;
  // Offline: no network, or no relay reachable.
  const offline = !s.online || (!!cur && !cur.connected);
  return { mentions: mentionCount, unread: unreadAny, inCall: !!s.huddle.ch, callNearby: nearby, offline };
}

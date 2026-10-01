import { useEffect, useState } from 'react';
import { agentKey, agentPrefs, fingerprint, liveAgents, members, mentions, type WsState, type WorkspacePeer, type Msg } from '@yurt/protocol';
import { isDirect, guestDmTitle, type AgentPrefs } from './lib/private';
export { prefsLine } from './lib/private';
import { useApp, type WsRecord, type AppState } from './store';
import { CALM, type FaviconState } from './lib/favicon';
import { getPeer } from './lib/net';

export interface Person {
  id: string;
  pub: string;
  agentId?: string;
  name: string;
  handle: string;
  kind: 'human' | 'agent';
  self?: boolean;
  owner?: { name: string; self?: boolean };
  presence?: 'online' | 'away' | 'offline';
  working?: boolean;
  admin?: boolean;
  creator?: boolean;
  runtime?: string;
  banned?: boolean;
  /** Agents only: when it answers, where it posts, and whether other members can DM it. */
  prefs?: AgentPrefs;
}

export function useCurrent() {
  const route = useApp((s) => s.route);
  const state = useApp((s) => (route.code ? s.states[route.code] : undefined));
  const rec = useApp((s) => s.workspaces.find((w) => w.code === route.code));
  const identity = useApp((s) => s.identity);
  useApp((s) => s.tick);
  // Workspace views only render after onboarding; reaching one without an identity is a bug.
  if (!identity) throw new Error('useCurrent needs an identity: render workspace views only after onboarding');
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
  if (pub === me) return document.hidden ? 'away' : 'online';
  let best: 'away' | 'offline' = 'offline';
  if (peer)
    for (const pr of peer.presence.values()) {
      if (pr.pub !== pub || pr.bridge) continue;
      if (pr.st === 'online') return 'online';
      best = 'away';
    }
  return best;
}

/** Other members online: distinct people, not sessions, so my own tabs and my bridge don't count. */
export function othersOnline(peer: WorkspacePeer | undefined, me: string): number {
  const pubs = new Set<string>();
  if (peer) for (const pr of peer.presence.values()) if (!pr.bridge && pr.pub !== me) pubs.add(pr.pub);
  return pubs.size;
}

function agentPresence(peer: WorkspacePeer | undefined, owner: string, id: string): { online: boolean; working: string | null } {
  if (peer)
    for (const pr of peer.presence.values()) {
      if (pr.pub === owner && pr.bridge && pr.agents && id in pr.agents) return { online: true, working: pr.agents[id]?.working || null };
    }
  return { online: false, working: null };
}

export function personFor(state: WsState | undefined, peer: WorkspacePeer | undefined, key: string, me: string): Person {
  const [pub, agentId] = key.split('/');
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
  };
}

export const authorKey = (m: Pick<Msg, 'a' | 'ag'>) => (m.ag ? agentKey(m.a, m.ag) : m.a);

export function roster(state: WsState | undefined, peer: WorkspacePeer | undefined, me: string): Person[] {
  if (!state) return [];
  const people = members(state).map((k) => personFor(state, peer, k, me));
  if (!people.some((p) => p.pub === me)) people.unshift(personFor(state, peer, me, me));
  const agents = liveAgents(state).map((a) => personFor(state, peer, agentKey(a.owner, a.id), me));
  const rank = { online: 0, away: 1, offline: 2 } as const;
  return [...people, ...agents].sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === 'human' ? -1 : 1) || rank[a.presence || 'offline'] - rank[b.presence || 'offline'] || a.name.localeCompare(b.name),
  );
}

export function unread(state: WsState, rec: WsRecord | undefined, ch: string, me: string, handle: string) {
  const last = rec?.lastRead[ch] || 0;
  const ids = state.channelMsgs.get(ch) || [];
  let n = 0,
    m = 0;
  for (let i = ids.length - 1; i >= 0; i--) {
    const x = state.msgs.get(ids[i] ?? '');
    if (!x) continue;
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
    const [, owner, id] = ch.split(':');
    return state?.agents.get(owner + '/' + id)?.name || id;
  }
  const guest = guestDmTitle(state, ch, me);
  if (guest) return guest;
  return state?.channels.get(ch)?.name || ch;
}

/**
 * What the tab icon should show (see lib/favicon.ts): unread mentions and DMs across every workspace,
 * other unread messages, calls, and whether we're cut off. The channel on screen doesn't count while
 * the tab is visible, matching the sidebar.
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

export function faviconStateOf(s: AppState, peerOf: (code: string) => WorkspacePeer | undefined, visible: boolean): FaviconState {
  const me = s.identity;
  if (!me) return CALM;
  const counts = s.workspaces.map((w) => unreadIn(s, w, me, visible));
  const mentionCount = counts.reduce((sum, c) => sum + c.m, 0);
  const unreadAny = counts.some((c) => c.n);
  const nearby = s.workspaces.some((w) => callNearby(s, w.code, peerOf(w.code)));
  const cur = s.route.code ? peerOf(s.route.code) : undefined;
  // Peer-to-peer workspaces are often alone, which isn't being offline; relay workspaces are offline without relays.
  const offline = !s.online || (cur?.transport.kind === 'nostr' && !cur.connected);
  return { mentions: mentionCount, unread: unreadAny, inCall: !!s.huddle.ch, callNearby: nearby, offline };
}

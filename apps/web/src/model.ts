import { useEffect, useState } from 'react';
import { agentKey, fingerprint, liveAgents, members, mentions, type WsState, type WorkspacePeer, type Msg } from '@yurt/protocol';
import { useApp, type WsRecord } from './store';
import { getPeer } from './lib/net';

export interface Person {
  id: string; pub: string; agentId?: string;
  name: string; handle: string; kind: 'human' | 'agent';
  self?: boolean; owner?: { name: string; self?: boolean };
  presence?: 'online' | 'away' | 'offline'; working?: boolean;
  admin?: boolean; creator?: boolean; runtime?: string; banned?: boolean;
}

export function useCurrent() {
  const route = useApp((s) => s.route);
  const state = useApp((s) => (route.code ? s.states[route.code] : undefined));
  const rec = useApp((s) => s.workspaces.find((w) => w.code === route.code));
  const identity = useApp((s) => s.identity)!;
  useApp((s) => s.tick);
  return { route, state, rec, identity, peer: getPeer(route.code) };
}

export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}

export function presenceOf(peer: WorkspacePeer | undefined, pub: string, me: string): 'online' | 'away' | 'offline' {
  if (pub === me) return document.hidden ? 'away' : 'online';
  let best: 'away' | 'offline' = 'offline';
  if (peer) for (const [pid, p] of peer.peers) {
    if (p.pub !== pub) continue;
    const pr = peer.presence.get(pid);
    if (pr?.bridge) continue;
    if (!pr || pr.st === 'online') return 'online';
    best = 'away';
  }
  return best;
}

export function agentPresence(peer: WorkspacePeer | undefined, owner: string, id: string): { online: boolean; working: string | null } {
  if (peer) for (const [pid, p] of peer.peers) {
    if (p.pub !== owner) continue;
    const pr = peer.presence.get(pid);
    if (pr?.bridge && pr.agents && id in pr.agents) return { online: true, working: pr.agents[id]?.working || null };
  }
  return { online: false, working: null };
}

export function personFor(state: WsState | undefined, peer: WorkspacePeer | undefined, key: string, me: string): Person {
  const [pub, agentId] = key.split('/');
  if (agentId) {
    const a = state?.agents.get(key);
    const owner = state?.profiles.get(pub);
    const pr = agentPresence(peer, pub, agentId);
    return { id: key, pub, agentId, name: a?.name || agentId, handle: a?.handle || agentId, kind: 'agent', runtime: a?.runtime,
      owner: { name: pub === me ? 'You' : owner?.name || 'Someone', self: pub === me }, presence: pr.online ? 'online' : 'offline', working: !!pr.working };
  }
  const p = state?.profiles.get(pub);
  return { id: key, pub, name: p?.name || fingerprint(pub), handle: p?.handle || pub.slice(0, 8), kind: 'human', self: pub === me,
    presence: presenceOf(peer, pub, me), admin: state?.admins.has(pub), creator: state?.creator === pub, banned: state?.bans.has(pub) };
}

export const authorKey = (m: Pick<Msg, 'a' | 'ag'>) => (m.ag ? agentKey(m.a, m.ag) : m.a);

export function roster(state: WsState | undefined, peer: WorkspacePeer | undefined, me: string): Person[] {
  if (!state) return [];
  const people = members(state).map((k) => personFor(state, peer, k, me));
  if (!people.some((p) => p.pub === me)) people.unshift(personFor(state, peer, me, me));
  const agents = liveAgents(state).map((a) => personFor(state, peer, agentKey(a.owner, a.id), me));
  const rank = { online: 0, away: 1, offline: 2 } as const;
  return [...people, ...agents].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'human' ? -1 : 1) || rank[a.presence || 'offline'] - rank[b.presence || 'offline'] || a.name.localeCompare(b.name));
}

export function unread(state: WsState, rec: WsRecord | undefined, ch: string, me: string, handle: string) {
  const last = rec?.lastRead[ch] || 0;
  const ids = state.channelMsgs.get(ch) || [];
  let n = 0, m = 0;
  for (let i = ids.length - 1; i >= 0; i--) {
    const x = state.msgs.get(ids[i])!;
    if (x.ts <= last) break;
    if ((x.a === me && !x.ag) || x.deleted) continue;
    n++;
    if (mentions(x.text).includes(handle) || ch.startsWith('dm:') || (ch.startsWith('adm:') && x.approval)) m++;
  }
  return { n, m };
}

export function channelTitle(state: WsState | undefined, ch: string, me: string): string {
  if (ch.startsWith('dm:')) { const other = ch.slice(3).split(':').find((k) => k !== me) || me; return state?.profiles.get(other)?.name || fingerprint(other); }
  if (ch.startsWith('adm:')) { const [, owner, id] = ch.split(':'); return state?.agents.get(owner + '/' + id)?.name || id; }
  return state?.channels.get(ch)?.name || ch;
}

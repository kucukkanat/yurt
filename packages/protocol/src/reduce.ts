import type { Ev, MsgBody, AgentBody, ProfileBody, ChannelBody, RoleBody, BanBody, ReactBody, PinBody, EditBody, DelBody, ApproveBody, FileRef, TraceStep, ApprovalReq } from './types';
import { EDIT_WINDOW_MS, sortEvents } from './events';
import { isPrivateChannel } from './codes';

export interface Msg {
  id: string; ch: string; a: string; ag?: string; ts: number; to?: string;
  text: string; parent?: string; files: FileRef[]; trace?: TraceStep[]; meta?: string; approval?: ApprovalReq;
  edited: boolean; deleted: boolean;
  reactions: Record<string, string[]>; // icon → reactor keys ("pub" or "pub/agentId")
  replies: string[];
}
export interface Channel { id: string; name: string; topic: string; ts: number; a: string }
export interface Agent extends AgentBody { owner: string; ts: number }
export interface Profile extends ProfileBody { ts: number }

export interface WsState {
  ws: string;
  name: string;
  creator: string | null;
  admins: Set<string>;
  bans: Set<string>;
  channels: Map<string, Channel>;
  profiles: Map<string, Profile>;
  agents: Map<string, Agent>;          // key: owner/agentId
  msgs: Map<string, Msg>;
  channelMsgs: Map<string, string[]>;  // top-level messages per channel, chronological
  pins: Map<string, Set<string>>;
  approvals: Map<string, string>;      // req → optionId
}

export const agentKey = (owner: string, id: string) => owner + '/' + id;
export const reactorKey = (e: Pick<Ev, 'a' | 'ag'>) => (e.ag ? agentKey(e.a, e.ag) : e.a);

export function emptyState(ws: string): WsState {
  return { ws, name: '', creator: null, admins: new Set(), bans: new Set(), channels: new Map(), profiles: new Map(), agents: new Map(), msgs: new Map(), channelMsgs: new Map(), pins: new Map(), approvals: new Map() };
}

/**
 * Materialize workspace state from its event log. Deterministic: every peer holding the
 * same events computes the same state. `creator` pins the creator key seen on first join (TOFU).
 */
export function reduce(ws: string, events: Ev[], opts: { creator?: string | null } = {}): WsState {
  const s = emptyState(ws);
  const evs = sortEvents(events.slice());
  s.creator = opts.creator ?? evs.find((e) => e.t === 'ws.create')?.a ?? null;
  if (s.creator) s.admins.add(s.creator);
  for (const e of evs) apply(s, e);
  return s;
}

function apply(s: WsState, e: Ev) {
  if (e.ws !== s.ws) return;
  if (s.bans.has(e.a)) return;
  switch (e.t) {
    case 'ws.create':
      if (e.a === s.creator && !s.name) s.name = String(e.b?.name || 'Workspace');
      break;
    case 'profile': {
      const b = e.b as ProfileBody;
      if (!e.ag && b?.name) s.profiles.set(e.a, { name: String(b.name).slice(0, 64), handle: String(b.handle || '').slice(0, 32), ts: e.ts });
      break;
    }
    case 'ch.create': {
      const b = e.b as ChannelBody;
      if (b?.id && !s.channels.has(b.id)) s.channels.set(b.id, { id: b.id, name: String(b.name).slice(0, 60), topic: String(b.topic || ''), ts: e.ts, a: e.a });
      break;
    }
    case 'ch.update': {
      const b = e.b as ChannelBody;
      const c = b && s.channels.get(b.id);
      if (c) { if (b.name) c.name = String(b.name).slice(0, 60); if (b.topic != null) c.topic = String(b.topic); }
      break;
    }
    case 'msg': {
      const b = e.b as MsgBody;
      if (!e.ch || !b) return;
      if (!isPrivateChannel(e.ch) && !s.channels.has(e.ch)) return;
      if (s.msgs.has(e.id)) return;
      const parent = b.parent ? s.msgs.get(b.parent) : undefined;
      if (b.parent && (!parent || parent.ch !== e.ch)) return;
      const m: Msg = { id: e.id, ch: e.ch, a: e.a, ag: e.ag, ts: e.ts, to: e.to, text: String(b.text || ''), parent: parent?.id, files: Array.isArray(b.files) ? b.files : [], trace: b.trace, meta: b.meta, approval: b.approval, edited: false, deleted: false, reactions: {}, replies: [] };
      s.msgs.set(e.id, m);
      if (parent) parent.replies.push(e.id);
      else { const l = s.channelMsgs.get(e.ch) || []; l.push(e.id); s.channelMsgs.set(e.ch, l); }
      break;
    }
    case 'edit': case 'del': {
      const b = e.b as EditBody | DelBody;
      const m = b && s.msgs.get(b.target);
      if (!m || m.deleted || m.a !== e.a || (m.ag || '') !== (e.ag || '')) return;
      if (e.ts - m.ts > EDIT_WINDOW_MS || e.ts < m.ts) return;
      if (e.t === 'edit') { m.text = String((b as EditBody).text || ''); m.edited = true; }
      else { m.deleted = true; m.text = ''; m.files = []; }
      break;
    }
    case 'react': {
      const b = e.b as ReactBody;
      const m = b && s.msgs.get(b.target);
      if (!m || m.deleted || !b.icon) return;
      const who = reactorKey(e);
      const set = new Set(m.reactions[b.icon] || []);
      b.on ? set.add(who) : set.delete(who);
      if (set.size) m.reactions[b.icon] = [...set]; else delete m.reactions[b.icon];
      break;
    }
    case 'pin': {
      const b = e.b as PinBody;
      const m = b && s.msgs.get(b.target);
      if (!m) return;
      const set = s.pins.get(m.ch) || new Set<string>();
      b.on ? set.add(m.id) : set.delete(m.id);
      s.pins.set(m.ch, set);
      break;
    }
    case 'role': {
      const b = e.b as RoleBody;
      if (!b?.target) return;
      if (b.admin && e.a === s.creator) s.admins.add(b.target);
      else if (!b.admin && s.admins.has(e.a) && b.target !== s.creator) s.admins.delete(b.target);
      break;
    }
    case 'ban': {
      const b = e.b as BanBody;
      if (!b?.target || !s.admins.has(e.a) || b.target === s.creator || b.target === e.a) return;
      if (b.on) { s.bans.add(b.target); s.admins.delete(b.target); } else s.bans.delete(b.target);
      break;
    }
    case 'agent': {
      const b = e.b as AgentBody;
      if (!b?.id || !b.handle) return;
      s.agents.set(agentKey(e.a, b.id), { ...b, owner: e.a, ts: e.ts });
      break;
    }
    case 'approve': {
      const b = e.b as ApproveBody;
      if (b?.req) s.approvals.set(b.req, b.option);
      break;
    }
  }
}

/** People who have introduced themselves and aren't banned. */
export function members(s: WsState): string[] {
  return [...s.profiles.keys()].filter((k) => !s.bans.has(k));
}

export function liveAgents(s: WsState): Agent[] {
  return [...s.agents.values()].filter((a) => !a.removed && !s.bans.has(a.owner));
}

export function mentions(text: string): string[] {
  return [...text.matchAll(/(^|[^\w])@([a-z0-9][\w-]{0,31})/gi)].map((m) => m[2].toLowerCase());
}

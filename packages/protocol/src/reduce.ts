import type { Ev, AgentBody, AgentTriggers, AgentPlacement, ProfileBody, FileRef, TraceStep, ApprovalReq } from './types';
import { EDIT_WINDOW_MS, sortEvents, isEventShape } from './events';
import { isPrivateChannel, dmChannel, parseGuestDm } from './codes';

export interface Msg {
  id: string;
  ch: string;
  a: string;
  ag?: string;
  ts: number;
  to?: string;
  /** A thread reply that is also listed in the channel. */
  alsoInChannel?: boolean;
  text: string;
  parent?: string;
  files: FileRef[];
  trace?: TraceStep[];
  meta?: string;
  approval?: ApprovalReq;
  edited: boolean;
  deleted: boolean;
  reactions: Record<string, string[]>; // icon → reactor keys ("pub" or "pub/agentId"); null-prototype, so any icon is a safe key
  replies: string[];
}
/** A rekey that counts: by someone who has been an admin and isn't banned. Earliest (ts, id) wins an epoch. */
export interface ValidRekey {
  id: string;
  a: string;
  ts: number;
  epoch: number;
  keys: Record<string, string>;
  history: string;
}
export interface Channel {
  id: string;
  name: string;
  topic: string;
  ts: number;
  a: string;
}
export interface Agent extends AgentBody {
  owner: string;
  ts: number;
}
export interface Profile extends ProfileBody {
  ts: number;
}

export interface WsState {
  ws: string;
  name: string;
  creator: string | null;
  admins: Set<string>;
  bans: Set<string>;
  channels: Map<string, Channel>;
  profiles: Map<string, Profile>;
  agents: Map<string, Agent>; // key: owner/agentId
  msgs: Map<string, Msg>;
  channelMsgs: Map<string, string[]>; // top-level messages per channel, chronological
  pins: Map<string, Set<string>>;
  approvals: Map<string, string>; // req → optionId
  rekeys: ValidRekey[]; // chronological
}

export const agentKey = (owner: string, id: string) => owner + '/' + id;
export const reactorKey = (e: Pick<Ev, 'a' | 'ag'>) => (e.ag ? agentKey(e.a, e.ag) : e.a);

export function emptyState(ws: string): WsState {
  return {
    ws,
    name: '',
    creator: null,
    admins: new Set(),
    bans: new Set(),
    channels: new Map(),
    profiles: new Map(),
    agents: new Map(),
    msgs: new Map(),
    channelMsgs: new Map(),
    pins: new Map(),
    approvals: new Map(),
    rekeys: [],
  };
}

// Bodies are attacker-controlled JSON, so every field is read through these: wrong types are ignored, never coerced.
type Obj = Readonly<Record<string, unknown>>;
const obj = (x: unknown): Obj | undefined => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : undefined);
const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
const optStr = (x: unknown): boolean => x === undefined || typeof x === 'string';
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const TRACE_STATUS = new Set(['done', 'error', 'running', 'waiting', 'skipped']);

function blobRef(x: unknown): FileRef['blob'] | false {
  if (x === undefined) return undefined;
  const o = obj(x);
  if (!o || typeof o.key !== 'string' || typeof o.hash !== 'string' || !Array.isArray(o.servers) || !o.servers.every((u) => typeof u === 'string')) return false;
  return { key: o.key, hash: o.hash, servers: o.servers as string[] };
}
function fileRef(x: unknown): FileRef | undefined {
  const o = obj(x);
  const blob = o && blobRef(o.blob);
  if (!o || blob === false || typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.type !== 'string' || !num(o.size)) return undefined;
  return { id: o.id, name: o.name, size: o.size, type: o.type, ...(blob ? { blob } : {}) };
}
function traceStep(x: unknown): TraceStep | undefined {
  const o = obj(x);
  if (
    !o ||
    typeof o.title !== 'string' ||
    typeof o.status !== 'string' ||
    !TRACE_STATUS.has(o.status) ||
    !optStr(o.tool) ||
    !optStr(o.detail) ||
    !(o.ms === undefined || num(o.ms))
  )
    return undefined;
  return { title: o.title, status: o.status as TraceStep['status'], tool: str(o.tool), ms: num(o.ms) ? o.ms : undefined, detail: str(o.detail) };
}
function approvalReq(x: unknown): ApprovalReq | undefined {
  const o = obj(x);
  if (!o || typeof o.req !== 'string' || typeof o.title !== 'string' || !optStr(o.kind) || !Array.isArray(o.options)) return undefined;
  const options = o.options.flatMap((x) => {
    const p = obj(x);
    return p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.kind === 'string' ? [{ id: p.id, name: p.name, kind: p.kind }] : [];
  });
  return { req: o.req, title: o.title, kind: str(o.kind), options };
}
const list = <T>(x: unknown, f: (y: unknown) => T | undefined): T[] => (Array.isArray(x) ? x.map(f).filter((y): y is T => y !== undefined) : []);

/**
 * Private channels carry their parties in the id, so a message only belongs there when its author is
 * one of them and it's addressed to the other; otherwise a public message could pose as a DM.
 * dm:<x>:<y> (sorted): author is x or y, `to` is the other (a self-DM addresses itself).
 * adm:<owner>:<agentId>: author is the owner, speaking as itself or as that agent, and `to` is the owner.
 * gdm:<member>:<owner>:<agentId>: the member writes to the owner, or the owner as that agent writes to the member.
 */
function privateOk(e: Ev, ch: string): boolean {
  const g = parseGuestDm(ch);
  if (ch.startsWith('gdm:')) {
    if (!g || g.member === g.owner) return false;
    return (e.a === g.member && e.to === g.owner && !e.ag) || (e.a === g.owner && e.ag === g.agentId && e.to === g.member);
  }
  if (ch.startsWith('dm:')) {
    const [x, y, ...rest] = ch.slice(3).split(':');
    if (rest.length || !x || !y || dmChannel(x, y) !== ch) return false;
    return (e.a === x && e.to === y) || (e.a === y && e.to === x);
  }
  const i = ch.indexOf(':', 4);
  const owner = ch.slice(4, i);
  return i > 4 && e.a === owner && e.to === owner && (!e.ag || e.ag === ch.slice(i + 1));
}

/**
 * Materialize workspace state from its event log. Deterministic: every peer holding the same
 * events computes the same state. `creator` pins the creator key (from the invite link, else the
 * one seen on first join: TOFU). Without a pin, the earliest ws.create wins.
 */
export function reduce(ws: string, events: Ev[], opts: { creator?: string | null } = {}): WsState {
  const s = emptyState(ws);
  const evs = sortEvents(events.filter((e) => isEventShape(e) && e.ws === ws));
  s.creator = opts.creator ?? evs.find((e) => e.t === 'ws.create')?.a ?? null;
  if (s.creator) s.admins.add(s.creator);
  // Roles and bans first, so a ban removes everything its target ever wrote: authors pick their own
  // timestamps, so "events after the ban" would let a banned key backdate its way back in.
  for (const e of evs) if (e.t === 'role' || e.t === 'ban') guarded(() => authority(s, e));
  // Rekeys stay valid if their author is later demoted: members already moved to that key, and
  // voiding it would put everyone back on an older key a banned member still holds.
  const everAdmins = new Set(s.creator ? [s.creator] : []);
  for (const e of evs)
    if (e.t === 'role' && e.a === s.creator && obj(e.b)?.admin === true) {
      const t = str(obj(e.b)?.target);
      if (t) everAdmins.add(t);
    }
  const approves: Ev[] = [];
  for (const e of evs) {
    if (s.bans.has(e.a) || e.t === 'role' || e.t === 'ban') continue;
    // Approvals are checked against the request message, which may sort after the answer when clocks disagree.
    if (e.t === 'approve') approves.push(e);
    else if (e.t === 'rekey')
      guarded(() => {
        const r = parseRekey(e);
        if (r && everAdmins.has(e.a)) s.rekeys.push(r);
      });
    else guarded(() => apply(s, e));
  }
  const reqOwners = new Map<string, Set<string>>();
  for (const m of s.msgs.values()) if (m.approval) reqOwners.set(m.approval.req, (reqOwners.get(m.approval.req) ?? new Set()).add(m.a));
  for (const e of approves) {
    const b = obj(e.b);
    const req = str(b?.req),
      option = str(b?.option);
    // Only the human owner of the agent that asked may answer; never the agent itself.
    if (req && option !== undefined && !e.ag && reqOwners.get(req)?.has(e.a)) s.approvals.set(req, option);
  }
  return s;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** A rekey event's body, validated; undefined if malformed. Authority is checked separately. */
export function parseRekey(e: Ev): ValidRekey | undefined {
  const b = obj(e.b),
    keys = obj(b?.keys),
    history = str(b?.history);
  if (!b || !keys || history === undefined || !Number.isSafeInteger(b.epoch) || (b.epoch as number) < 1) return;
  const clean: Record<string, string> = Object.create(null);
  for (const [pub, k] of Object.entries(keys)) if (HEX64.test(pub) && typeof k === 'string') clean[pub] = k;
  return { id: e.id, a: e.a, ts: e.ts, epoch: b.epoch as number, keys: clean, history };
}

// Every member reduces the same log, so an event that throws would break the workspace for all of
// them, permanently. The validation above should make this unreachable; this is the backstop.
function guarded(f: () => void) {
  try {
    f();
  } catch {
    /* a hostile event is dropped, like any other invalid one */
  }
}

/** Only the creator promotes or demotes, and bans admins. Admins ban non-admins, never the creator or themselves. */
function authority(s: WsState, e: Ev) {
  const b = obj(e.b);
  const target = str(b?.target);
  if (!b || !target || target === s.creator || target === e.a) return;
  if (e.t === 'role') {
    if (e.a !== s.creator || typeof b.admin !== 'boolean') return;
    if (b.admin) s.admins.add(target);
    else s.admins.delete(target);
    return;
  }
  if (!s.admins.has(e.a) || typeof b.on !== 'boolean') return;
  if (s.admins.has(target) && e.a !== s.creator) return;
  if (b.on) {
    s.bans.add(target);
    s.admins.delete(target);
  } else s.bans.delete(target);
}

function apply(s: WsState, e: Ev) {
  const b = obj(e.b);
  if (!b) return;
  switch (e.t) {
    case 'ws.create':
      if (e.a === s.creator && !s.name) s.name = (str(b.name) || 'Workspace').slice(0, 64);
      break;
    case 'profile': {
      const name = str(b.name);
      if (!e.ag && name && optStr(b.handle)) s.profiles.set(e.a, { name: name.slice(0, 64), handle: (str(b.handle) ?? '').slice(0, 32), ts: e.ts });
      break;
    }
    case 'ch.create': {
      const id = str(b.id),
        name = str(b.name);
      if (id && name && optStr(b.topic) && !isPrivateChannel(id) && !s.channels.has(id))
        s.channels.set(id, { id, name: name.slice(0, 60), topic: str(b.topic) ?? '', ts: e.ts, a: e.a });
      break;
    }
    case 'ch.update': {
      const c = s.channels.get(str(b.id) ?? '');
      const name = str(b.name),
        topic = str(b.topic);
      if (c) {
        if (name) c.name = name.slice(0, 60);
        if (topic !== undefined) c.topic = topic;
      }
      break;
    }
    case 'msg': {
      const ch = e.ch;
      if (!ch || s.msgs.has(e.id) || !optStr(b.text) || !optStr(b.parent) || !optStr(b.meta)) return;
      if (isPrivateChannel(ch) ? !privateOk(e, ch) : !s.channels.has(ch)) return;
      const parentId = str(b.parent);
      const parent = parentId !== undefined ? s.msgs.get(parentId) : undefined;
      if (parentId !== undefined && (!parent || parent.ch !== ch)) return;
      const trace = b.trace === undefined ? undefined : list(b.trace, traceStep);
      // Approval prompts come only from agents to their owner, in the owner's private agent channel.
      const approval = ch.startsWith('adm:') ? approvalReq(b.approval) : undefined;
      const m: Msg = {
        id: e.id,
        ch,
        a: e.a,
        ag: e.ag,
        ts: e.ts,
        to: e.to,
        text: str(b.text) ?? '',
        parent: parent?.id,
        files: list(b.files, fileRef),
        trace,
        meta: str(b.meta),
        approval,
        edited: false,
        deleted: false,
        reactions: Object.create(null) as Record<string, string[]>,
        replies: [],
        ...(parent && b.alsoInChannel === true ? { alsoInChannel: true } : {}),
      };
      s.msgs.set(e.id, m);
      if (parent) parent.replies.push(e.id);
      // A top-level message, or a thread reply that was also sent to the channel.
      if (!parent || m.alsoInChannel) s.channelMsgs.set(ch, [...(s.channelMsgs.get(ch) ?? []), e.id]);
      break;
    }
    case 'edit':
    case 'del': {
      const m = s.msgs.get(str(b.target) ?? '');
      if (!m || m.deleted || m.a !== e.a || (m.ag || '') !== (e.ag || '')) return;
      // Advisory only: authors choose their own ts, so a late edit can simply claim an early time.
      // Honest clients enforce the window in the UI; this just keeps them consistent with each other.
      if (e.ts - m.ts > EDIT_WINDOW_MS || e.ts < m.ts) return;
      if (e.t === 'edit') {
        const text = str(b.text);
        if (text === undefined) return;
        m.text = text;
        m.edited = true;
      } else {
        m.deleted = true;
        m.text = '';
        m.files = [];
      }
      break;
    }
    case 'react': {
      const m = s.msgs.get(str(b.target) ?? '');
      const icon = str(b.icon);
      if (!m || m.deleted || !icon || icon.length > 64 || typeof b.on !== 'boolean') return;
      const who = reactorKey(e);
      const set = new Set(Object.hasOwn(m.reactions, icon) ? m.reactions[icon] : []);
      if (b.on) set.add(who);
      else set.delete(who);
      if (set.size) m.reactions[icon] = [...set];
      else delete m.reactions[icon];
      break;
    }
    case 'pin': {
      const m = s.msgs.get(str(b.target) ?? '');
      if (!m || typeof b.on !== 'boolean') return;
      const set = s.pins.get(m.ch) || new Set<string>();
      if (b.on) set.add(m.id);
      else set.delete(m.id);
      s.pins.set(m.ch, set);
      break;
    }
    case 'agent': {
      const { id, name, handle, runtime } = b;
      if (typeof id !== 'string' || !id || typeof handle !== 'string' || !handle || typeof name !== 'string' || typeof runtime !== 'string') return;
      if (!optStr(b.model) || (b.replyIn !== 'thread' && b.replyIn !== 'channel') || !(b.removed === undefined || typeof b.removed === 'boolean')) return;
      // Newer fields are optional (older bridges don't send them); wrong types are ignored, never coerced.
      const flags = <K extends string>(x: unknown, keys: readonly K[]) => {
        const o = obj(x);
        return o && keys.every((k) => typeof o[k] === 'boolean') ? (Object.fromEntries(keys.map((k) => [k, o[k] as boolean])) as Record<K, boolean>) : undefined;
      };
      const respondTo = flags(b.respondTo, ['mentions', 'replies'] as const);
      const postIn = flags(b.postIn, ['thread', 'channel'] as const);
      s.agents.set(agentKey(e.a, id), {
        id,
        name,
        handle,
        runtime,
        model: str(b.model),
        replyIn: b.replyIn,
        removed: b.removed === true || undefined,
        owner: e.a,
        ts: e.ts,
        ...(respondTo ? { respondTo } : {}),
        ...(postIn ? { postIn } : {}),
        ...(b.discoverable === true ? { discoverable: true } : {}),
      });
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

/** An agent's triggers and placement, with older agents (only `replyIn`) filled in the way they behaved. */
export function agentPrefs(a: Pick<AgentBody, 'replyIn' | 'respondTo' | 'postIn' | 'discoverable'>): { respondTo: AgentTriggers; postIn: AgentPlacement; discoverable: boolean } {
  return {
    respondTo: a.respondTo ?? { mentions: true, replies: false },
    postIn: a.postIn && (a.postIn.thread || a.postIn.channel) ? a.postIn : { thread: a.replyIn === 'thread', channel: a.replyIn === 'channel' },
    discoverable: a.discoverable === true,
  };
}

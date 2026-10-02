import type { Ev, EvType, AgentBody, AgentTriggers, AgentPlacement, FileRef, TraceStep, ApprovalReq, PollSpec, MeetSpec, Actor, TaskStatus, DocKind } from './types';
import { EDIT_WINDOW_MS, sortEvents, isEventShape } from './events';
import { parseBody, type NotifyLevel, type ParsedBody } from './schemas';
import { isPrivateChannel, dmChannel, parseGuestDm } from './codes';

export interface Msg {
  id: string;
  ch: string;
  a: string;
  ag?: string | undefined;
  ts: number;
  to?: string | undefined;
  /** A thread reply that is also listed in the channel. */
  alsoInChannel?: boolean | undefined;
  text: string;
  parent?: string | undefined;
  files: FileRef[];
  trace?: TraceStep[] | undefined;
  meta?: string | undefined;
  approval?: ApprovalReq | undefined;
  poll?: PollSpec | undefined;
  meet?: MeetSpec | undefined;
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
export interface Profile {
  name: string;
  handle: string; // '' when the member set none
  ts: number;
}

/** One change to a task, in order: who made it and what it set. */
export interface TaskChange {
  a: string;
  ag?: string | undefined;
  ts: number;
  status?: TaskStatus | undefined;
  assignee?: Actor | null | undefined;
  note?: string | undefined;
}
export interface Task {
  id: string;
  title: string;
  ch: string;
  src?: string | undefined;
  a: string;
  ag?: string | undefined;
  ts: number;
  assignee?: Actor | undefined;
  due?: number | undefined;
  status: TaskStatus;
  /** When it last changed. */
  updated: number;
  log: TaskChange[];
}
export interface Decision {
  target: string;
  ch: string;
  text: string;
  a: string;
  ag?: string | undefined;
  ts: number;
}
export interface Suggestion {
  id: string;
  doc: string;
  find: string;
  replace: string;
  note?: string | undefined;
  a: string;
  ag?: string | undefined;
  ts: number;
  status: 'open' | 'accepted' | 'rejected';
  /** Who accepted or rejected it. */
  by?: string | undefined;
}
export interface Doc {
  id: string;
  title: string;
  ch: string;
  kind: DocKind;
  a: string;
  ag?: string | undefined;
  ts: number;
  updated: number;
  archived: boolean;
  /** Yjs updates (base64url), in log order. Order doesn't matter to Yjs; it keeps replays identical. */
  ops: string[];
  /** Everyone (actor keys) who changed it. */
  editors: string[];
  suggestions: Suggestion[];
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
  tasks: Map<string, Task>;
  votes: Map<string, Map<Actor, number[]>>; // poll message → voter → choices
  rsvps: Map<string, Map<Actor, 'yes' | 'no' | 'maybe'>>; // meeting message → answer
  decisions: Map<string, Decision>; // by the message it settles
  docs: Map<string, Doc>;
  /** Private to each member's devices, so in practice only my own: pub → saved message ids, oldest first. */
  saved: Map<string, string[]>;
  /** Private to each member's devices: pub → channel → read up to (ms). */
  reads: Map<string, Map<string, number>>;
  /** Private to each member's devices: pub → channel → alert level, the newest setting (see notify.ts `levelOf`). */
  levels: Map<string, Map<string, NotifyLevel>>;
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
    tasks: new Map(),
    votes: new Map(),
    rsvps: new Map(),
    decisions: new Map(),
    docs: new Map(),
    saved: new Map(),
    reads: new Map(),
    levels: new Map(),
  };
}

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
export function reduce(ws: string, events: Ev[], opts: { creator?: string | null | undefined } = {}): WsState {
  const s = emptyState(ws);
  const evs = sortEvents(events.filter((e) => isEventShape(e) && e.ws === ws));
  s.creator = opts.creator ?? evs.find((e) => e.t === 'ws.create')?.a ?? null;
  if (s.creator) s.admins.add(s.creator);
  // Roles and bans first, so a ban removes everything its target ever wrote: authors pick their own
  // timestamps, so "events after the ban" would let a banned key backdate its way back in.
  for (const e of evs) if (e.t === 'role' || e.t === 'ban') guarded(() => authority(s, e));
  // Rekeys stay valid if their author is later demoted: members already moved to that key, and
  // voiding it would put everyone back on an older key a banned member still holds.
  const everAdmins = everAdminsOf(s.creator, evs);
  const approves: Ev[] = [];
  const later: { e: Ev; t: Deferred }[] = [];
  for (const e of evs) {
    if (s.bans.has(e.a) || e.t === 'role' || e.t === 'ban') continue;
    // Approvals are checked against the request message, which may sort after the answer when clocks disagree.
    if (e.t === 'approve') approves.push(e);
    // Changes to things that may sort after them (the author's clock was behind) wait until everything exists.
    else if (isDeferred(e.t)) later.push({ e, t: e.t });
    else if (e.t === 'rekey')
      guarded(() => {
        const r = parseRekey(e);
        if (r && everAdmins.has(e.a)) s.rekeys.push(r);
      });
    else {
      const t = e.t; // narrowed: role, ban, approve and rekey are handled above
      guarded(() => applyAs(s, e, t));
    }
  }
  for (const { e, t } of later) guarded(() => applyAs(s, e, t));
  settleApprovals(s, approves);
  return s;
}

/** The creator and everyone the creator ever made admin, even if later demoted. */
function everAdminsOf(creator: string | null, evs: readonly Ev[]): Set<string> {
  const out = new Set(creator ? [creator] : []);
  for (const e of evs) {
    const b = e.t === 'role' && e.a === creator ? parseBody('role', e.b) : null;
    if (b?.admin) out.add(b.target);
  }
  return out;
}

/** Applies approval answers once every message is known: only the human owner of the agent that asked may answer. */
function settleApprovals(s: WsState, approves: readonly Ev[]) {
  const reqOwners = new Map<string, Set<string>>();
  for (const m of s.msgs.values()) if (m.approval) reqOwners.set(m.approval.req, (reqOwners.get(m.approval.req) ?? new Set()).add(m.a));
  for (const e of approves) {
    const b = parseBody('approve', e.b);
    if (b && !e.ag && reqOwners.get(b.req)?.has(e.a)) s.approvals.set(b.req, b.option);
  }
}

/** A rekey event's body, validated; undefined if malformed. Authority is checked separately. */
export function parseRekey(e: Ev): ValidRekey | undefined {
  const b = parseBody('rekey', e.b);
  return b ? { id: e.id, a: e.a, ts: e.ts, epoch: b.epoch, keys: b.keys, history: b.history } : undefined;
}

// Every member reduces the same log, so an event that throws would break the workspace for all of
// them, permanently. The schemas should make this unreachable; this is the backstop.
function guarded(f: () => void) {
  try {
    f();
  } catch {
    /* a hostile event is dropped, like any other invalid one */
  }
}

/** Only the creator promotes or demotes, and bans admins. Admins ban non-admins, never the creator or themselves. */
function authority(s: WsState, e: Ev) {
  if (e.t === 'role') {
    const b = parseBody('role', e.b);
    if (!b || e.a !== s.creator || b.target === s.creator || b.target === e.a) return;
    if (b.admin) s.admins.add(b.target);
    else s.admins.delete(b.target);
    return;
  }
  const b = parseBody('ban', e.b);
  if (!b || b.target === s.creator || b.target === e.a || !s.admins.has(e.a)) return;
  if (s.admins.has(b.target) && e.a !== s.creator) return;
  if (b.on) {
    s.bans.add(b.target);
    s.admins.delete(b.target);
  } else s.bans.delete(b.target);
}

const DEFERRED = ['task.set', 'vote', 'rsvp', 'decide', 'doc.set', 'doc.op', 'suggest', 'suggest.res'] as const satisfies readonly EvType[];
type Deferred = (typeof DEFERRED)[number];
const isDeferred = (t: EvType): t is Deferred => (DEFERRED as readonly EvType[]).includes(t);

// One handler per event type that changes state directly, given its body checked against the type's schema.
type Applied = Exclude<EvType, 'role' | 'ban' | 'approve' | 'rekey'>;
type Handlers = { [T in Applied]: (s: WsState, e: Ev, b: ParsedBody<T>) => void };

const APPLY: Handlers = {
  'ws.create': (s, e, b) => {
    if (e.a === s.creator && !s.name) s.name = (b.name || 'Workspace').slice(0, 64);
  },
  profile: (s, e, b) => {
    if (!e.ag) s.profiles.set(e.a, { name: b.name.slice(0, 64), handle: (b.handle ?? '').slice(0, 32), ts: e.ts });
  },
  'ch.create': (s, e, b) => {
    if (!isPrivateChannel(b.id) && !s.channels.has(b.id)) s.channels.set(b.id, { id: b.id, name: b.name.slice(0, 60), topic: b.topic ?? '', ts: e.ts, a: e.a });
  },
  'ch.update': (s, _e, b) => {
    const c = s.channels.get(b.id);
    if (!c) return;
    if (b.name) c.name = b.name.slice(0, 60);
    if (b.topic !== undefined) c.topic = b.topic;
  },
  msg: onMsg,
  edit: (s, e, b) => {
    const m = editable(s, e, b.target);
    if (!m) return;
    m.text = b.text;
    m.edited = true;
  },
  del: (s, e, b) => {
    const m = editable(s, e, b.target);
    if (!m) return;
    m.deleted = true;
    m.text = '';
    m.files = [];
  },
  react: (s, e, b) => {
    const m = s.msgs.get(b.target);
    if (!m || m.deleted) return;
    const who = reactorKey(e);
    const set = new Set(Object.hasOwn(m.reactions, b.icon) ? m.reactions[b.icon] : []);
    if (b.on) set.add(who);
    else set.delete(who);
    if (set.size) m.reactions[b.icon] = [...set];
    else delete m.reactions[b.icon];
  },
  pin: (s, _e, b) => {
    const m = s.msgs.get(b.target);
    if (!m) return;
    const set = s.pins.get(m.ch) ?? new Set<string>();
    if (b.on) set.add(m.id);
    else set.delete(m.id);
    s.pins.set(m.ch, set);
  },
  agent: (s, e, b) => {
    s.agents.set(agentKey(e.a, b.id), {
      id: b.id,
      name: b.name,
      handle: b.handle,
      runtime: b.runtime,
      model: b.model,
      replyIn: b.replyIn,
      removed: b.removed === true || undefined,
      owner: e.a,
      ts: e.ts,
      ...(b.respondTo ? { respondTo: b.respondTo } : {}),
      ...(b.postIn ? { postIn: b.postIn } : {}),
      ...(b.discoverable ? { discoverable: true } : {}),
    });
  },
  task: (s, e, b) => {
    if (s.tasks.has(b.id) || !s.channels.has(b.ch)) return;
    s.tasks.set(b.id, {
      id: b.id,
      title: b.title,
      ch: b.ch,
      src: b.src,
      a: e.a,
      ag: e.ag,
      ts: e.ts,
      assignee: b.assignee,
      due: b.due,
      status: 'open',
      updated: e.ts,
      log: [{ a: e.a, ag: e.ag, ts: e.ts, status: 'open', ...(b.assignee ? { assignee: b.assignee } : {}) }],
    });
  },
  'task.set': (s, e, b) => {
    const t = s.tasks.get(b.id);
    if (!t) return;
    if (b.title) t.title = b.title;
    if (b.assignee !== undefined) t.assignee = b.assignee ?? undefined;
    if (b.due !== undefined) t.due = b.due ?? undefined;
    if (b.status) t.status = b.status;
    t.updated = e.ts;
    t.log.push({
      a: e.a,
      ag: e.ag,
      ts: e.ts,
      ...(b.status ? { status: b.status } : {}),
      ...(b.assignee !== undefined ? { assignee: b.assignee } : {}),
      ...(b.note ? { note: b.note } : {}),
    });
  },
  vote: (s, e, b) => {
    const m = answerable(s, e, b.target);
    const p = m?.poll;
    if (!m || !p || (p.closes !== undefined && e.ts >= p.closes)) return;
    const picked = [...new Set(b.choices.filter((c) => c < p.options.length))].sort((x, y) => x - y);
    const votes = s.votes.get(m.id) ?? new Map<Actor, number[]>();
    if (picked.length) votes.set(reactorKey(e), p.multi ? picked : picked.slice(0, 1));
    else votes.delete(reactorKey(e));
    s.votes.set(m.id, votes);
  },
  rsvp: (s, e, b) => {
    const m = answerable(s, e, b.target);
    if (!m?.meet) return;
    s.rsvps.set(m.id, (s.rsvps.get(m.id) ?? new Map()).set(reactorKey(e), b.going));
  },
  decide: (s, e, b) => {
    const m = answerable(s, e, b.target);
    if (!m) return;
    if (b.on) s.decisions.set(m.id, { target: m.id, ch: m.ch, text: b.text || m.text, a: e.a, ag: e.ag, ts: e.ts });
    else s.decisions.delete(m.id);
  },
  doc: (s, e, b) => {
    if (s.docs.has(b.id) || !s.channels.has(b.ch)) return;
    s.docs.set(b.id, { id: b.id, title: b.title, ch: b.ch, kind: b.kind, a: e.a, ag: e.ag, ts: e.ts, updated: e.ts, archived: false, ops: [], editors: [], suggestions: [] });
  },
  'doc.set': (s, e, b) => {
    const d = s.docs.get(b.id);
    if (!d) return;
    if (b.title) d.title = b.title;
    if (b.archived !== undefined) d.archived = b.archived;
    d.updated = e.ts;
  },
  'doc.op': (s, e, b) => {
    const d = s.docs.get(b.doc);
    if (!d || d.archived) return;
    d.ops.push(b.u);
    d.updated = e.ts;
    const who = reactorKey(e);
    if (!d.editors.includes(who)) d.editors.push(who);
  },
  suggest: (s, e, b) => {
    const d = s.docs.get(b.doc);
    if (d?.kind !== 'text' || d.archived) return;
    d.suggestions.push({ id: e.id, doc: d.id, find: b.find, replace: b.replace, note: b.note, a: e.a, ag: e.ag, ts: e.ts, status: 'open' });
  },
  'suggest.res': (s, e, b) => {
    // People decide; an agent can't accept its own (or another agent's) suggestion.
    if (e.ag) return;
    for (const d of s.docs.values()) {
      const x = d.suggestions.find((y) => y.id === b.target);
      if (x?.status !== 'open') continue;
      x.status = b.accept ? 'accepted' : 'rejected';
      x.by = e.a;
    }
  },
  save: (s, e, b) => {
    if (e.to !== e.a || e.ch) return;
    const l = (s.saved.get(e.a) ?? []).filter((id) => id !== b.target);
    s.saved.set(e.a, b.on ? [...l, b.target] : l);
  },
  read: (s, e, b) => {
    if (e.to !== e.a) return;
    const r = s.reads.get(e.a) ?? new Map<string, number>();
    r.set(b.ch, Math.max(r.get(b.ch) ?? 0, b.ts));
    s.reads.set(e.a, r);
  },
  // Events apply in (ts, id) order, so the newest setting wins and ties settle the same everywhere.
  notify: (s, e, b) => {
    if (e.to !== e.a) return;
    const l = s.levels.get(e.a) ?? new Map<string, NotifyLevel>();
    l.set(b.ch, b.level);
    s.levels.set(e.a, l);
  },
};

/**
 * The message `target`, when `e` may answer it (vote, RSVP, mark as decided): it exists, isn't deleted, and the
 * answer is as private as the message, so a DM poll's votes never travel to the whole workspace.
 */
function answerable(s: WsState, e: Ev, target: string): Msg | undefined {
  const m = s.msgs.get(target);
  if (!m || m.deleted) return undefined;
  if (!m.to) return e.to ? undefined : m;
  const pair = [m.a, m.to].sort().join(':');
  return e.to !== undefined && [e.a, e.to].sort().join(':') === pair ? m : undefined;
}

function onMsg(s: WsState, e: Ev, b: ParsedBody<'msg'>) {
  const ch = e.ch;
  if (!ch || s.msgs.has(e.id)) return;
  if (isPrivateChannel(ch) ? !privateOk(e, ch) : !s.channels.has(ch)) return;
  const parent = b.parent === undefined ? undefined : s.msgs.get(b.parent);
  if (b.parent !== undefined && parent?.ch !== ch) return;
  const m: Msg = {
    id: e.id,
    ch,
    a: e.a,
    ag: e.ag,
    ts: e.ts,
    to: e.to,
    text: b.text ?? '',
    parent: parent?.id,
    files: b.files,
    trace: b.trace,
    meta: b.meta,
    poll: b.poll,
    meet: b.meet,
    // Approval prompts come only from agents to their owner, in the owner's private agent channel.
    approval: ch.startsWith('adm:') ? b.approval : undefined,
    edited: false,
    deleted: false,
    reactions: Object.create(null) as Record<string, string[]>,
    replies: [],
    ...(parent && b.alsoInChannel ? { alsoInChannel: true } : {}),
  };
  s.msgs.set(e.id, m);
  if (parent) parent.replies.push(e.id);
  // A top-level message, or a thread reply that was also sent to the channel.
  if (!parent || m.alsoInChannel) s.channelMsgs.set(ch, [...(s.channelMsgs.get(ch) ?? []), e.id]);
}

/** The message `target`, when `e` may still edit or delete it: its own author (and agent), inside the edit window. */
function editable(s: WsState, e: Ev, target: string): Msg | undefined {
  const m = s.msgs.get(target);
  if (!m || m.deleted || m.a !== e.a || (m.ag || '') !== (e.ag || '')) return undefined;
  // Advisory only: authors choose their own ts, so a late edit can simply claim an early time.
  // Honest clients enforce the window in the UI; this just keeps them consistent with each other.
  return e.ts - m.ts > EDIT_WINDOW_MS || e.ts < m.ts ? undefined : m;
}

function applyAs<T extends Applied>(s: WsState, e: Ev, t: T) {
  const b = parseBody(t, e.b);
  if (b) APPLY[t](s, e, b);
}

/** People who have introduced themselves and aren't banned. */
export function members(s: WsState): string[] {
  return [...s.profiles.keys()].filter((k) => !s.bans.has(k));
}

export function liveAgents(s: WsState): Agent[] {
  return [...s.agents.values()].filter((a) => !a.removed && !s.bans.has(a.owner));
}

export function mentions(text: string): string[] {
  // Lookbehind instead of a capture group, so every match is the handle itself (no optional groups to unpack).
  return (text.match(/(?<!\w)@[a-z0-9][\w-]{0,31}/gi) ?? []).map((h) => h.slice(1).toLowerCase());
}

/** An agent's triggers and placement, with older agents (only `replyIn`) filled in the way they behaved. */
export function agentPrefs(a: Pick<AgentBody, 'replyIn' | 'respondTo' | 'postIn' | 'discoverable'>): { respondTo: AgentTriggers; postIn: AgentPlacement; discoverable: boolean } {
  return {
    respondTo: a.respondTo ?? { mentions: true, replies: false },
    postIn: a.postIn && (a.postIn.thread || a.postIn.channel) ? a.postIn : { thread: a.replyIn === 'thread', channel: a.replyIn === 'channel' },
    discoverable: a.discoverable === true,
  };
}

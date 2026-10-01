import * as v from 'valibot';
import type { WorkspacePeer, Msg, TraceStep, AgentConfig } from '@yurt/protocol';
import { agentDmChannel, mentions, agentKey, parseBody, parseGuestDm, parseOr } from '@yurt/protocol';
import type { Ev, WsState } from '@yurt/protocol';
import { AcpConnection, isAuthError, type AcpUpdate } from './acp';
import { NewSessionResultSchema, PermissionRequestSchema } from './schemas';
import { RUNTIMES, acpCommand } from './runtimes';
import type { Config } from './config';
import { log } from './log';
import { saveAttachment } from './files';
import { compact } from './compact';
import { errorMessage, listAt } from './util';

type Status = 'idle' | 'working' | 'waiting' | 'error';
/** What started a run: an @mention, a follow-up in its thread, its owner's private chat, or another member's DM. */
type Kind = 'mention' | 'reply' | 'dm' | 'guest';
interface Session {
  conn: AcpConnection;
  id: string;
  key: string;
  // Cleared between prompts, so `undefined` is a real state here, not just "absent".
  onUpdate?: ((u: AcpUpdate) => void) | undefined;
}
interface Run {
  peer: WorkspacePeer;
  trace: TraceStep[];
  /** The owner's key, which approvals are addressed to. */
  me: string;
}

/** How long a message stays worth answering, and how long a run waits for its owner's approval. Tests shorten them. */
export interface HostTiming {
  staleMs: number;
  approvalMs: number;
}
const TIMING: HostTiming = { staleMs: 3 * 60_000, approvalMs: 30 * 60_000 };

const mapStatus = (s?: string): TraceStep['status'] => (s === 'completed' ? 'done' : s === 'failed' ? 'error' : 'running');

const CANCELLED = { outcome: { outcome: 'cancelled' } } as const;
const selected = (optionId: string) => ({ outcome: { outcome: 'selected', optionId } });

/** A run's tool calls by id: the trace step each one shows as, and when it started. */
type Tools = Map<string, { step: TraceStep; start: number }>;

/** Folds one session update into the run's trace; returns the reply text it adds, if any. */
function applyUpdate(u: AcpUpdate, trace: TraceStep[], tools: Tools): string {
  if (u.sessionUpdate === 'agent_message_chunk') return u.content?.type === 'text' ? u.content.text || '' : '';
  if (!u.toolCallId) return '';
  if (u.sessionUpdate === 'tool_call') {
    const step: TraceStep = compact({ title: u.title || u.kind || 'Tool call', tool: u.kind, status: mapStatus(u.status) });
    trace.push(step);
    tools.set(u.toolCallId, { step, start: Date.now() });
    return '';
  }
  const t = u.sessionUpdate === 'tool_call_update' ? tools.get(u.toolCallId) : undefined;
  if (!t) return '';
  if (u.title) t.step.title = u.title;
  if (u.status) {
    t.step.status = mapStatus(u.status);
    if (t.step.status !== 'running') t.step.ms = Date.now() - t.start;
  }
  return '';
}

/** Which messages a prompt shows (the thread, or the conversation), and how it names the place. */
function promptScope(s: WsState, trigger: Msg, kind: Kind, owner: string): { ids: readonly string[]; where: string } {
  // The reducer keeps a reply only when its parent is in the same channel, so a reply always has its root here,
  // and a room message always has its channel.
  const root = trigger.parent ? s.msgs.get(trigger.parent) : undefined;
  const ids = root ? [root.id, ...root.replies] : listAt(s.channelMsgs, trigger.ch);
  const guest = s.profiles.get(trigger.a);
  const room = `#${s.channels.get(trigger.ch)?.name}`;
  const where =
    kind === 'dm'
      ? 'a private chat with your owner'
      : kind === 'guest'
        ? `a private chat with ${guest?.name || 'a member'} (@${guest?.handle || '?'}), a member of the workspace. ${owner} can read this chat too`
        : root
          ? 'a thread in ' + room
          : room;
  return { ids, where };
}

const ASK: Record<Exclude<Kind, 'guest'>, string> = { dm: ' from your owner', reply: ', a follow-up in a thread you take part in', mention: ', which mentions you' };

/** Only the human owner answers approvals; an agent signing with the owner's key (`ag`) must not. */
export const isOwnerApproval = (e: Ev, me: string): boolean => e.t === 'approve' && e.a === me && !e.ag;

/** Ids of this workspace's agents that `text` @mentions, never the agent `from` that wrote it. */
export const mentionedAgents = (agents: readonly AgentConfig[], wsAgents: readonly string[], text: string, from?: string): string[] => {
  const handles = mentions(text);
  return wsAgents.filter((id) => id !== from && agents.some((a) => a.id === id && handles.includes(a.handle.toLowerCase())));
};

/**
 * Agents in this workspace with replies turned on that already take part in the thread `m` belongs to
 * (they started it or answered in it), never the agent `from` that wrote `m`.
 */
export const repliedAgents = (agents: readonly AgentConfig[], wsAgents: readonly string[], s: WsState, m: Msg, me: string, from?: string): string[] => {
  const root = m.parent ? s.msgs.get(m.parent) : undefined;
  if (!root) return [];
  const thread = [root, ...root.replies.map((id) => s.msgs.get(id))].filter((x): x is Msg => !!x && x.id !== m.id);
  return wsAgents.filter((id) => id !== from && agents.some((a) => a.id === id && a.respondTo.replies) && thread.some((x) => x.a === me && x.ag === id));
};

/**
 * Where an answer goes. DMs stay flat. "Thread" answers in the trigger's thread (starting one); "channel" answers
 * at the top, or inside the thread the trigger is already in; both = a thread reply also shown in the channel.
 */
export function placement(a: Pick<AgentConfig, 'postIn'>, trigger: Pick<Msg, 'id' | 'parent'>, kind: Kind): { parent?: string; alsoInChannel?: true } {
  if (kind === 'dm' || kind === 'guest') return {};
  if (!a.postIn.thread) return trigger.parent ? { parent: trigger.parent } : {};
  return { parent: trigger.parent || trigger.id, ...(a.postIn.channel ? { alsoInChannel: true as const } : {}) };
}

/** Runs the owner's agents: one ACP session per agent, prompts queued, replies posted back into the room. */
export class AgentHost {
  status = new Map<string, Status>();
  working = new Map<string, { code: string; ch: string }>();
  private sessions = new Map<string, Session>();
  private queues = new Map<string, Promise<void>>();
  private approvals = new Map<string, (optionId: string) => void>();
  private runs = new Map<string, Run>();
  private agentChains = new Map<string, number[]>();

  constructor(
    private cfg: Config,
    private me: () => string | null,
    private changed: () => void,
    private presence: (code: string) => void,
    private timing: HostTiming = TIMING,
  ) {}

  private agent(id: string) {
    return this.cfg.agents.find((a) => a.id === id);
  }
  private setStatus(id: string, s: Status) {
    this.status.set(id, s);
    this.changed();
  }

  workingIn(id: string, code: string): string | null {
    const w = this.working.get(id);
    return w && w.code === code ? w.ch : null;
  }

  /** Closes every session of an agent: its main one and each member's guest session. */
  drop(id: string) {
    for (const [slot, s] of this.sessions)
      if (slot === id || slot.startsWith(id + '|')) {
        s.conn.close();
        this.sessions.delete(slot);
      }
  }

  onEvents(peer: WorkspacePeer, fresh: Ev[]) {
    const me = this.me();
    const ws = this.cfg.workspaces.find((w) => w.code === peer.code);
    if (!me || !ws) return;
    for (const e of fresh) this.onEvent(peer, ws.agents, e, me);
  }

  private onEvent(peer: WorkspacePeer, wsAgents: string[], e: Ev, me: string) {
    if (isOwnerApproval(e, me)) {
      const b = parseBody('approve', e.b);
      if (b) this.approvals.get(b.req)?.(b.option);
      return;
    }
    if (e.t !== 'msg' || !e.ch || Date.now() - e.ts > this.timing.staleMs) return;
    const m = peer.state.msgs.get(e.id);
    if (!m) return;
    // Private channels: the reducer already checked who may write there (the owner in `adm:`, the member or the
    // owner-as-agent in `gdm:`), so what's left is whose agent it is and whether it was written by a person.
    if (e.ch.startsWith('adm:')) {
      const rest = e.ch.slice(4);
      const owner = rest.slice(0, rest.indexOf(':'));
      const id = rest.slice(rest.indexOf(':') + 1);
      if (owner === me && !e.ag && this.agent(id)) this.enqueue(id, peer, m, 'dm', me);
      return;
    }
    const g = parseGuestDm(e.ch);
    if (g) {
      // Another member messaging one of my agents: only while it's in this workspace and discoverable.
      const a = this.agent(g.agentId);
      if (g.owner === me && !e.ag && a?.discoverable && wsAgents.includes(a.id)) this.enqueue(a.id, peer, m, 'guest', me);
      return;
    }
    if (!e.ch.startsWith('dm:')) this.onRoomMessage(peer, wsAgents, e.ch, m, me, e.ag);
  }

  /** A channel message: @mentions and follow-ups in agents' threads. */
  private onRoomMessage(peer: WorkspacePeer, wsAgents: string[], ch: string, m: Msg, me: string, from?: string) {
    const mentioned = mentionedAgents(this.cfg.agents, wsAgents, m.text, from).filter((id) => this.agent(id)?.respondTo.mentions);
    const replied = repliedAgents(this.cfg.agents, wsAgents, peer.state, m, me, from).filter((id) => !mentioned.includes(id));
    // Only agent messages that actually hand off to another agent count toward the chain limit.
    if ((!mentioned.length && !replied.length) || (from && !this.allowAgentChain(ch))) return;
    for (const id of mentioned) this.enqueue(id, peer, m, 'mention', me);
    for (const id of replied) this.enqueue(id, peer, m, 'reply', me);
  }

  /** Agents may @mention each other in public, but a chain stops after 4 agent-triggered runs per channel per 5 minutes. */
  private allowAgentChain(ch: string): boolean {
    const now = Date.now();
    const l = (this.agentChains.get(ch) || []).filter((t) => now - t < 5 * 60_000);
    if (l.length >= 4) return false;
    l.push(now);
    this.agentChains.set(ch, l);
    return true;
  }

  private enqueue(id: string, peer: WorkspacePeer, m: Msg, kind: Kind, me: string) {
    if (!this.agent(id)?.online) return;
    const q = (this.queues.get(id) ?? Promise.resolve()).then(() => this.exec(id, peer, m, kind, me)).catch((e: unknown) => log('error', id, errorMessage(e)));
    this.queues.set(id, q);
  }

  // `slot` is the agent id, or `id|guest:<member>`: another member's DMs get their own session, so nothing the
  // agent remembers from its owner's chats (or other members') can surface in that conversation.
  private async session(a: AgentConfig, slot: string = a.id): Promise<Session> {
    const key = [a.runtime, a.workdir, a.model || ''].join('|');
    const cur = this.sessions.get(slot);
    if (cur && !cur.conn.closed && cur.key === key) return cur;
    cur?.conn.close();
    const conn = new AcpConnection(a.name, ...acpCommand(a.runtime), a.workdir);
    const s: Session = { conn, id: '', key };
    conn.onUpdate = (_sid, u) => s.onUpdate?.(u);
    // By id, not `a`: saving the agent replaces its config object, and auto-approve changes must apply mid-session.
    conn.onPermission = (p) => this.permission(a.id, p);
    conn.onExit = () => {
      if (this.sessions.get(slot) === s) this.sessions.delete(slot);
    };
    try {
      await conn.initialize();
      const res = parseOr(NewSessionResultSchema, await conn.request('session/new', { cwd: a.workdir, mcpServers: [] }, 120_000));
      if (!res) throw new Error('the agent opened no session');
      s.id = res.sessionId;
    } catch (e) {
      conn.close(); // never stored, so nothing else would stop this process
      throw e;
    }
    if (a.model)
      await conn.request('session/set_model', { sessionId: s.id, modelId: a.model }, 20_000).catch((e: unknown) => log('warn', a.name, 'model not set: ' + errorMessage(e)));
    this.sessions.set(slot, s);
    log('info', a.name, `session ${s.id} on ${RUNTIMES[a.runtime].name} in ${a.workdir}`);
    return s;
  }

  /** Saves the triggering message's attachments into the agent's folder; file id → path relative to it. */
  private async deliverFiles(a: AgentConfig, peer: WorkspacePeer, trigger: Msg): Promise<Map<string, string>> {
    const saved = new Map<string, string>();
    for (const [i, f] of trigger.files.entries()) {
      try {
        const buf = await peer.fetchFile(f.id);
        if (!buf) throw new Error('no member or file server has it');
        saved.set(f.id, saveAttachment(a.workdir, trigger.id, trigger.files.length > 1 ? `${i + 1}-${f.name}` : f.name, buf));
        log('info', a.name, `saved attachment ${f.name} to ${saved.get(f.id)}`);
      } catch (e) {
        log('warn', a.name, `couldn't save attachment ${f.name}: ${errorMessage(e)}`);
      }
    }
    return saved;
  }

  private prompt(a: AgentConfig, peer: WorkspacePeer, trigger: Msg, kind: Kind, me: string, saved: ReadonlyMap<string, string>): string {
    const s = peer.state;
    const nameOf = (m: Msg) =>
      m.ag ? (s.agents.get(agentKey(m.a, m.ag))?.name || m.ag) + ' (agent)' : (s.profiles.get(m.a)?.name || 'Someone') + ' (@' + (s.profiles.get(m.a)?.handle || '?') + ')';
    const owner = s.profiles.get(me)?.name || 'your owner';
    const { ids, where } = promptScope(s, trigger, kind, owner);
    // Up to the trigger: messages that arrived after it aren't what it asks about.
    const recent = ids.slice(0, ids.indexOf(trigger.id) + 1).slice(-Math.max(1, a.contextSize));
    // Only the triggering message's files are fetched; earlier ones are listed by name.
    const fileLine = (m: Msg, f: Msg['files'][number]) => (m.id !== trigger.id ? f.name : saved.has(f.id) ? `${f.name} → ${saved.get(f.id)}` : `${f.name} (couldn't download)`);
    const lines = recent
      .map((id) => s.msgs.get(id))
      .filter((m): m is Msg => m?.deleted === false)
      .map(
        (m) =>
          `[${new Date(m.ts).toISOString().slice(11, 16)}] ${nameOf(m)}: ${m.text}${m.files.length ? ' [attached: ' + m.files.map((f) => fileLine(m, f)).join(', ') + ']' : ''}`,
      );
    const ask = kind === 'guest' ? ' from ' + (s.profiles.get(trigger.a)?.name || 'them') : ASK[kind];
    return [
      `You are ${a.name} (@${a.handle}), an AI agent in the Yurt workspace "${s.name}", speaking in ${where}. ${owner} owns you and runs you on their machine.`,
      a.instructions ? `\nYour instructions from ${owner}:\n${a.instructions}` : '',
      `\nRecent messages, oldest first:\n${lines.join('\n')}`,
      `\nReply to the last message${ask}. Your reply is posted to the room exactly as you write it, so write the message itself: concise, plain text or light Markdown, no preamble.`,
    ].join('\n');
  }

  private async exec(id: string, peer: WorkspacePeer, trigger: Msg, kind: Kind, me: string) {
    const a = this.agent(id);
    if (!a) return; // removed while queued
    const t0 = Date.now();
    const trace: TraceStep[] = [];
    const tools: Tools = new Map();
    let text = '';
    this.working.set(id, { code: peer.code, ch: trigger.ch });
    this.presence(peer.code);
    this.setStatus(id, 'working');
    this.runs.set(id, { peer, trace, me });
    try {
      const s = await this.session(a, kind === 'guest' ? a.id + '|guest:' + trigger.a : a.id);
      s.onUpdate = (u) => {
        text += applyUpdate(u, trace, tools);
      };
      const saved = await this.deliverFiles(a, peer, trigger);
      await s.conn.request('session/prompt', { sessionId: s.id, prompt: [{ type: 'text', text: this.prompt(a, peer, trigger, kind, me, saved) }] });
      s.onUpdate = undefined;
      if (!text.trim()) text = 'Done.';
      this.setStatus(id, 'idle');
    } catch (e) {
      const auth = isAuthError(e);
      text = auth ? `I can't run yet: ${RUNTIMES[a.runtime].name} isn't signed in on my owner's machine.` : `I hit an error and stopped: ${errorMessage(e)}`;
      trace.push({ title: auth ? 'Sign-in needed' : 'Run failed', status: 'error', detail: errorMessage(e) });
      this.setStatus(id, 'error');
      this.drop(id); // auth errors too: a fresh process picks up a sign-in done since
    } finally {
      for (const st of trace) if (st.status === 'running') st.status = 'done';
      this.working.delete(id);
      this.runs.delete(id);
      this.presence(peer.code);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1) + 's';
    const nTools = tools.size;
    peer.publish({
      t: 'msg',
      ch: trigger.ch,
      ag: a.id,
      ...(kind === 'dm' ? { to: me } : kind === 'guest' ? { to: trigger.a } : {}),
      b: {
        text: text.trim(),
        ...placement(a, trigger, kind),
        ...(trace.length ? { trace } : {}),
        meta: (nTools ? nTools + (nTools === 1 ? ' tool · ' : ' tools · ') : '') + secs,
      },
    });
  }

  private async permission(id: string, p: unknown) {
    const a = this.agent(id);
    if (!a) return CANCELLED; // removed while running
    const { kind, title, options } = v.parse(PermissionRequestSchema, p);
    const allow = options.find((o) => o.kind === 'allow_once') || options.find((o) => o.kind.startsWith('allow'));
    const reject = options.find((o) => o.kind === 'reject_once') || options.find((o) => o.kind.startsWith('reject'));
    if (allow && (a.autoApprove as readonly string[]).includes(kind)) {
      log('info', a.name, `auto-approved ${kind}: ${title}`);
      return selected(allow.optionId);
    }
    const run = this.runs.get(a.id);
    if (!run) return CANCELLED; // no run to report to (e.g. the CLI asked between prompts)
    const { me } = run;
    const req = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const step: TraceStep = { title: 'Waiting for approval: ' + title, tool: kind, status: 'waiting' };
    run.trace.push(step);
    run.peer.publish({
      t: 'msg',
      ch: agentDmChannel(me, a.id),
      to: me,
      ag: a.id,
      b: { text: `I need your OK to ${title}.`, approval: { req, title, kind, options: options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })) } },
    });
    this.setStatus(a.id, 'waiting');
    log('info', a.name, 'waiting for approval: ' + title);
    const optionId = await new Promise<string>((res) => {
      this.approvals.set(req, res);
      setTimeout(() => res(reject?.optionId || ''), this.timing.approvalMs);
    });
    this.approvals.delete(req);
    this.setStatus(a.id, 'working');
    const chosen = options.find((o) => o.optionId === optionId);
    const allowed = !!chosen?.kind.startsWith('allow');
    step.status = allowed ? 'done' : 'skipped';
    step.title = (allowed ? 'Approved: ' : 'Declined: ') + title;
    return chosen ? selected(optionId) : CANCELLED;
  }
}

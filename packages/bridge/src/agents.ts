import type { WorkspacePeer, Msg, TraceStep, AgentConfig } from '@yurt/protocol';
import { agentDmChannel, mentions, agentKey, parseGuestDm } from '@yurt/protocol';
import type { Ev, WsState } from '@yurt/protocol';
import { AcpConnection, isAuthError, isRecord, type AcpUpdate } from './acp';
import { RUNTIMES, acpCommand } from './runtimes';
import type { Config } from './config';
import { log } from './log';
import { saveAttachment } from './files';

type Status = 'idle' | 'working' | 'waiting' | 'error';
/** What started a run: an @mention, a follow-up in its thread, its owner's private chat, or another member's DM. */
type Kind = 'mention' | 'reply' | 'dm' | 'guest';
interface Session {
  conn: AcpConnection;
  id: string;
  key: string;
  onUpdate?: (u: AcpUpdate) => void;
}
interface Run {
  peer: WorkspacePeer;
  ch: string;
  trace: TraceStep[];
}

const STALE_MS = 3 * 60_000;
const APPROVAL_TIMEOUT_MS = 30 * 60_000;

const mapStatus = (s?: string): TraceStep['status'] => (s === 'completed' ? 'done' : s === 'failed' ? 'error' : 'running');
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

/** The parts of an ACP `session/request_permission` the bridge uses, from untrusted agent output. */
function parsePermission(p: unknown): { kind: string; title: string; options: PermissionOption[] } {
  const call = isRecord(p) && isRecord(p.toolCall) ? p.toolCall : {};
  const options = isRecord(p) && Array.isArray(p.options) ? p.options : [];
  return {
    kind: typeof call.kind === 'string' && call.kind ? call.kind : 'other',
    title: typeof call.title === 'string' && call.title ? call.title : 'use a tool',
    options: options.flatMap((o): PermissionOption[] =>
      isRecord(o) && typeof o.optionId === 'string'
        ? [{ optionId: o.optionId, name: typeof o.name === 'string' ? o.name : o.optionId, kind: typeof o.kind === 'string' ? o.kind : '' }]
        : [],
    ),
  };
}

const CANCELLED = { outcome: { outcome: 'cancelled' } } as const;
const selected = (optionId: string) => ({ outcome: { outcome: 'selected', optionId } });

/** Folds one session update into the run's trace; returns the reply text it adds, if any. */
function applyUpdate(u: AcpUpdate, trace: TraceStep[], tools: Map<string, { i: number; start: number }>): string {
  if (u.sessionUpdate === 'agent_message_chunk') return u.content?.type === 'text' ? u.content.text || '' : '';
  if (!u.toolCallId) return '';
  if (u.sessionUpdate === 'tool_call') {
    tools.set(u.toolCallId, { i: trace.push({ title: u.title || u.kind || 'Tool call', tool: u.kind, status: mapStatus(u.status) }) - 1, start: Date.now() });
    return '';
  }
  const t = u.sessionUpdate === 'tool_call_update' ? tools.get(u.toolCallId) : undefined;
  const st = t && trace[t.i];
  if (!t || !st) return '';
  if (u.title) st.title = u.title;
  if (u.status) {
    st.status = mapStatus(u.status);
    if (st.status !== 'running') st.ms = Date.now() - t.start;
  }
  return '';
}

/** Which messages a prompt shows, and how it names the place. */
function promptScope(s: WsState, trigger: Msg, kind: Kind, owner: string): { ids: string[]; where: string } {
  const chName = s.channels.get(trigger.ch)?.name || trigger.ch;
  const guest = s.profiles.get(trigger.a);
  if (kind === 'dm') return { ids: s.channelMsgs.get(trigger.ch) || [], where: 'a private chat with your owner' };
  if (kind === 'guest')
    return {
      ids: s.channelMsgs.get(trigger.ch) || [],
      where: `a private chat with ${guest?.name || 'a member'} (@${guest?.handle || '?'}), a member of the workspace. ${owner} can read this chat too`,
    };
  if (trigger.parent) {
    const p = s.msgs.get(trigger.parent);
    return { ids: p ? [p.id, ...p.replies] : [trigger.id], where: 'a thread in #' + chName };
  }
  return { ids: s.channelMsgs.get(trigger.ch) || [], where: '#' + chName };
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
  if (!a.postIn.thread) return { parent: trigger.parent };
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
      const b = isRecord(e.b) ? e.b : {};
      if (typeof b.req === 'string' && typeof b.option === 'string') this.approvals.get(b.req)?.(b.option);
      return;
    }
    if (e.t !== 'msg' || !e.ch || Date.now() - e.ts > STALE_MS) return;
    const m = peer.state.msgs.get(e.id);
    if (!m) return;
    if (e.ch.startsWith('adm:')) {
      const [, owner, id] = e.ch.split(':');
      if (owner === me && e.a === me && !e.ag && id && this.agent(id)) this.enqueue(id, peer, m, 'dm');
      return;
    }
    const g = parseGuestDm(e.ch);
    if (g) {
      // Another member messaging one of my agents: only while it's in this workspace and discoverable.
      const a = this.agent(g.agentId);
      if (g.owner === me && e.a === g.member && !e.ag && a?.discoverable && wsAgents.includes(a.id)) this.enqueue(a.id, peer, m, 'guest');
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
    for (const id of mentioned) this.enqueue(id, peer, m, 'mention');
    for (const id of replied) this.enqueue(id, peer, m, 'reply');
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

  private enqueue(id: string, peer: WorkspacePeer, m: Msg, kind: Kind) {
    const q = (this.queues.get(id) || Promise.resolve()).then(() => this.exec(id, peer, m, kind)).catch((e) => log('error', id, String(e?.message || e)));
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
      const res = await conn.request<{ sessionId: string }>('session/new', { cwd: a.workdir, mcpServers: [] }, 120_000);
      s.id = res.sessionId;
    } catch (e) {
      conn.close(); // never stored, so nothing else would stop this process
      throw e;
    }
    if (a.model) await conn.request('session/set_model', { sessionId: s.id, modelId: a.model }, 20_000).catch((e) => log('warn', a.name, 'model not set: ' + e.message));
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

  private prompt(a: AgentConfig, peer: WorkspacePeer, trigger: Msg, kind: Kind, me: string, saved: ReadonlyMap<string, string> = new Map()): string {
    const s = peer.state;
    const nameOf = (m: Msg) =>
      m.ag ? (s.agents.get(agentKey(m.a, m.ag))?.name || m.ag) + ' (agent)' : (s.profiles.get(m.a)?.name || 'Someone') + ' (@' + (s.profiles.get(m.a)?.handle || '?') + ')';
    const owner = s.profiles.get(me)?.name || 'your owner';
    const { ids, where } = promptScope(s, trigger, kind, owner);
    const cut = ids.indexOf(trigger.id);
    const recent = (cut >= 0 ? ids.slice(0, cut + 1) : ids).slice(-Math.max(1, a.contextSize));
    // Only the triggering message's files are fetched; earlier ones are listed by name.
    const fileLine = (m: Msg, f: Msg['files'][number]) => (m.id !== trigger.id ? f.name : saved.has(f.id) ? `${f.name} → ${saved.get(f.id)}` : `${f.name} (couldn't download)`);
    const lines = recent
      .map((id) => s.msgs.get(id))
      .filter((m): m is Msg => !!m && !m.deleted)
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

  private async exec(id: string, peer: WorkspacePeer, trigger: Msg, kind: Kind) {
    const a = this.agent(id);
    const me = this.me();
    if (!a || !me) return;
    const t0 = Date.now();
    const trace: TraceStep[] = [];
    const tools = new Map<string, { i: number; start: number }>();
    let text = '';
    this.working.set(id, { code: peer.code, ch: trigger.ch });
    this.presence(peer.code);
    this.setStatus(id, 'working');
    this.runs.set(id, { peer, ch: trigger.ch, trace });
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
      to: kind === 'dm' ? me : kind === 'guest' ? trigger.a : undefined,
      b: {
        text: text.trim(),
        ...placement(a, trigger, kind),
        trace: trace.length ? trace : undefined,
        meta: (nTools ? nTools + (nTools === 1 ? ' tool · ' : ' tools · ') : '') + secs,
      },
    });
  }

  private async permission(id: string, p: unknown) {
    const a = this.agent(id);
    if (!a) return CANCELLED; // removed while running
    const { kind, title, options } = parsePermission(p);
    const allow = options.find((o) => o.kind === 'allow_once') || options.find((o) => o.kind.startsWith('allow'));
    const reject = options.find((o) => o.kind === 'reject_once') || options.find((o) => o.kind.startsWith('reject'));
    if (allow && (a.autoApprove as readonly string[]).includes(kind)) {
      log('info', a.name, `auto-approved ${kind}: ${title}`);
      return selected(allow.optionId);
    }
    const run = this.runs.get(a.id);
    const me = this.me();
    if (!run || !me) return CANCELLED;
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
      setTimeout(() => res(reject?.optionId || ''), APPROVAL_TIMEOUT_MS);
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

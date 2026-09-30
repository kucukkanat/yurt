import type { WorkspacePeer, Msg, TraceStep, AgentConfig } from '@yurt/protocol';
import { agentDmChannel, mentions, agentKey } from '@yurt/protocol';
import type { Ev } from '@yurt/protocol';
import { AcpConnection, isAuthError, type AcpUpdate } from './acp';
import { RUNTIMES } from './runtimes';
import type { Config } from './config';
import { log } from './log';

type Status = 'idle' | 'working' | 'waiting' | 'error';
interface Session { conn: AcpConnection; id: string; key: string; onUpdate?: (u: AcpUpdate) => void }
interface Run { peer: WorkspacePeer; ch: string; trace: TraceStep[] }

const STALE_MS = 3 * 60_000;
const APPROVAL_TIMEOUT_MS = 30 * 60_000;

const mapStatus = (s?: string): TraceStep['status'] => (s === 'completed' ? 'done' : s === 'failed' ? 'error' : 'running');

/** Runs the owner's agents: one ACP session per agent, prompts queued, replies posted back into the room. */
export class AgentHost {
  status = new Map<string, Status>();
  working = new Map<string, { code: string; ch: string }>();
  private sessions = new Map<string, Session>();
  private queues = new Map<string, Promise<void>>();
  private approvals = new Map<string, (optionId: string) => void>();
  private runs = new Map<string, Run>();
  private agentChains = new Map<string, number[]>();

  constructor(private cfg: Config, private me: () => string | null, private changed: () => void, private presence: (code: string) => void) {}

  private agent(id: string) { return this.cfg.agents.find((a) => a.id === id); }
  private setStatus(id: string, s: Status) { this.status.set(id, s); this.changed(); }

  workingIn(id: string, code: string): string | null {
    const w = this.working.get(id);
    return w && w.code === code ? w.ch : null;
  }

  drop(id: string) { this.sessions.get(id)?.conn.close(); this.sessions.delete(id); }

  onEvents(peer: WorkspacePeer, fresh: Ev[]) {
    const me = this.me();
    if (!me) return;
    const ws = this.cfg.workspaces.find((w) => w.code === peer.code);
    if (!ws) return;
    for (const e of fresh) {
      if (e.t === 'approve' && e.a === me) { this.approvals.get(e.b?.req)?.(e.b?.option); continue; }
      if (e.t !== 'msg' || !e.ch || Date.now() - e.ts > STALE_MS) continue;
      const m = peer.state.msgs.get(e.id);
      if (!m) continue;
      if (e.ch.startsWith('adm:')) {
        const [, owner, id] = e.ch.split(':');
        if (owner === me && e.a === me && !e.ag && this.agent(id)) this.enqueue(id, peer, m, 'dm');
        continue;
      }
      if (e.ch.startsWith('dm:')) continue;
      if (e.ag && !this.allowAgentChain(e.ch)) continue;
      const handles = mentions(m.text);
      for (const id of ws.agents) {
        const a = this.agent(id);
        if (a && e.ag !== id && handles.includes(a.handle.toLowerCase())) this.enqueue(id, peer, m, 'mention');
      }
    }
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

  private enqueue(id: string, peer: WorkspacePeer, m: Msg, kind: 'dm' | 'mention') {
    const q = (this.queues.get(id) || Promise.resolve()).then(() => this.exec(id, peer, m, kind)).catch((e) => log('error', id, String(e?.message || e)));
    this.queues.set(id, q);
  }

  private async session(a: AgentConfig): Promise<Session> {
    const key = [a.runtime, a.workdir, a.model || ''].join('|');
    const cur = this.sessions.get(a.id);
    if (cur && !cur.conn.closed && cur.key === key) return cur;
    cur?.conn.close();
    const def = RUNTIMES[a.runtime];
    const conn = new AcpConnection(a.name, def.acp[0], def.acp.slice(1), a.workdir);
    const s: Session = { conn, id: '', key };
    conn.onUpdate = (_sid, u) => s.onUpdate?.(u);
    conn.onPermission = (p) => this.permission(a, p);
    conn.onExit = () => { if (this.sessions.get(a.id) === s) this.sessions.delete(a.id); };
    await conn.initialize();
    const res = await conn.request<{ sessionId: string }>('session/new', { cwd: a.workdir, mcpServers: [] }, 120_000);
    s.id = res.sessionId;
    if (a.model) await conn.request('session/set_model', { sessionId: s.id, modelId: a.model }, 20_000).catch((e) => log('warn', a.name, 'model not set: ' + e.message));
    this.sessions.set(a.id, s);
    log('info', a.name, `session ${s.id} on ${def.name} in ${a.workdir}`);
    return s;
  }

  private prompt(a: AgentConfig, peer: WorkspacePeer, trigger: Msg, kind: 'dm' | 'mention'): string {
    const s = peer.state;
    const me = this.me()!;
    const nameOf = (m: Msg) => (m.ag ? (s.agents.get(agentKey(m.a, m.ag))?.name || m.ag) + ' (agent)' : (s.profiles.get(m.a)?.name || 'Someone') + ' (@' + (s.profiles.get(m.a)?.handle || '?') + ')');
    let ids: string[];
    let where: string;
    const chName = s.channels.get(trigger.ch)?.name || trigger.ch;
    if (kind === 'dm') { ids = s.channelMsgs.get(trigger.ch) || []; where = 'a private chat with your owner'; }
    else if (trigger.parent) { const p = s.msgs.get(trigger.parent); ids = p ? [p.id, ...p.replies] : [trigger.id]; where = 'a thread in #' + chName; }
    else { ids = s.channelMsgs.get(trigger.ch) || []; where = '#' + chName; }
    const cut = ids.indexOf(trigger.id);
    const recent = (cut >= 0 ? ids.slice(0, cut + 1) : ids).slice(-Math.max(1, a.contextSize));
    const lines = recent.map((id) => s.msgs.get(id)).filter((m): m is Msg => !!m && !m.deleted)
      .map((m) => `[${new Date(m.ts).toISOString().slice(11, 16)}] ${nameOf(m)}: ${m.text}${m.files.length ? ' [attached: ' + m.files.map((f) => f.name).join(', ') + ']' : ''}`);
    const owner = s.profiles.get(me)?.name || 'your owner';
    return [
      `You are ${a.name} (@${a.handle}), an AI agent in the Yurt workspace "${s.name}", speaking in ${where}. ${owner} owns you and runs you on their machine.`,
      a.instructions ? `\nYour instructions from ${owner}:\n${a.instructions}` : '',
      `\nRecent messages, oldest first:\n${lines.join('\n')}`,
      `\nReply to the last message${kind === 'dm' ? ' from your owner' : ', which mentions you'}. Your reply is posted to the room exactly as you write it, so write the message itself: concise, plain text or light Markdown, no preamble.`,
    ].join('\n');
  }

  private async exec(id: string, peer: WorkspacePeer, trigger: Msg, kind: 'dm' | 'mention') {
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
      const s = await this.session(a);
      s.onUpdate = (u) => {
        if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') text += u.content.text || '';
        else if (u.sessionUpdate === 'tool_call' && u.toolCallId) {
          tools.set(u.toolCallId, { i: trace.push({ title: u.title || u.kind || 'Tool call', tool: u.kind, status: mapStatus(u.status) }) - 1, start: Date.now() });
        } else if (u.sessionUpdate === 'tool_call_update' && u.toolCallId) {
          const t = tools.get(u.toolCallId);
          if (!t) return;
          const st = trace[t.i];
          if (u.title) st.title = u.title;
          if (u.status) { st.status = mapStatus(u.status); if (st.status !== 'running') st.ms = Date.now() - t.start; }
        }
      };
      await s.conn.request('session/prompt', { sessionId: s.id, prompt: [{ type: 'text', text: this.prompt(a, peer, trigger, kind) }] });
      s.onUpdate = undefined;
      if (!text.trim()) text = 'Done.';
      this.setStatus(id, 'idle');
    } catch (e) {
      const auth = isAuthError(e);
      text = auth ? `I can't run yet: ${RUNTIMES[a.runtime].name} isn't signed in on my owner's machine.` : `I hit an error and stopped: ${(e as Error).message}`;
      trace.push({ title: auth ? 'Sign-in needed' : 'Run failed', status: 'error', detail: (e as Error).message });
      this.setStatus(id, 'error');
      if (!auth) this.drop(id);
    } finally {
      for (const st of trace) if (st.status === 'running') st.status = 'done';
      this.working.delete(id);
      this.runs.delete(id);
      this.presence(peer.code);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1) + 's';
    const nTools = tools.size;
    const parent = kind === 'dm' ? undefined : a.replyIn === 'thread' ? trigger.parent || trigger.id : trigger.parent;
    peer.publish({
      t: 'msg', ch: trigger.ch, ag: a.id, to: kind === 'dm' ? me : undefined,
      b: { text: text.trim(), parent, trace: trace.length ? trace : undefined, meta: (nTools ? nTools + (nTools === 1 ? ' tool · ' : ' tools · ') : '') + secs },
    });
  }

  private async permission(a: AgentConfig, p: any) {
    const kind: string = p?.toolCall?.kind || 'other';
    const title: string = p?.toolCall?.title || 'use a tool';
    const options: { optionId: string; name: string; kind: string }[] = p?.options || [];
    const allow = options.find((o) => o.kind === 'allow_once') || options.find((o) => o.kind?.startsWith('allow'));
    const reject = options.find((o) => o.kind === 'reject_once') || options.find((o) => o.kind?.startsWith('reject'));
    if (allow && a.autoApprove.includes(kind as any)) {
      log('info', a.name, `auto-approved ${kind}: ${title}`);
      return { outcome: { outcome: 'selected', optionId: allow.optionId } };
    }
    const run = this.runs.get(a.id);
    const me = this.me();
    if (!run || !me) return { outcome: { outcome: 'cancelled' } };
    const req = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const step = run.trace.push({ title: 'Waiting for approval: ' + title, tool: kind, status: 'waiting' }) - 1;
    run.peer.publish({
      t: 'msg', ch: agentDmChannel(me, a.id), to: me, ag: a.id,
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
    run.trace[step].status = chosen?.kind.startsWith('allow') ? 'done' : 'skipped';
    run.trace[step].title = (chosen?.kind.startsWith('allow') ? 'Approved: ' : 'Declined: ') + title;
    return chosen ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } };
  }
}

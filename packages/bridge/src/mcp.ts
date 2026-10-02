import fs from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import {
  agentKey,
  applySuggestion,
  boardNotes,
  docText,
  isPrivateChannel,
  liveAgents,
  newId,
  notePutOp,
  NOTE_COLORS,
  openTasksFor,
  parseOr,
  pollTally,
  TASK_STATUSES,
  textOp,
  type Actor,
  type AgentConfig,
  type Msg,
  type Task,
  type WorkspacePeer,
  type WsState,
} from '@yurt/protocol';
import { errorMessage } from './util';

/*
 * The Yurt tools agents get over MCP: tasks, polls, decisions, docs, boards, meetings and the owner's saved
 * messages. Everything an agent does here is an ordinary signed event (the owner's key, `ag` = the agent), so
 * peers without a bridge just see another participant. The agent CLI talks to a tiny stdio proxy (MCP_PROXY),
 * which forwards each JSON-RPC line to the bridge's /mcp endpoint with the session's token.
 */

/** What a tool call acts on: the run that's going on, its workspace, and who the agent is. */
export interface ToolCtx {
  peer: WorkspacePeer;
  agent: AgentConfig;
  /** The owner's key. */
  me: string;
  /** Tell members what the agent is working on (`doc:<id>`, `task:<id>`). */
  touch(on: string): void;
}

/** The stdio side of the MCP server, written next to the config: plain Node, no dependencies. */
const MCP_PROXY = `// Written by yurt-bridge: forwards MCP (JSON-RPC over stdio) to the bridge. Safe to delete; it is rewritten.
import readline from 'node:readline';
const url = process.env.YURT_MCP_URL;
const token = process.env.YURT_MCP_TOKEN;
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let id = null;
  try {
    id = JSON.parse(line).id ?? null;
  } catch {
    return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: line });
    const text = await r.text();
    if (text) out(JSON.parse(text));
  } catch (e) {
    if (id !== null) out({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Yurt bridge unreachable: ' + e.message } });
  }
});
`;

/** Writes the proxy into `home` (owner-only) and returns its path. */
export function writeProxy(home: string): string {
  const file = path.join(home, 'mcp-proxy.mjs');
  fs.writeFileSync(file, MCP_PROXY, { mode: 0o700 });
  return file;
}

/* ---------- JSON-RPC ---------- */

const RequestSchema = v.object({
  jsonrpc: v.optional(v.string()),
  id: v.optional(v.nullable(v.union([v.number(), v.string()]))),
  method: v.string(),
  params: v.optional(v.unknown()),
});
const CallSchema = v.object({ name: v.string(), arguments: v.optional(v.record(v.string(), v.unknown()), {}) });

type Json = Record<string, unknown>;
const rpcError = (id: unknown, code: number, message: string): Json => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const text = (t: string, isError = false): Json => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

/** A tool's failure the agent should read (bad arguments, unknown ids); anything else is reported the same way. */
class ToolError extends Error {}
const fail = (msg: string): never => {
  throw new ToolError(msg);
};

/**
 * Answers one MCP JSON-RPC message. `ctx` is null outside a run: the agent can list tools, but calls explain
 * that they only work while it's answering in Yurt. Returns null for notifications, which get no answer.
 */
export async function handleMcp(raw: unknown, ctx: ToolCtx | null): Promise<Json | null> {
  const m = parseOr(RequestSchema, raw);
  if (!m) return rpcError(null, -32600, 'Invalid request');
  if (m.id === undefined || m.id === null) return null;
  switch (m.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'yurt', version: '1' } } };
    case 'ping':
      return { jsonrpc: '2.0', id: m.id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id: m.id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
    case 'tools/call': {
      const call = parseOr(CallSchema, m.params);
      const tool = TOOLS.find((t) => t.name === call?.name);
      if (!call || !tool) return rpcError(m.id, -32602, 'Unknown tool');
      if (!ctx) return { jsonrpc: '2.0', id: m.id, result: text('Yurt tools only work while you are answering in a Yurt workspace.', true) };
      try {
        return { jsonrpc: '2.0', id: m.id, result: text(await tool.run(ctx, call.arguments)) };
      } catch (e) {
        return { jsonrpc: '2.0', id: m.id, result: text(errorMessage(e), true) };
      }
    }
    default:
      return rpcError(m.id, -32601, 'Method not found: ' + m.method);
  }
}

/* ---------- reading the workspace ---------- */

const when = (ms: number) => new Date(ms).toISOString().replace(/:\d\d\.\d+Z$/, 'Z');

function nameOf(s: WsState, actor: Actor): string {
  const i = actor.indexOf('/');
  if (i < 0) return '@' + (s.profiles.get(actor)?.handle || actor.slice(0, 8));
  return '@' + (s.agents.get(agentKey(actor.slice(0, i), actor.slice(i + 1)))?.handle || actor.slice(i + 1)) + ' (agent)';
}
const authorOf = (s: WsState, x: { a: string; ag?: string | undefined }) => nameOf(s, x.ag ? agentKey(x.a, x.ag) : x.a);

/** A public channel by id, name or #name. */
function channel(s: WsState, ref: string): string {
  const name = ref.replace(/^#/, '');
  const c = s.channels.get(name) ?? [...s.channels.values()].find((x) => x.name === name);
  return c ? c.id : fail(`No channel "${ref}". Use list_channels.`);
}

/** Someone by @handle (member or agent), "me" (this agent) or "owner". */
function actor(ctx: ToolCtx, ref: string): Actor {
  if (ref === 'me') return agentKey(ctx.me, ctx.agent.id);
  if (ref === 'owner') return ctx.me;
  const s = ctx.peer.state;
  const h = ref.replace(/^@/, '').toLowerCase();
  const member = [...s.profiles].find(([pub, p]) => p.handle.toLowerCase() === h && !s.bans.has(pub));
  if (member) return member[0];
  const agent = liveAgents(s).find((a) => a.handle.toLowerCase() === h);
  return agent ? agentKey(agent.owner, agent.id) : fail(`Nobody is @${h} here.`);
}

/** A public message by id. */
function message(s: WsState, id: string): Msg {
  const m = s.msgs.get(id);
  return m && !m.deleted && !isPrivateChannel(m.ch) ? m : fail(`No message ${id} in a channel.`);
}

const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fail(`"${iso}" is not a date and time (use ISO 8601, e.g. 2026-05-04T15:00:00Z).`);
};

function describeMsg(s: WsState, m: Msg): string {
  const extra: string[] = [];
  if (m.poll) {
    const t = pollTally(s, m.id);
    extra.push(`poll "${m.poll.q}": ` + t.options.map((o, i) => `[${i}] ${o.label} (${o.count})`).join(', ') + (m.poll.closes ? `, closes ${when(m.poll.closes)}` : ''));
  }
  if (m.meet) extra.push(`meeting "${m.meet.title}" at ${when(m.meet.at)}`);
  const d = s.decisions.get(m.id);
  if (d) extra.push(`decided: ${d.text}`);
  if (m.replies.length) extra.push(`${m.replies.length} replies`);
  return `[${m.id}] ${when(m.ts)} ${authorOf(s, m)}: ${m.text}${extra.length ? ' {' + extra.join('; ') + '}' : ''}`;
}

function describeTask(s: WsState, t: Task): string {
  const head =
    `[${t.id}] ${t.status.toUpperCase()} "${t.title}" in #${s.channels.get(t.ch)?.name}` +
    (t.assignee ? ` → ${nameOf(s, t.assignee)}` : ' (unassigned)') +
    (t.due ? `, due ${when(t.due)}` : '');
  const log = t.log
    .filter((c) => c.note || c.status || c.assignee !== undefined)
    .map(
      (c) =>
        `  ${when(c.ts)} ${authorOf(s, c)}: ` +
        [c.status && 'status ' + c.status, c.assignee !== undefined && (c.assignee ? 'assigned ' + nameOf(s, c.assignee) : 'unassigned'), c.note].filter(Boolean).join(', '),
    );
  return [head, ...log].join('\n');
}

/* ---------- tools ---------- */

interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run(ctx: ToolCtx, args: Json): Promise<string> | string;
}

type Props = Record<string, { type: string; description: string; items?: Json; enum?: readonly string[] }>;
const schema = (properties: Props, required: string[] = []): Json => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });

/** Arguments checked against `s`; a mismatch tells the agent what was wrong. */
function args<S extends v.GenericSchema>(s: S, a: Json): v.InferOutput<S> {
  const r = v.safeParse(s, a);
  return r.success ? r.output : fail('Bad arguments:\n' + v.summarize(r.issues));
}
const S = v.pipe(v.string(), v.trim(), v.nonEmpty());

const TOOLS: Tool[] = [
  {
    name: 'list_channels',
    description: 'The workspace’s channels, its members and agents.',
    inputSchema: schema({}),
    run: ({ peer }) => {
      const s = peer.state;
      const chs = [...s.channels.values()].map((c) => `#${c.name}${c.topic ? ' — ' + c.topic : ''}`);
      const people = [...s.profiles].filter(([pub]) => !s.bans.has(pub)).map(([, p]) => `${p.name} (@${p.handle})`);
      const agents = liveAgents(s).map((a) => `${a.name} (@${a.handle}, agent of @${s.profiles.get(a.owner)?.handle})`);
      return `Channels: ${chs.join(', ')}\nMembers: ${people.join(', ')}\nAgents: ${agents.join(', ') || 'none'}`;
    },
  },
  {
    name: 'read_messages',
    description: 'Recent messages in a channel (or one thread), oldest first, with their ids, polls, meetings and decisions.',
    inputSchema: schema({
      channel: str('Channel name, e.g. general'),
      thread: str('A message id: read its thread instead'),
      limit: { type: 'number', description: 'How many (default 30, max 200)' },
    }),
    run: (ctx, a) => {
      const p = args(v.object({ channel: v.optional(S), thread: v.optional(S), limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 30) }), a);
      const s = ctx.peer.state;
      const root = p.thread ? message(s, p.thread) : undefined;
      const ids = root ? [root.id, ...root.replies] : (s.channelMsgs.get(channel(s, p.channel ?? fail('Give a channel or a thread.'))) ?? []);
      const lines = ids
        .slice(-p.limit)
        .map((id) => s.msgs.get(id))
        .filter((m): m is Msg => m?.deleted === false)
        .map((m) => describeMsg(s, m));
      return lines.join('\n') || 'No messages.';
    },
  },
  {
    name: 'list_tasks',
    description: 'Tasks, newest first: yours (default), everyone’s, or one channel’s. Shows status, assignee, due date and activity.',
    inputSchema: schema({
      scope: { type: 'string', enum: ['mine', 'all'], description: 'mine (default) or all' },
      channel: str('Only this channel'),
      include_done: { type: 'boolean', description: 'Include finished tasks' },
    }),
    run: (ctx, a) => {
      const p = args(v.object({ scope: v.optional(v.picklist(['mine', 'all']), 'mine'), channel: v.optional(S), include_done: v.optional(v.boolean(), false) }), a);
      const s = ctx.peer.state;
      const ch = p.channel ? channel(s, p.channel) : undefined;
      const mine = agentKey(ctx.me, ctx.agent.id);
      const list = (p.scope === 'mine' ? openTasksFor(s, mine) : [...s.tasks.values()].reverse()).filter((t) => (!ch || t.ch === ch) && (p.include_done || t.status !== 'done'));
      return list.map((t) => describeTask(s, t)).join('\n') || 'No tasks.';
    },
  },
  {
    name: 'create_task',
    description: 'Create a task in a channel, optionally assigned (to @handle, "me" or "owner") and from a message.',
    inputSchema: schema(
      {
        channel: str('Channel name'),
        title: str('What needs doing'),
        assignee: str('@handle, "me" or "owner"'),
        due: str('ISO 8601 date and time'),
        from_message: str('The message id it comes from'),
      },
      ['channel', 'title'],
    ),
    run: (ctx, a) => {
      const p = args(v.object({ channel: S, title: v.pipe(S, v.maxLength(300)), assignee: v.optional(S), due: v.optional(S), from_message: v.optional(S) }), a);
      const s = ctx.peer.state;
      const id = newId();
      ctx.peer.publish({
        t: 'task',
        ag: ctx.agent.id,
        b: {
          id,
          title: p.title,
          ch: channel(s, p.channel),
          ...(p.from_message ? { src: message(s, p.from_message).id } : {}),
          ...(p.assignee ? { assignee: actor(ctx, p.assignee) } : {}),
          ...(p.due ? { due: time(p.due) } : {}),
        },
      });
      ctx.touch('task:' + id);
      return `Created task ${id}.`;
    },
  },
  {
    name: 'update_task',
    description:
      'Change a task: status (open, doing, blocked, done), assignee (@handle, "me", "owner" or "none" to hand it back), title, due date, and a note that explains the change. To hand work back, assign it to "owner" with a summary note.',
    inputSchema: schema(
      {
        id: str('Task id'),
        status: { type: 'string', enum: TASK_STATUSES, description: 'New status' },
        assignee: str('@handle, "me", "owner" or "none"'),
        title: str('New title'),
        due: str('ISO 8601, or "none"'),
        note: str('Progress note or handoff summary'),
      },
      ['id'],
    ),
    run: (ctx, a) => {
      const p = args(
        v.object({
          id: S,
          status: v.optional(v.picklist(TASK_STATUSES)),
          assignee: v.optional(S),
          title: v.optional(v.pipe(S, v.maxLength(300))),
          due: v.optional(S),
          note: v.optional(v.pipe(S, v.maxLength(4000))),
        }),
        a,
      );
      if (!ctx.peer.state.tasks.has(p.id)) fail(`No task ${p.id}. Use list_tasks.`);
      ctx.peer.publish({
        t: 'task.set',
        ag: ctx.agent.id,
        b: {
          id: p.id,
          ...(p.status ? { status: p.status } : {}),
          ...(p.assignee ? { assignee: p.assignee === 'none' ? null : actor(ctx, p.assignee) } : {}),
          ...(p.title ? { title: p.title } : {}),
          ...(p.due ? { due: p.due === 'none' ? null : time(p.due) } : {}),
          ...(p.note ? { note: p.note } : {}),
        },
      });
      ctx.touch('task:' + p.id);
      return `Updated task ${p.id}.`;
    },
  },
  {
    name: 'create_poll',
    description: 'Post a poll in a channel (2–10 options). Members and agents vote; it can close at a set time.',
    inputSchema: schema(
      {
        channel: str('Channel name'),
        question: str('The question'),
        options: { type: 'array', items: { type: 'string' }, description: '2 to 10 options' },
        multi: { type: 'boolean', description: 'Allow several choices' },
        closes: str('ISO 8601: stop counting votes then'),
      },
      ['channel', 'question', 'options'],
    ),
    run: (ctx, a) => {
      const p = args(
        v.object({
          channel: S,
          question: v.pipe(S, v.maxLength(300)),
          options: v.pipe(v.array(v.pipe(S, v.maxLength(100))), v.minLength(2), v.maxLength(10)),
          multi: v.optional(v.boolean()),
          closes: v.optional(S),
        }),
        a,
      );
      const e = ctx.peer.publish({
        t: 'msg',
        ch: channel(ctx.peer.state, p.channel),
        ag: ctx.agent.id,
        b: { text: p.question, poll: { q: p.question, options: p.options, ...(p.multi ? { multi: true as const } : {}), ...(p.closes ? { closes: time(p.closes) } : {}) } },
      });
      return `Posted poll ${e.id}.`;
    },
  },
  {
    name: 'vote',
    description: 'Vote in a poll, by option number (from read_messages). An empty list takes your vote back.',
    inputSchema: schema({ message: str('The poll’s message id'), choices: { type: 'array', items: { type: 'number' }, description: 'Option numbers, from 0' } }, [
      'message',
      'choices',
    ]),
    run: (ctx, a) => {
      const p = args(v.object({ message: S, choices: v.array(v.pipe(v.number(), v.integer(), v.minValue(0))) }), a);
      const m = message(ctx.peer.state, p.message);
      const poll = m.poll ?? fail('That message is not a poll.');
      if (p.choices.some((c) => c >= poll.options.length)) fail(`Options go from 0 to ${poll.options.length - 1}.`);
      ctx.peer.publish({ t: 'vote', ag: ctx.agent.id, b: { target: m.id, choices: p.choices } });
      return 'Voted.';
    },
  },
  {
    name: 'record_decision',
    description: 'Mark a message (often a poll or a thread’s conclusion) as a decision, with a one-line summary for the channel’s decision log.',
    inputSchema: schema({ message: str('Message id'), summary: str('What was decided') }, ['message', 'summary']),
    run: (ctx, a) => {
      const p = args(v.object({ message: S, summary: v.pipe(S, v.maxLength(2000)) }), a);
      ctx.peer.publish({ t: 'decide', ag: ctx.agent.id, b: { target: message(ctx.peer.state, p.message).id, text: p.summary, on: true } });
      return 'Recorded.';
    },
  },
  {
    name: 'list_decisions',
    description: 'The decision log: what was decided, where and by whom.',
    inputSchema: schema({ channel: str('Only this channel') }),
    run: ({ peer }, a) => {
      const p = args(v.object({ channel: v.optional(S) }), a);
      const s = peer.state;
      const ch = p.channel ? channel(s, p.channel) : undefined;
      const ds = [...s.decisions.values()].filter((d) => !ch || d.ch === ch).sort((x, y) => x.ts - y.ts);
      return ds.map((d) => `${when(d.ts)} #${s.channels.get(d.ch)?.name ?? 'private'} [${d.target}] ${d.text} (${authorOf(s, d)})`).join('\n') || 'No decisions yet.';
    },
  },
  {
    name: 'list_docs',
    description: 'Shared docs and boards, with ids.',
    inputSchema: schema({ channel: str('Only this channel') }),
    run: ({ peer }, a) => {
      const p = args(v.object({ channel: v.optional(S) }), a);
      const s = peer.state;
      const ch = p.channel ? channel(s, p.channel) : undefined;
      const ds = [...s.docs.values()].filter((d) => !d.archived && (!ch || d.ch === ch));
      return ds.map((d) => `[${d.id}] ${d.kind === 'board' ? 'board' : 'doc'} "${d.title}" in #${s.channels.get(d.ch)?.name}, edited ${when(d.updated)}`).join('\n') || 'No docs.';
    },
  },
  {
    name: 'read_doc',
    description: 'A doc’s text and its open suggestions, or a board’s sticky notes.',
    inputSchema: schema({ id: str('Doc id') }, ['id']),
    run: (ctx, a) => {
      const p = args(v.object({ id: S }), a);
      const d = ctx.peer.state.docs.get(p.id) ?? fail(`No doc ${p.id}. Use list_docs.`);
      ctx.touch('doc:' + d.id);
      if (d.kind === 'board')
        return (
          boardNotes(d.ops)
            .map((n) => `- [${n.id}] (${n.color}) ${n.text}`)
            .join('\n') || 'The board is empty.'
        );
      const open = d.suggestions.filter((x) => x.status === 'open').map((x) => `- [${x.id}] replace "${x.find}" with "${x.replace}"${x.note ? ' — ' + x.note : ''}`);
      return `# ${d.title}\n\n${docText(d.ops)}` + (open.length ? `\n\nOpen suggestions:\n${open.join('\n')}` : '');
    },
  },
  {
    name: 'create_doc',
    description: 'Create a shared doc (Markdown text) or a board (sticky notes) in a channel. A new doc can start with text you write.',
    inputSchema: schema(
      { channel: str('Channel name'), title: str('Title'), kind: { type: 'string', enum: ['text', 'board'], description: 'text (default) or board' }, text: str('Starting text') },
      ['channel', 'title'],
    ),
    run: (ctx, a) => {
      const p = args(v.object({ channel: S, title: v.pipe(S, v.maxLength(200)), kind: v.optional(v.picklist(['text', 'board']), 'text'), text: v.optional(v.string()) }), a);
      const id = newId();
      ctx.peer.publish({ t: 'doc', ag: ctx.agent.id, b: { id, title: p.title, ch: channel(ctx.peer.state, p.channel), kind: p.kind } });
      const op = p.kind === 'text' && p.text ? textOp([], p.text) : null;
      if (op) ctx.peer.publish({ t: 'doc.op', ag: ctx.agent.id, b: { doc: id, u: op } });
      ctx.touch('doc:' + id);
      return `Created ${p.kind === 'board' ? 'board' : 'doc'} ${id}.`;
    },
  },
  {
    name: 'suggest_edit',
    description: 'Propose a change to a doc: replace the exact text `find` with `replace` (empty `find` appends). People accept or reject it.',
    inputSchema: schema({ id: str('Doc id'), find: str('Exact text to replace; empty to append'), replace: str('New text'), note: str('Why') }, ['id', 'find', 'replace']),
    run: (ctx, a) => {
      const p = args(v.object({ id: S, find: v.string(), replace: v.string(), note: v.optional(S) }), a);
      const d = ctx.peer.state.docs.get(p.id) ?? fail(`No doc ${p.id}. Use list_docs.`);
      if (d.kind !== 'text') fail('Boards take notes (add_note), not text suggestions.');
      if (applySuggestion(docText(d.ops), p.find, p.replace) === null) fail('That text is not in the doc. Read it again with read_doc.');
      ctx.peer.publish({ t: 'suggest', ag: ctx.agent.id, b: { doc: d.id, find: p.find, replace: p.replace, ...(p.note ? { note: p.note } : {}) } });
      ctx.touch('doc:' + d.id);
      return 'Suggested. A member will accept or reject it.';
    },
  },
  {
    name: 'add_note',
    description: 'Add a sticky note to a board.',
    inputSchema: schema({ id: str('Board id'), text: str('Note text'), color: { type: 'string', enum: NOTE_COLORS, description: 'Note color' } }, ['id', 'text']),
    run: (ctx, a) => {
      const p = args(v.object({ id: S, text: v.pipe(S, v.maxLength(2000)), color: v.optional(v.picklist(NOTE_COLORS), 'yellow') }), a);
      const d = ctx.peer.state.docs.get(p.id) ?? fail(`No board ${p.id}. Use list_docs.`);
      if (d.kind !== 'board') fail('That is a text doc; use suggest_edit.');
      const n = boardNotes(d.ops).length;
      // Laid out in rows of five, so notes from several agents don't stack on one spot.
      const u = notePutOp(d.ops, { id: newId(), text: p.text, x: 20 + (n % 5) * 180, y: 20 + Math.floor(n / 5) * 140, color: p.color, by: agentKey(ctx.me, ctx.agent.id) });
      ctx.peer.publish({ t: 'doc.op', ag: ctx.agent.id, b: { doc: d.id, u } });
      ctx.touch('doc:' + d.id);
      return 'Added.';
    },
  },
  {
    name: 'schedule_meeting',
    description: 'Post a meeting in a channel; members answer yes, no or maybe and can join its huddle.',
    inputSchema: schema({ channel: str('Channel name'), title: str('Title'), at: str('ISO 8601 start'), minutes: { type: 'number', description: 'Length in minutes' } }, [
      'channel',
      'title',
      'at',
    ]),
    run: (ctx, a) => {
      const p = args(v.object({ channel: S, title: v.pipe(S, v.maxLength(200)), at: S, minutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1440))) }), a);
      const e = ctx.peer.publish({
        t: 'msg',
        ch: channel(ctx.peer.state, p.channel),
        ag: ctx.agent.id,
        b: { text: p.title, meet: { title: p.title, at: time(p.at), ...(p.minutes ? { dur: p.minutes } : {}) } },
      });
      return `Posted meeting ${e.id}.`;
    },
  },
  {
    name: 'rsvp',
    description: 'Answer a meeting invite.',
    inputSchema: schema({ message: str('The meeting’s message id'), going: { type: 'string', enum: ['yes', 'no', 'maybe'], description: 'Your answer' } }, ['message', 'going']),
    run: (ctx, a) => {
      const p = args(v.object({ message: S, going: v.picklist(['yes', 'no', 'maybe']) }), a);
      const m = message(ctx.peer.state, p.message);
      if (!m.meet) fail('That message is not a meeting.');
      ctx.peer.publish({ t: 'rsvp', ag: ctx.agent.id, b: { target: m.id, going: p.going } });
      return 'Answered.';
    },
  },
  {
    name: 'list_saved',
    description: 'Messages your owner saved for later (private to them and you).',
    inputSchema: schema({}),
    run: ({ peer, me }) => {
      const s = peer.state;
      const ms = (s.saved.get(me) ?? []).map((id) => s.msgs.get(id)).filter((m): m is Msg => m?.deleted === false);
      return ms.map((m) => describeMsg(s, m)).join('\n') || 'Nothing saved.';
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

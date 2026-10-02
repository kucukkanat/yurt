import { describe, it, expect, beforeAll } from 'vitest';
import {
  WorkspacePeer,
  agentKey,
  dmChannel,
  keyFromPhrase,
  makeEvent,
  newNostrTransport,
  newRecoveryPhrase,
  textOp,
  type AgentConfig,
  type EvType,
  type KeyPair,
} from '@yurt/protocol';
import { memStore } from '../../protocol/test/util';
import { handleMcp, TOOL_NAMES, type ToolCtx } from '../src/mcp';
import { must, until } from './helpers';

// The tools one by one, against a real WorkspacePeer's state (it never connects: events go in through receive()).
const CODE = 'MCPTOOLS';
const OWNER = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase()); // never introduces themselves
const agent: AgentConfig = {
  id: 'scout',
  name: 'Scout',
  handle: 'scout',
  runtime: 'copilot',
  workdir: '/tmp',
  instructions: '',
  autoApprove: [],
  contextSize: 20,
  respondTo: { mentions: true, replies: false },
  postIn: { thread: false, channel: true },
  discoverable: false,
  online: true,
};
const peer = new WorkspacePeer({
  code: CODE,
  kp: OWNER,
  transport: newNostrTransport(['ws://127.0.0.1:1']),
  store: memStore().store,
  creator: OWNER.pub,
  onError: () => {},
});
const touched: string[] = [];
const ctx: ToolCtx = { peer, agent, me: OWNER.pub, touch: (on) => touched.push(on) };

let n = 0;
/** An event from someone else, as if it arrived; returns its id once the state has it. */
async function from(kp: KeyPair, t: EvType, b: unknown, extra: { ch?: string; to?: string; ag?: string } = {}) {
  const e = makeEvent(kp, { ws: CODE, t, b, ts: Date.now() + n++, ...extra });
  peer.receive([e]);
  await until(() => seen.has(e.id));
  return e.id;
}
/** Events the state has taken in (receive() applies them on the next recompute). */
const seen = new Set<string>();
peer.o.onState = (_s, fresh) => {
  for (const e of fresh) seen.add(e.id);
};

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);
  const res = must(r?.result) as { content: { text: string }[]; isError?: boolean };
  const text = must(res.content[0]).text;
  // Let the events it published reach the state.
  await new Promise((ok) => setTimeout(ok, 40));
  return res.isError ? 'ERR ' + text : text;
}

beforeAll(async () => {
  await from(OWNER, 'ws.create', { name: 'Tools' });
  await from(OWNER, 'ch.create', { id: 'general', name: 'general' });
  await from(OWNER, 'ch.create', { id: 'quiet', name: 'quiet' });
  await from(B, 'profile', { name: 'Bea', handle: 'bea' });
  await from(OWNER, 'profile', { name: 'Olu', handle: 'olu' });
});

describe('the MCP protocol', () => {
  it('initializes, pings, lists tools and refuses what it does not know', async () => {
    expect(await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, null)).toMatchObject({
      result: { serverInfo: { name: 'yurt' }, capabilities: { tools: {} } },
    });
    expect(await handleMcp({ jsonrpc: '2.0', id: 'p', method: 'ping' }, null)).toEqual({ jsonrpc: '2.0', id: 'p', result: {} });
    const list = (await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, null)) as { result: { tools: { name: string; inputSchema: object }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    expect(list.result.tools.every((t) => 'type' in t.inputSchema)).toBe(true);
    expect(await handleMcp({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, null)).toMatchObject({ error: { code: -32601 } });
    expect(await handleMcp([1, 2], null)).toMatchObject({ id: null, error: { code: -32600 } });
    expect(await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: 'x' }, ctx)).toMatchObject({ error: { code: -32602 } });
    expect(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, null)).toBeNull();
  });
});

describe('tools', () => {
  it('describe an empty workspace plainly', async () => {
    expect(await call('list_channels')).toContain('Agents: none');
    expect(await call('read_messages', { channel: 'quiet' })).toBe('No messages.');
    expect(await call('list_tasks')).toBe('No tasks.');
    expect(await call('list_decisions')).toBe('No decisions yet.');
    expect(await call('list_docs')).toBe('No docs.');
    expect(await call('list_saved')).toBe('Nothing saved.');
  });

  it('name people without a profile and agents nobody announced, and read threads', async () => {
    const root = await from(C, 'msg', { text: 'anyone?' }, { ch: 'general' });
    await from(OWNER, 'msg', { text: 'me', parent: root }, { ch: 'general', ag: 'ghost' });
    const poll = await from(B, 'msg', { text: 'q', poll: { q: 'Pick', options: ['a', 'b'] } }, { ch: 'general' });
    const thread = await call('read_messages', { thread: root });
    expect(thread).toContain(`@${C.pub.slice(0, 8)}: anyone? {1 replies}`);
    expect(thread).toContain('@ghost (agent): me');
    expect(await call('read_messages', { channel: 'general' })).toContain(`[${poll}]`);
    expect(await call('read_messages', { channel: 'general' })).toContain('poll "Pick": [0] a (0), [1] b (0)}');
  });

  it('assign to the owner and to agents by handle, and change every part of a task', async () => {
    await from(OWNER, 'agent', { id: 'scout', name: 'Scout', handle: 'scout', runtime: 'copilot', replyIn: 'channel' });
    const src = await from(B, 'msg', { text: 'do this' }, { ch: 'general' });
    expect(await call('create_task', { channel: 'general', title: 'For the owner', assignee: 'owner', from_message: src })).toMatch(/^Created task /);
    const t = must([...peer.state.tasks.values()].find((x) => x.title === 'For the owner'));
    expect(t).toMatchObject({ assignee: OWNER.pub, src, ag: 'scout' });
    expect(t.due).toBeUndefined();
    expect(touched.at(-1)).toBe('task:' + t.id);
    await call('update_task', { id: t.id, assignee: '@scout', title: 'Renamed', due: '2031-05-05T05:05:00Z' });
    expect(peer.state.tasks.get(t.id)).toMatchObject({ assignee: agentKey(OWNER.pub, 'scout'), title: 'Renamed', due: Date.parse('2031-05-05T05:05:00Z') });
    await call('update_task', { id: t.id, assignee: 'none', due: 'none' });
    expect(peer.state.tasks.get(t.id)).toMatchObject({ assignee: undefined, due: undefined });
    await call('update_task', { id: t.id, note: 'just a note' });
    const desc = await call('list_tasks', { scope: 'all', channel: 'general' });
    expect(desc).toContain('OPEN "Renamed" in #general (unassigned)');
    expect(desc).toContain('assigned @olu');
    expect(desc).toContain('assigned @scout (agent)');
    expect(desc).toContain('@scout (agent): unassigned');
    expect(desc).toContain('@scout (agent): just a note');
    expect(await call('list_tasks', { scope: 'all', channel: 'quiet' })).toBe('No tasks.');
    expect(await call('list_channels')).toContain('Agents: Scout (@scout, agent of @olu)');
  });

  it('post multi-choice polls and meetings without an end, and keep a decision log', async () => {
    expect(await call('create_poll', { channel: 'general', question: 'Which?', options: ['x', 'y'], multi: true })).toMatch(/^Posted poll /);
    const poll = must([...peer.state.msgs.values()].find((m) => m.poll?.q === 'Which?'));
    expect(poll.poll).toEqual({ q: 'Which?', options: ['x', 'y'], multi: true });
    await call('schedule_meeting', { channel: 'general', title: 'Standup', at: '2031-01-01T09:00:00Z' });
    expect([...peer.state.msgs.values()].find((m) => m.meet)?.meet).toEqual({ title: 'Standup', at: Date.parse('2031-01-01T09:00:00Z') });
    const dm = dmChannel(OWNER.pub, B.pub);
    const secret = await from(B, 'msg', { text: 'just us' }, { ch: dm, to: OWNER.pub });
    await from(B, 'decide', { target: secret, text: 'between us', on: true }, { to: OWNER.pub });
    await call('record_decision', { message: poll.id, summary: 'x it is' });
    const log = await call('list_decisions');
    expect(log).toContain('#private');
    expect(log).toContain('#general [' + poll.id + '] x it is');
    expect(await call('list_decisions', { channel: 'quiet' })).toBe('No decisions yet.');
  });

  it('read docs and boards, and suggest without a note', async () => {
    await call('create_doc', { channel: 'general', title: 'Empty' });
    await call('create_doc', { channel: 'quiet', title: 'Wall', kind: 'board' });
    const empty = must([...peer.state.docs.values()].find((d) => d.title === 'Empty'));
    const wall = must([...peer.state.docs.values()].find((d) => d.title === 'Wall'));
    expect(empty.ops).toEqual([]);
    expect(await call('read_doc', { id: wall.id })).toBe('The board is empty.');
    expect(await call('read_doc', { id: empty.id })).toBe('# Empty\n\n');
    await from(B, 'doc.op', { doc: empty.id, u: must(textOp([], 'abc')) });
    await call('suggest_edit', { id: empty.id, find: '', replace: 'more' });
    expect(await call('read_doc', { id: empty.id })).toBe(
      `# Empty\n\nabc\n\nOpen suggestions:\n- [${must(peer.state.docs.get(empty.id)?.suggestions[0]).id}] replace "" with "more"`,
    );
    expect(await call('list_docs', { channel: 'quiet' })).toContain('board "Wall" in #quiet');
    await from(B, 'doc.set', { id: wall.id, archived: true });
    expect(await call('list_docs', { channel: 'quiet' })).toBe('No docs.');
    expect(await call('suggest_edit', { id: 'nope', find: '', replace: 'x' })).toBe('ERR No doc nope. Use list_docs.');
    expect(await call('add_note', { id: 'nope', text: 'x' })).toBe('ERR No board nope. Use list_docs.');
    // Twelve notes laid out in rows; the same doc touched again doesn't re-announce it.
    const board = await call('create_doc', { channel: 'general', title: 'Big', kind: 'board' });
    const id = board.replace(/^Created board (.+)\.$/, '$1');
    const before = touched.length;
    for (let i = 0; i < 6; i++) await call('add_note', { id, text: 'n' + i });
    expect(touched.length).toBe(before + 6);
    expect(await call('read_doc', { id })).toContain('(yellow) n5');
  });

  it('list only saved messages that still exist', async () => {
    const keep = await from(B, 'msg', { text: 'keep me' }, { ch: 'general' });
    const gone = await from(B, 'msg', { text: 'gone soon' }, { ch: 'general' });
    await from(OWNER, 'save', { target: keep, on: true }, { to: OWNER.pub });
    await from(OWNER, 'save', { target: gone, on: true }, { to: OWNER.pub });
    await from(OWNER, 'save', { target: 'never-seen', on: true }, { to: OWNER.pub });
    await from(B, 'del', { target: gone }, { ch: 'general' });
    const saved = await call('list_saved');
    expect(saved).toContain('keep me');
    expect(saved).not.toContain('gone soon');
  });
});

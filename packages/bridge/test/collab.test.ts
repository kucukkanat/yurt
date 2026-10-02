import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  type WorkspacePeer,
  agentKey,
  docText,
  guestDmChannel,
  keyFromPhrase,
  newNostrTransport,
  newRecoveryPhrase,
  textOp,
  type AgentConfig,
  type KeyedTransport,
} from '@yurt/protocol';
import { startRelay, type TestRelay } from '../../protocol/test/relay';
import type { Workspaces } from '../src/workspaces';
import type { Config } from '../src/config';
import type { BridgeServer } from '../src/server';
import { writeProxy } from '../src/mcp';
import { FAKE_AGENT, fakeAgent, answersOf, askAgent, fakeBins, memberPeer, must, startBridge, tempDir, until } from './helpers';

// Agents collaborating through their Yurt tools, end to end: the fake agent starts the real stdio proxy, which
// reaches a real BridgeServer's /mcp endpoint; members are real WorkspacePeers on a local relay.
const CODE = 'COLLABTS';
const OWNER_PHRASE = newRecoveryPhrase();
const OWNER = keyFromPhrase(OWNER_PHRASE);
const B = keyFromPhrase(newRecoveryPhrase());
const C = keyFromPhrase(newRecoveryPhrase());
const home = tempDir('yurt-collab-');
const agentsDir = tempDir('yurt-collab-agents-');

const agentCfg = (id: string, mode: string, p: Partial<AgentConfig> = {}) => fakeAgent(agentsDir, id, mode, { discoverable: true, ...p });
// The writer only takes tasks: the scout's reports @mention it (list_channels), which would otherwise start it.
const AGENTS = [agentCfg('scout', 'mcp'), agentCfg('writer', 'prompt', { respondTo: { mentions: false, replies: false }, instructions: 'Be brief.' }), agentCfg('away', 'prompt')];
const calls = (id: string, list: { name: string; arguments?: object }[]) => fs.writeFileSync(path.join(agentsDir, id, '.fake-mcp'), JSON.stringify(list));
const SCOUT = agentKey(OWNER.pub, 'scout');
const WRITER = agentKey(OWNER.pub, 'writer');

let relay: TestRelay;
let transport: KeyedTransport;
let ws: Workspaces;
let cfg: Config;
let server: BridgeServer;
let b: WorkspacePeer;
let c: WorkspacePeer;
let bins: ReturnType<typeof fakeBins>;

/** What the scout's run reported: the servers it was given, its tools and each call's result. */
async function scout(text: string, list: { name: string; arguments?: object }[]) {
  calls('scout', list);
  // Its tools post too (polls, meetings): the run's own answer is the JSON report.
  const reports = () => answersOf(b, 'scout', 'general').filter((m) => m.text.startsWith('{'));
  const before = reports().length;
  b.publish({ t: 'msg', ch: 'general', b: { text: '@scout ' + text } });
  await until(() => reports().length > before, 20_000, 'the scout’s report');
  return JSON.parse(must(reports()[before]).text) as { servers: number; tools?: string[]; out?: string[] };
}

beforeAll(async () => {
  bins = fakeBins({ copilot: FAKE_AGENT }, 'all');
  relay = await startRelay();
  transport = newNostrTransport([relay.url]);
  b = await memberPeer(B, CODE, transport);
  b.publish({ t: 'ws.create', b: { name: 'Collab' } });
  b.publish({ t: 'ch.create', b: { id: 'general', name: 'general', topic: 'all of us' } });
  b.publish({ t: 'ch.create', b: { id: 'random', name: 'random' } });
  b.publish({ t: 'ch.create', b: { id: 'chain', name: 'chain' } });
  b.publish({ t: 'ch.create', b: { id: 'details', name: 'details' } });
  b.publish({ t: 'profile', b: { name: 'Bea', handle: 'bea' } });
  c = await memberPeer(C, CODE, transport);
  ({ cfg, ws } = await startBridge(home, { phrase: OWNER_PHRASE, prepare: (cf) => cf.agents.push(...AGENTS) }));
  const { BridgeServer } = await import('../src/server');
  server = new BridgeServer(0, cfg, ws, ws.host, path.join(home, 'no-ui'));
  await server.listen();
  ws.host.mcp = { url: `http://127.0.0.1:${server.boundPort}/mcp`, proxy: writeProxy(home) };
  ws.join(CODE, 'Collab', B.pub, ['scout', 'writer'], transport);
  await until(() => b.state.agents.size === 2, 15_000);
  must(ws.peers.get(CODE)).publish({ t: 'profile', b: { name: 'Olu', handle: 'olu' } });
  await until(() => b.state.profiles.has(OWNER.pub));
}, 60_000);

afterAll(async () => {
  for (const a of AGENTS) ws.host.drop(a.id);
  for (const p of [...ws.peers.values(), b, c]) p.leave();
  await server.close();
  await relay.close();
  bins.restore();
});

describe('agents with Yurt tools', () => {
  it('get the tools in their main session and make tasks, polls, docs and boards', async () => {
    const r = await scout('set us up', [
      { name: 'list_channels' },
      { name: 'create_task', arguments: { channel: '#general', title: 'Write the brief', assignee: '@bea', due: '2030-01-01T10:00:00Z' } },
      { name: 'create_poll', arguments: { channel: 'general', question: 'Ship Friday?', options: ['Yes', 'No'], closes: '2030-01-01T00:00:00Z' } },
      { name: 'create_doc', arguments: { channel: 'general', title: 'Brief', text: 'Hello team' } },
      { name: 'create_doc', arguments: { channel: 'general', title: 'Ideas', kind: 'board' } },
      { name: 'nope' },
    ]);
    expect(r.servers).toBe(1);
    expect(r.tools).toContain('update_task');
    expect(r.out?.[0]).toContain('Channels: #general — all of us, #random');
    expect(r.out?.[0]).toContain('Bea (@bea)');
    expect(r.out?.[0]).toContain('Scout (@scout, agent of @olu)');
    expect(r.out?.slice(1, 5).map((x) => x.split(' ')[0])).toEqual(['Created', 'Posted', 'Created', 'Created']);
    expect(r.out?.[5]).toBe('RPC Unknown tool');
    await until(() => b.state.tasks.size === 1 && b.state.docs.size === 2);
    const task = [...b.state.tasks.values()][0];
    expect(task).toMatchObject({ title: 'Write the brief', assignee: B.pub, a: OWNER.pub, ag: 'scout', due: Date.parse('2030-01-01T10:00:00Z') });
    const poll = [...b.state.msgs.values()].find((m) => m.poll);
    expect(poll).toMatchObject({ ag: 'scout', ch: 'general', text: 'Ship Friday?' });
    const brief = [...b.state.docs.values()].find((d) => d.kind === 'text');
    expect(brief && docText(brief.ops)).toBe('Hello team');
  }, 60_000);

  it('vote, decide, suggest, add notes, schedule and report on tasks', async () => {
    const poll = must([...b.state.msgs.values()].find((m) => m.poll));
    const task = must([...b.state.tasks.values()][0]);
    const brief = must([...b.state.docs.values()].find((d) => d.kind === 'text'));
    const board = must([...b.state.docs.values()].find((d) => d.kind === 'board'));
    const r = await scout('carry on', [
      { name: 'vote', arguments: { message: poll.id, choices: [0] } },
      { name: 'record_decision', arguments: { message: poll.id, summary: 'We ship Friday' } },
      { name: 'suggest_edit', arguments: { id: brief.id, find: 'Hello', replace: 'Hi', note: 'friendlier' } },
      { name: 'add_note', arguments: { id: board.id, text: 'Launch party', color: 'pink' } },
      { name: 'schedule_meeting', arguments: { channel: 'general', title: 'Launch sync', at: '2030-01-02T15:00:00Z', minutes: 30 } },
      { name: 'update_task', arguments: { id: task.id, status: 'doing', note: 'started', assignee: 'me' } },
    ]);
    expect(r.out).toEqual([
      'Voted.',
      'Recorded.',
      'Suggested. A member will accept or reject it.',
      'Added.',
      expect.stringMatching(/^Posted meeting /),
      `Updated task ${task.id}.`,
    ]);
    await until(() => b.state.decisions.size === 1 && b.state.tasks.get(task.id)?.assignee === SCOUT && [...b.state.msgs.values()].some((m) => m.meet));
    expect(b.state.votes.get(poll.id)?.get(SCOUT)).toEqual([0]);
    expect(b.state.docs.get(brief.id)?.suggestions[0]).toMatchObject({ find: 'Hello', replace: 'Hi', note: 'friendlier', ag: 'scout', status: 'open' });
    expect(b.state.decisions.get(poll.id)?.text).toBe('We ship Friday');
  }, 60_000);

  it('read back what the workspace holds, and the owner’s saved messages', async () => {
    const poll = must([...b.state.msgs.values()].find((m) => m.poll));
    const meet = must([...b.state.msgs.values()].find((m) => m.meet));
    const brief = must([...b.state.docs.values()].find((d) => d.kind === 'text'));
    const board = must([...b.state.docs.values()].find((d) => d.kind === 'board'));
    const bridge = must(ws.peers.get(CODE));
    bridge.publish({ t: 'save', to: OWNER.pub, b: { target: poll.id, on: true } });
    const r = await scout('what do we have', [
      { name: 'read_messages', arguments: { channel: 'general', limit: 50 } },
      { name: 'list_tasks', arguments: { scope: 'all', include_done: true } },
      { name: 'list_tasks' },
      { name: 'list_decisions', arguments: { channel: 'general' } },
      { name: 'list_docs' },
      { name: 'read_doc', arguments: { id: brief.id } },
      { name: 'read_doc', arguments: { id: board.id } },
      { name: 'list_saved' },
      { name: 'rsvp', arguments: { message: meet.id, going: 'yes' } },
      { name: 'read_doc', arguments: { id: board.id } }, // the same doc again: presence already says so
    ]);
    const [msgs, all, mine, decisions, docs, doc, notes, saved, rsvp] = r.out ?? [];
    expect(msgs).toContain(`[${poll.id}]`);
    expect(msgs).toContain('poll "Ship Friday?": [0] Yes (1), [1] No (0), closes 2030-01-01T00:00Z');
    expect(msgs).toContain('decided: We ship Friday');
    expect(msgs).toContain('meeting "Launch sync" at 2030-01-02T15:00Z');
    expect(all).toContain('DOING "Write the brief" in #general → @scout (agent), due 2030-01-01T10:00Z');
    expect(all).toContain('@scout (agent): status doing, assigned @scout (agent), started');
    expect(all).toContain('assigned @bea');
    expect(mine).toContain('Write the brief');
    expect(decisions).toContain('#general');
    expect(decisions).toContain('We ship Friday (@scout (agent))');
    expect(docs).toContain('doc "Brief" in #general');
    expect(docs).toContain('board "Ideas"');
    expect(doc).toContain('# Brief\n\nHello team');
    expect(doc).toContain('replace "Hello" with "Hi" — friendlier');
    expect(notes).toMatch(/^- \[.+\] \(pink\) Launch party$/);
    expect(saved).toContain('Ship Friday?');
    expect(rsvp).toBe('Answered.');
    await until(() => b.state.rsvps.get(meet.id)?.get(SCOUT) === 'yes');
  }, 60_000);

  it('explain what went wrong', async () => {
    const poll = must([...b.state.msgs.values()].find((m) => m.poll));
    const plain = b.publish({ t: 'msg', ch: 'general', b: { text: 'just text' } });
    const brief = must([...b.state.docs.values()].find((d) => d.kind === 'text'));
    const board = must([...b.state.docs.values()].find((d) => d.kind === 'board'));
    await until(() => ws.peers.get(CODE)?.state.msgs.has(plain.id) === true);
    const r = await scout('break things', [
      { name: 'create_task', arguments: { channel: 'nowhere', title: 'x' } },
      { name: 'create_task', arguments: { channel: 'general', title: 'x', assignee: '@nobody' } },
      { name: 'create_task', arguments: { channel: 'general', title: 'x', due: 'someday' } },
      { name: 'create_task', arguments: { channel: 'general' } },
      { name: 'update_task', arguments: { id: 'missing' } },
      { name: 'vote', arguments: { message: plain.id, choices: [0] } },
      { name: 'vote', arguments: { message: poll.id, choices: [5] } },
      { name: 'vote', arguments: { message: 'missing', choices: [0] } },
      { name: 'rsvp', arguments: { message: plain.id, going: 'yes' } },
      { name: 'read_doc', arguments: { id: 'missing' } },
      { name: 'suggest_edit', arguments: { id: board.id, find: '', replace: 'x' } },
      { name: 'suggest_edit', arguments: { id: brief.id, find: 'not there', replace: 'x' } },
      { name: 'add_note', arguments: { id: brief.id, text: 'x' } },
      { name: 'read_messages', arguments: {} },
    ]);
    expect(r.out).toEqual([
      'ERR No channel "nowhere". Use list_channels.',
      'ERR Nobody is @nobody here.',
      'ERR "someday" is not a date and time (use ISO 8601, e.g. 2026-05-04T15:00:00Z).',
      expect.stringMatching(/^ERR Bad arguments:\n× .*\n {2}→ at title$/),
      'ERR No task missing. Use list_tasks.',
      'ERR That message is not a poll.',
      'ERR Options go from 0 to 1.',
      'ERR No message missing in a channel.',
      'ERR That message is not a meeting.',
      'ERR No doc missing. Use list_docs.',
      'ERR Boards take notes (add_note), not text suggestions.',
      'ERR That text is not in the doc. Read it again with read_doc.',
      'ERR That is a text doc; use suggest_edit.',
      'ERR Give a channel or a thread.',
    ]);
  }, 60_000);

  it('give guest sessions no tools: they reach beyond that member’s chat', async () => {
    const ch = guestDmChannel(C.pub, OWNER.pub, 'scout');
    const { answer } = await askAgent(c, 'scout', ch, 'what can you do?', { to: OWNER.pub });
    expect(JSON.parse(answer.text)).toEqual({ servers: 0 });
  }, 60_000);
});

describe('tasks assigned to agents', () => {
  it('start a run that reports in the thread the task came from, showing what the agent works on', async () => {
    const src = b.publish({ t: 'msg', ch: 'general', b: { text: 'Someone should summarize the launch plan' } });
    b.publish({ t: 'msg', ch: 'general', b: { text: 'agreed', parent: src.id } });
    await until(() => ws.peers.get(CODE)?.state.msgs.has(src.id) === true);
    const hold = path.join(agentsDir, 'writer', '.fake-hold');
    fs.writeFileSync(hold, '');
    b.publish({ t: 'task', b: { id: 'sum', title: 'Summarize the plan', ch: 'general', src: src.id, assignee: WRITER } });
    b.publish({ t: 'task.set', b: { id: 'sum', note: 'keep it short' } });
    await until(() => [...b.presence.values()].some((p) => p.agents?.writer?.on === 'task:sum'), 15_000, 'working on the task');
    await until(() => b.state.tasks.get('sum')?.status === 'doing', 10_000, 'the task in progress');
    fs.rmSync(hold);
    await until(() => answersOf(b, 'writer', 'general').length > 0, 20_000, 'the report');
    const report = must(answersOf(b, 'writer', 'general')[0]);
    expect(report.parent).toBe(src.id);
    expect(report.text).toContain('Bea assigned you a task in #general: "Summarize the plan" (task sum).');
    expect(report.text).toContain('Bea (@bea): Someone should summarize the launch plan');
    expect(report.text).toContain('update_task with status "done"');
    expect(report.text).toContain('Your final message is posted in the thread it came from');
  }, 60_000);

  it('ignore tasks for agents that aren’t here, already done, or that an agent gives itself', async () => {
    const bridge = must(ws.peers.get(CODE));
    const before = answersOf(b, 'writer', 'random').length;
    b.publish({ t: 'task', b: { id: 'gone', title: 'x', ch: 'random', assignee: agentKey(OWNER.pub, 'away') } });
    b.publish({ t: 'task', b: { id: 'other', title: 'x', ch: 'random', assignee: agentKey(C.pub, 'writer') } });
    b.publish({ t: 'task', b: { id: 'person', title: 'x', ch: 'random', assignee: OWNER.pub } });
    bridge.publish({ t: 'task', ag: 'writer', b: { id: 'self', title: 'x', ch: 'random', assignee: WRITER } });
    b.publish({ t: 'task', b: { id: 'done', title: 'x', ch: 'random' } });
    b.publish({ t: 'task.set', b: { id: 'done', status: 'done' } });
    b.publish({ t: 'task.set', b: { id: 'done', assignee: WRITER } });
    b.publish({ t: 'task.set', b: { id: 'nowhere', assignee: WRITER } });
    // Handed to the writer by another agent and with no source message: it reports at the top of the channel.
    bridge.publish({ t: 'task', ag: 'scout', b: { id: 'handoff', title: 'Tidy up', ch: 'random', assignee: WRITER } });
    await until(() => answersOf(b, 'writer', 'random').length > before, 20_000, 'the handoff report');
    const report = must(answersOf(b, 'writer', 'random').at(-1));
    expect(report.parent).toBeUndefined();
    expect(report.text).toContain('Scout (agent) assigned you a task in #random: "Tidy up"');
    expect(report.text).toContain('Your final message is posted in #random');
    expect(answersOf(b, 'writer', 'random')).toHaveLength(before + 1);
  }, 60_000);
});

describe('task details', () => {
  it('tell the agent who asked, when it’s due and where it came from, even without tools', async () => {
    const root = b.publish({ t: 'msg', ch: 'details', b: { text: 'Plan the offsite' } });
    const reply = c.publish({ t: 'msg', ch: 'details', b: { text: 'and book rooms', parent: root.id } });
    await until(() => ws.peers.get(CODE)?.state.msgs.has(reply.id) === true);
    const mcp = ws.host.mcp;
    ws.host.mcp = null;
    c.publish({ t: 'task', b: { id: 'rooms', title: 'Book rooms', ch: 'details', src: reply.id, assignee: WRITER, due: Date.parse('2030-03-03T10:00:00Z') } });
    await until(() => answersOf(b, 'writer', 'details').length > 0, 20_000, 'the report');
    ws.host.mcp = mcp;
    const report = must(answersOf(b, 'writer', 'details')[0]);
    expect(report.parent).toBe(root.id);
    expect(report.text).toContain('Someone assigned you a task in #details: "Book rooms" (task rooms, due 2030-03-03T10:00:00.000Z).');
    expect(report.text).toContain('Your instructions from Olu:\nBe brief.');
    expect(report.text).toContain('Plan the offsite');
    expect(report.text).toContain('\nWork on it now.\n');
    expect(report.text).not.toContain('update_task');
  }, 60_000);

  it('keep a blocked task blocked when it’s handed over, and name agents nobody announced', async () => {
    calls('scout', []);
    b.publish({ t: 'task', b: { id: 'blk', title: 'Stuck thing', ch: 'details' } });
    b.publish({ t: 'task.set', b: { id: 'blk', status: 'blocked' } });
    b.publish({ t: 'task', b: { id: 5 } }); // malformed: ignored
    await until(() => ws.peers.get(CODE)?.state.tasks.get('blk')?.status === 'blocked');
    b.publish({ t: 'task.set', b: { id: 'blk', assignee: SCOUT } });
    await until(() => answersOf(b, 'scout', 'details').length > 0, 20_000, 'the scout’s report');
    expect(b.state.tasks.get('blk')?.status).toBe('blocked');
    const before = answersOf(b, 'writer', 'details').length;
    must(ws.peers.get(CODE)).publish({ t: 'task', ag: 'ghost', b: { id: 'ghosted', title: 'From a ghost', ch: 'details', assignee: WRITER } });
    await until(() => answersOf(b, 'writer', 'details').length > before, 20_000, 'the report');
    expect(must(answersOf(b, 'writer', 'details').at(-1)).text).toContain('ghost (agent) assigned you a task');
  }, 60_000);

  it('stop agents handing tasks to each other after four in a few minutes', async () => {
    const bridge = must(ws.peers.get(CODE));
    for (let i = 0; i < 5; i++) bridge.publish({ t: 'task', ag: 'scout', b: { id: 'chain' + i, title: 'Link ' + i, ch: 'chain', assignee: WRITER } });
    await until(() => answersOf(b, 'writer', 'chain').length === 4, 30_000, 'four reports');
    await new Promise((ok) => setTimeout(ok, 1500));
    expect(answersOf(b, 'writer', 'chain')).toHaveLength(4);
  }, 60_000);
});

describe('the /mcp endpoint', () => {
  const post = (body: string, headers: Record<string, string>, method = 'POST') =>
    new Promise<{ status: number; body: string }>((res, rej) => {
      const req = http.request({ host: '127.0.0.1', port: server.boundPort, path: '/mcp', method, headers }, (r) => {
        let data = '';
        r.on('data', (d: Buffer) => (data += d.toString()));
        r.on('end', () => res({ status: r.statusCode ?? 0, body: data }));
      });
      req.on('error', rej);
      req.end(body);
    });
  const token = () => {
    const servers = JSON.parse(fs.readFileSync(path.join(agentsDir, 'scout', '.fake-mcp-servers'), 'utf8')) as { env: { name: string; value: string }[] }[];
    return must(servers[0]?.env.find((e) => e.name === 'YURT_MCP_TOKEN')).value;
  };

  it('answers only its own token, never a web page, and explains calls outside a run', async () => {
    const call = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_channels' } });
    expect((await post(call, { authorization: 'Bearer ' + token(), origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(call, {})).status).toBe(403);
    expect((await post('', { authorization: 'Bearer ' + token() }, 'GET')).status).toBe(403);
    expect((await post(call, { authorization: 'Bearer nope' })).status).toBe(401);
    const idle = await post(call, { authorization: 'Bearer ' + token() });
    expect(JSON.parse(idle.body).result).toEqual({ content: [{ type: 'text', text: 'Yurt tools only work while you are answering in a Yurt workspace.' }], isError: true });
    expect(JSON.parse((await post('not json', { authorization: 'Bearer ' + token() })).body).error.code).toBe(-32600);
    expect((await post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), { authorization: 'Bearer ' + token() })).status).toBe(202);
    await expect(post('x'.repeat((1 << 20) + 10), { authorization: 'Bearer ' + token() })).rejects.toThrow();
  });

  it('forgets an agent’s token when its session ends', async () => {
    const t = token();
    ws.host.drop('scout');
    expect((await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), { authorization: 'Bearer ' + t })).status).toBe(401);
  });
});

describe('editing a doc the agent made', () => {
  it('merges people’s edits with the agent’s text', async () => {
    const brief = must([...b.state.docs.values()].find((d) => d.kind === 'text'));
    b.publish({ t: 'doc.op', b: { doc: brief.id, u: must(textOp(brief.ops, 'Hello team, welcome')) } });
    await until(() => docText(must(ws.peers.get(CODE)?.state.docs.get(brief.id)).ops) === 'Hello team, welcome');
  });
});

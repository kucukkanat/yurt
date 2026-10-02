// A real (tiny) ACP agent for tests, run as a child process in place of an agent CLI.
// Behaviour comes from FAKE_ACP_MODE, else `.fake-mode` in its working folder:
//   ok (default)  prompt asks permission to edit, then answers with the outcome
//   auth-fail     session/new fails with the ACP auth error
//   fail          session/new fails with another error
//   no-session    session/new answers without a session id
//   hang          prompts never finish
//   echo          answers with its pid and the prompt's "Reply to …" line (tests see which run and session it was)
//   prompt        answers with the whole prompt it was given (tests check what the agent was told)
//   tools         a prompt reports tool calls, odd updates and a permission request, then answers
//   one-tool      a prompt reports one finished tool call, then answers
//   perm-exit     a prompt asks permission, then the agent exits before the answer arrives
//   exit-on-prompt  the agent exits when prompted
//   auth-methods  offers a sign-in method; `authenticate` succeeds
//   crash         exits at once
//   mcp           a prompt starts the session's first MCP server (as an agent CLI would), lists its tools, makes the
//                 calls in `.fake-mcp` (JSON [{name, arguments}]) and answers with JSON {tools, out, servers};
//                 session/new writes the servers it was given (if any) to `.fake-mcp-servers`
//   script        on initialize, first prints every line of `.fake-script` (raw; `#stderr ` lines go to stderr), then answers
// While `.fake-hold` exists in its folder, a prompt waits (tests delete it to let the run go on).
// Permission requests offer allow_once/reject_once, or the options in FAKE_ACP_OPTIONS (JSON).
// In every mode, `test/reply` answers with its params as the response body (e.g. { error: … }), so tests can shape replies.
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

if (process.argv.includes('--version')) {
  console.log(process.env.FAKE_ACP_VERSION ?? 'fake-acp 9.9.9');
  process.exit(0);
}
fs.writeFileSync('.fake-pid', String(process.pid));
const mode = process.env.FAKE_ACP_MODE || (fs.existsSync('.fake-mode') ? fs.readFileSync('.fake-mode', 'utf8').trim() : 'ok');
if (mode === 'crash') process.exit(3);
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const update = (u) => send({ method: 'session/update', params: { sessionId: 'fake-session', update: u } });
let promptId = null;
let mcpServers = [];

/** Talks MCP to the session's first server the way an agent CLI does: initialize, tools/list, then each call. */
const runMcp = async (m) => {
  const srv = mcpServers[0];
  const answer = (text) => {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
    send({ id: m.id, result: { stopReason: 'end_turn' } });
  };
  if (!srv) return answer(JSON.stringify({ servers: 0 }));
  const child = spawn(srv.command, srv.args, { env: { ...process.env, ...Object.fromEntries(srv.env.map((e) => [e.name, e.value])) }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (l) => {
    const r = JSON.parse(l);
    waiting.get(r.id)?.(r);
  });
  let n = 0;
  const call = (method, params) =>
    new Promise((res) => {
      const id = ++n;
      waiting.set(id, res);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-acp', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await call('tools/list', {});
  const calls = fs.existsSync('.fake-mcp') ? JSON.parse(fs.readFileSync('.fake-mcp', 'utf8')) : [];
  const out = [];
  for (const c of calls) {
    const r = await call('tools/call', c);
    out.push(r.result ? (r.result.isError ? 'ERR ' : '') + r.result.content[0].text : 'RPC ' + r.error.message);
  }
  child.kill();
  answer(JSON.stringify({ servers: mcpServers.length, tools: list.result.tools.map((t) => t.name), out }));
};

const permission = () =>
  send({
    id: 'perm-1',
    method: 'session/request_permission',
    params: {
      sessionId: 'fake-session',
      toolCall: { kind: 'edit', title: 'edit notes.md' },
      options: process.env.FAKE_ACP_OPTIONS
        ? JSON.parse(process.env.FAKE_ACP_OPTIONS)
        : [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
    },
  });

const onPrompt = (m) => {
  if (mode === 'hang') return;
  if (mode === 'exit-on-prompt') process.exit(4);
  if (mode === 'prompt') {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: m.params.prompt.map((p) => p.text).join('\n') } });
    send({ id: m.id, result: { stopReason: 'end_turn' } });
    return;
  }
  if (mode === 'one-tool') {
    update({ sessionUpdate: 'tool_call', toolCallId: 'only', title: 'List files', kind: 'read', status: 'completed' });
    send({ id: m.id, result: { stopReason: 'end_turn' } });
    return;
  }
  if (mode === 'mcp') {
    void runMcp(m);
    return;
  }
  if (mode === 'echo') {
    const text = m.params.prompt.map((p) => p.text).join('\n');
    const ask = text.split('\n').find((l) => l.startsWith('Reply to the last message')) ?? '';
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `pid=${process.pid} ${ask}` } });
    send({ id: m.id, result: { stopReason: 'end_turn' } });
    return;
  }
  promptId = m.id;
  if (mode === 'tools') {
    update({ sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'read', status: 'in_progress' });
    update({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'Search the web', status: 'in_progress' });
    update({ sessionUpdate: 'tool_call', toolCallId: 't3' });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', title: 'Read notes.md', status: 'completed' });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'failed' });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't3', status: 'in_progress' });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't3' });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'nope', status: 'completed' });
    update({ sessionUpdate: 'tool_call_update' });
    update({ sessionUpdate: 'plan', entries: [] });
    update({ sessionUpdate: 'current_mode_update', toolCallId: 't1' }); // not a tool update, despite the id
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'x' } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text' } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Read it. ' } });
  }
  permission();
  if (mode === 'perm-exit') setTimeout(() => process.exit(5), 50);
};

const hold = (go) => {
  if (!fs.existsSync('.fake-hold')) return go();
  const t = setInterval(() => {
    if (fs.existsSync('.fake-hold')) return;
    clearInterval(t);
    go();
  }, 20);
};

const printScript = () => {
  for (const l of fs.readFileSync('.fake-script', 'utf8').split('\n')) {
    if (l.startsWith('#stderr ')) process.stderr.write(l.slice(8) + '\n');
    else process.stdout.write(l + '\n');
  }
};

/** session/new's answer in each mode. */
const NEW_SESSION = {
  'auth-fail': { error: { code: -32000, message: 'Authentication required' } },
  fail: { error: { code: -32603, message: 'Internal error: disk full' } },
  'no-session': { result: {} },
};

/** How each method is answered. */
const METHODS = {
  initialize(m) {
    if (mode === 'script') printScript();
    send({ id: m.id, result: { protocolVersion: 1, authMethods: mode === 'auth-methods' ? [{ id: 'browser', name: 'Browser' }] : [] } });
  },
  authenticate: (m) => send({ id: m.id, result: {} }),
  'test/reply': (m) => send({ id: m.id, ...m.params }),
  'session/new': (m) => {
    mcpServers = m.params.mcpServers ?? [];
    if (mode === 'mcp' && mcpServers.length) fs.writeFileSync('.fake-mcp-servers', JSON.stringify(mcpServers));
    send({ id: m.id, ...(NEW_SESSION[mode] ?? { result: { sessionId: 'fake-session' } }) });
  },
  'session/set_model': (m) => send({ id: m.id, ...(m.params.modelId === 'bad-model' ? { error: { code: -32602, message: 'Unknown model' } } : { result: {} }) }),
  'session/prompt': (m) => hold(() => onPrompt(m)),
};

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method) METHODS[m.method]?.(m);
  else if (m.id === 'perm-1') send({ id: promptId, result: { stopReason: 'end_turn', permission: m.result?.outcome ?? m.error } });
});

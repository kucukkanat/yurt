// A real (tiny) ACP agent for tests, run as a child process in place of an agent CLI.
// Behaviour comes from `.fake-mode` in its working folder: ok (default) | auth-fail | hang | echo.
// echo answers with its pid and the prompt's "Reply to …" line, so tests can see which run and session it was.
import fs from 'node:fs';
import readline from 'node:readline';

if (process.argv.includes('--version')) { console.log('fake-acp 9.9.9'); process.exit(0); }
fs.writeFileSync('.fake-pid', String(process.pid));
const mode = fs.existsSync('.fake-mode') ? fs.readFileSync('.fake-mode', 'utf8').trim() : 'ok';
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
let promptId = null;

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: 1, authMethods: [] } });
  else if (m.method === 'session/new') {
    if (mode === 'auth-fail') send({ id: m.id, error: { code: -32000, message: 'Authentication required' } });
    else send({ id: m.id, result: { sessionId: 'fake-session' } });
  } else if (m.method === 'session/prompt') {
    if (mode === 'hang') return;
    if (mode === 'echo') {
      const text = m.params.prompt.map((p) => p.text).join('\n');
      const ask = text.split('\n').find((l) => l.startsWith('Reply to the last message')) ?? '';
      send({ method: 'session/update', params: { sessionId: 'fake-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `pid=${process.pid} ${ask}` } } } });
      send({ id: m.id, result: { stopReason: 'end_turn' } });
      return;
    }
    promptId = m.id;
    send({ id: 'perm-1', method: 'session/request_permission', params: {
      sessionId: 'fake-session', toolCall: { kind: 'edit', title: 'edit notes.md' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
    } });
  } else if (m.id === 'perm-1') send({ id: promptId, result: { stopReason: 'end_turn', permission: m.result?.outcome ?? m.error } });
});

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AcpConnection, isAuthError, type AcpUpdate } from '../src/acp';
import { onLog } from '../src/log';
import { FAKE_ACP, alive, tempDir, until } from './helpers';

// Every AcpConnection here runs the real fake agent (test/fixtures/fake-acp.mjs) as a child process.
const open: AcpConnection[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

function agent(mode: string, script?: string[]) {
  const d = tempDir('yurt-acp-');
  fs.writeFileSync(path.join(d, '.fake-mode'), mode);
  if (script) fs.writeFileSync(path.join(d, '.fake-script'), script.join('\n'));
  const c = new AcpConnection('test', process.execPath, [FAKE_ACP], d);
  open.push(c);
  return { c, pid: () => Number(fs.readFileSync(path.join(d, '.fake-pid'), 'utf8')) };
}

/** Log lines (as the Activity view sees them) while `f` runs. */
async function logsDuring(f: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const off = onLog((e) => lines.push(`${e.level} ${e.msg}`));
  try {
    await f();
  } finally {
    off();
  }
  return lines;
}

const j = (m: object) => JSON.stringify({ jsonrpc: '2.0', ...m });

describe('AcpConnection: reading what an agent prints', () => {
  it('skips banners, blank lines and malformed messages, and routes the rest', async () => {
    const updates: [string, AcpUpdate][] = [];
    const { c } = agent('script', [
      'Welcome to FakeAgent v1!',
      '',
      '[1, 2]',
      j({ method: 7 }),
      j({ method: 'session/update', params: { update: {} } }),
      j({ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'plan', title: 3 } } }),
      j({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hi' } } } }),
      j({ method: 'notifications/progress' }),
      j({ id: 'q1', method: 'fs/read_text_file', params: {} }),
      j({ id: 99, result: 'not ours' }),
      j({ id: 'x', result: 'string ids are never ours' }),
      j({ id: null }),
      '#stderr warming up',
    ]);
    c.onUpdate = (sid, u) => updates.push([sid, u]);
    const lines: string[] = [];
    const off = onLog((e) => lines.push(`${e.level} ${e.msg}`));
    expect(await c.initialize()).toEqual({ authMethods: [] });
    await until(() => updates.length === 2 && lines.includes('acp stderr: warming up'));
    off();
    expect(updates).toEqual([
      ['s1', { sessionUpdate: 'plan', title: undefined, content: undefined, toolCallId: undefined, kind: undefined, status: undefined }],
      ['', { sessionUpdate: 'agent_message_chunk', content: { type: '', text: 'hi' }, toolCallId: undefined, title: undefined, kind: undefined, status: undefined }],
    ]);
    // An unknown request still gets an answer, so the agent doesn't wait forever.
    expect(lines.some((l) => l.includes('"id":"q1"') && l.includes('does not provide fs/read_text_file'))).toBe(true);
    expect(lines).toContain('acp stderr: warming up');
  });

  it('answers permission requests through onPermission, and reports its failures to the agent', async () => {
    const { c } = agent('script', [
      j({ id: 'p1', method: 'session/request_permission', params: { n: 1 } }),
      j({ id: 'p2', method: 'session/request_permission', params: { n: 2 } }),
      j({ id: 'p3', method: 'session/request_permission', params: { n: 3 } }),
      j({ id: 'p4', method: 'session/request_permission', params: { n: 4 } }),
    ]);
    const seen: unknown[] = [];
    c.onPermission = async (p) => {
      seen.push(p);
      if (seen.length === 2) throw new Error('declined by test');
      if (seen.length === 3) throw new Error('');
      if (seen.length === 4) throw 'not an Error';
      return { outcome: { outcome: 'selected', optionId: 'allow' } };
    };
    const lines = await logsDuring(async () => {
      await c.initialize();
      await until(() => seen.length === 4);
      await new Promise((r) => setTimeout(r, 50));
    });
    const sent = (id: string) => lines.find((l) => l.startsWith('acp →') && l.includes(`"id":"${id}"`));
    expect(sent('p1')).toContain('"optionId":"allow"');
    expect(sent('p2')).toContain('"message":"declined by test"');
    expect(sent('p3')).toContain('"message":"failed"');
    expect(sent('p4')).toContain('"message":"failed"');
  });
});

describe('AcpConnection: requests', () => {
  it('resolves results and turns agent errors into ACP errors', async () => {
    const { c } = agent('ok');
    await c.initialize();
    expect(await c.request('test/reply', { result: { a: 1 } })).toEqual({ a: 1 });
    const err = await c.request('test/reply', { error: { code: -32000, message: 'Authentication required' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isAuthError(err)).toBe(true);
    await expect(c.request('test/reply', { error: { code: 1 } })).rejects.toThrow('ACP error');
    await expect(c.request('test/reply', { error: 'bad' })).rejects.toThrow('ACP error');
  });

  it('times a request out, and keeps working afterwards', async () => {
    const { c } = agent('hang');
    await c.initialize();
    await expect(c.request('session/prompt', { sessionId: 's', prompt: [] }, 50)).rejects.toThrow('session/prompt timed out');
    expect(await c.request('test/reply', { result: 'still here' }, 5000)).toBe('still here');
  });

  it('rejects what is in flight when the agent exits, and refuses new requests', async () => {
    const { c } = agent('exit-on-prompt');
    let exited = false;
    c.onExit = () => {
      exited = true;
    };
    await c.initialize();
    await expect(c.request('session/prompt', {}, 5000)).rejects.toThrow('Agent process exited');
    expect(exited && c.closed).toBe(true);
    await expect(c.request('test/reply', {})).rejects.toThrow('Agent is not running');
  });

  it('close() stops the agent and rejects in-flight requests', async () => {
    const { c, pid } = agent('hang');
    await c.initialize();
    const p = c.request('session/prompt', {}, 60_000);
    c.close();
    await expect(p).rejects.toThrow('Agent was stopped');
    await until(() => !alive(pid()));
  });

  it('reports an agent that cannot be started instead of crashing', async () => {
    const c = new AcpConnection('missing', path.join(tempDir('yurt-none-'), 'no-such-agent'), [], tempDir('yurt-cwd-'));
    open.push(c);
    const lines = await logsDuring(async () => {
      await expect(c.initialize()).rejects.toThrow(/ENOENT/);
    });
    expect(lines.some((l) => l.startsWith('error spawn failed'))).toBe(true);
    expect(c.closed).toBe(true);
  });

  it('survives an agent that stopped reading its input (EPIPE)', async () => {
    // A shell that closes its stdin, then idles: writing a request to it fails with EPIPE.
    const c = new AcpConnection('deaf', '/bin/sh', ['-c', 'exec 0<&-; sleep 5'], tempDir('yurt-deaf-'));
    open.push(c);
    const lines: string[] = [];
    const off = onLog((e) => lines.push(`${e.level} ${e.msg}`));
    await new Promise((r) => setTimeout(r, 200)); // let the shell close its end first
    const r = c.request('initialize', {}, 300).catch((e: unknown) => e);
    await until(() => lines.some((l) => l.startsWith('warn stdin:')), 5000);
    expect(await r).toBeInstanceOf(Error); // never answered: times out, nothing crashed
    off();
    expect(lines.some((l) => l.includes('EPIPE'))).toBe(true);
  });

  it('drops an approval that arrives after the agent died', async () => {
    const { c } = agent('perm-exit');
    c.onPermission = async () => {
      await until(() => c.closed);
      return { outcome: { outcome: 'selected', optionId: 'allow' } };
    };
    await c.initialize();
    await c.request('session/new', {});
    const lines = await logsDuring(async () => {
      await expect(c.request('session/prompt', {})).rejects.toThrow('Agent process exited');
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(lines.some((l) => l.startsWith('acp →') && l.includes('"id":"perm-1"'))).toBe(false);
  });
});

describe('isAuthError', () => {
  it('recognizes sign-in failures by ACP code or wording, nothing else', () => {
    expect(isAuthError(new Error('Please sign in first'))).toBe(true);
    expect(isAuthError(new Error('invalid API key'))).toBe(true);
    expect(isAuthError(new Error('disk full'))).toBe(false);
    expect(isAuthError('auth')).toBe(false);
  });
});

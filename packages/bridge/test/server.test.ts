import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import WebSocket from 'ws';
import { newNostrTransport, newRecoveryPhrase, keyFromPhrase, type FromBridge } from '@yurt/protocol';
import type { BridgeServer, PairingTiming } from '../src/server';
import type { Config } from '../src/config';
import type { Workspaces } from '../src/workspaces';
import { parseFromBridge } from '../src/schemas';
import { FAKE_AGENT, fakeBins, must, tempDir, until } from './helpers';

// A real BridgeServer on a free port, with real Workspaces and AgentHost; browsers are `ws` clients.
// config.ts reads YURT_HOME on import, so everything is imported after pointing it at a temp folder,
// and HOME points at a temp folder too so "start on login" never touches the real one.
const root = tempDir('yurt-server-');
const uiDir = path.join(root, 'ui');
const savedHome = process.env.HOME;
let mods: {
  config: typeof import('../src/config');
  server: typeof import('../src/server');
  workspaces: typeof import('../src/workspaces');
  agents: typeof import('../src/agents');
  log: typeof import('../src/log');
};
let bins: ReturnType<typeof fakeBins>;
const open: BridgeServer[] = [];
const unparsed: string[] = [];

beforeAll(async () => {
  process.env.YURT_HOME = path.join(root, 'home');
  process.env.HOME = path.join(root, 'user');
  fs.mkdirSync(uiDir);
  fs.writeFileSync(path.join(uiDir, 'index.html'), '<html><head></head><body>bridge ui</body></html>');
  fs.writeFileSync(path.join(uiDir, 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(uiDir, 'app.css'), 'body{}');
  fs.writeFileSync(path.join(uiDir, 'data.bin'), 'bytes');
  fs.mkdirSync(path.join(uiDir, 'assets'));
  fs.mkdirSync(path.join(root, 'ui-secret'));
  fs.writeFileSync(path.join(root, 'ui-secret', 'secret.txt'), 'top secret');
  // Agent CLIs, npm and Terminal are stand-ins: nothing is installed or opened for real.
  const RECORD = 'echo "$@" >> "$0.log"';
  bins = fakeBins({ copilot: FAKE_AGENT, npm: 'exit 0', osascript: RECORD, 'x-terminal-emulator': RECORD });
  const [config, server, workspaces, agents, log] = await Promise.all([
    import('../src/config'),
    import('../src/server'),
    import('../src/workspaces'),
    import('../src/agents'),
    import('../src/log'),
  ]);
  mods = { config, server, workspaces, agents, log };
});
afterAll(async () => {
  expect(unparsed).toEqual([]);
  await Promise.all(open.map((s) => s.close()));
  bins.restore();
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  fs.rmSync(root, { recursive: true, force: true });
});

interface Bridge {
  server: BridgeServer;
  cfg: Config;
  ws: Workspaces;
  port: number;
}

async function start(opts: { ui?: string; timing?: PairingTiming; listen?: boolean } = {}): Promise<Bridge> {
  const cfg = mods.config.loadConfig();
  const ws = new mods.workspaces.Workspaces(cfg, () => {});
  const host = new mods.agents.AgentHost(
    cfg,
    () => ws.me,
    () => {},
    () => {},
  );
  ws.host = host;
  const server = new mods.server.BridgeServer(0, cfg, ws, host, opts.ui ?? uiDir, opts.timing);
  open.push(server);
  if (opts.listen !== false) await server.listen();
  return { server, cfg, ws, port: server.boundPort };
}

/** Raw GET: fetch() would normalize or reject the hostile paths under test. */
const get = (port: number, p: string, host = `127.0.0.1:${port}`) =>
  new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((res, rej) => {
    http
      .get({ host: '127.0.0.1', port, path: p, headers: { host } }, (r) => {
        let body = '';
        r.on('data', (d) => (body += d)).on('end', () => res({ status: r.statusCode ?? 0, body, headers: r.headers }));
      })
      .on('error', rej);
  });

interface Client {
  sock: WebSocket;
  replies: FromBridge[];
  send(m: unknown): void;
  /** The next unread reply that matches `pred` (a cursor: replies that already arrived count, none is read twice). */
  next(pred?: (m: FromBridge) => boolean): Promise<FromBridge>;
  closed: Promise<number>;
}

async function connect(b: Bridge, opts: { origin?: string | null; path?: string; host?: string } = {}): Promise<Client> {
  const headers: Record<string, string> = {};
  if (opts.host) headers.host = opts.host;
  const origin = opts.origin === undefined ? `http://127.0.0.1:${b.port}` : opts.origin;
  const sock = new WebSocket(`ws://127.0.0.1:${b.port}${opts.path ?? '/ws'}`, { ...(origin ? { origin } : {}), headers });
  const replies: FromBridge[] = [];
  const closed = new Promise<number>((res) => sock.on('close', (code) => res(code)));
  sock.on('message', (d) => {
    replies.push(JSON.parse(String(d)) as FromBridge);
    // The bridge page validates what it receives (schemas.ts): every message the server sends must pass.
    if (!parseFromBridge(String(d))) unparsed.push(String(d));
  });
  await new Promise((res, rej) => {
    sock.once('open', res);
    sock.once('error', rej);
  });
  let cursor = 0;
  return {
    sock,
    replies,
    closed,
    send: (m) => sock.send(typeof m === 'string' ? m : JSON.stringify(m)),
    async next(pred = () => true) {
      const at = () => replies.findIndex((m, i) => i >= cursor && pred(m));
      await until(() => at() >= 0, 5000);
      const i = at();
      cursor = i + 1;
      return must(replies[i], 'reply');
    },
  };
}

const isError = (m: FromBridge) => m.t === 'error';
const isState = (m: FromBridge) => m.t === 'state';
const stateOf = (m: FromBridge) => (m.t === 'state' ? m.state : null);

/** A connected bridge-page client (admin token), after its hello. */
async function admin(b: Bridge) {
  const c = await connect(b);
  c.send({ t: 'hello', token: b.cfg.adminToken });
  await c.next(isState);
  return c;
}

/** A connected web-app client that paired with the code. */
async function webApp(b: Bridge) {
  const c = await connect(b);
  c.send({ t: 'pair', code: b.server.pairingCode });
  await c.next((m) => m.t === 'paired');
  return c;
}

describe('static UI server', () => {
  let b: Bridge;
  beforeAll(async () => {
    b = await start();
  });

  it('serves the UI with the admin token, and assets with their types', async () => {
    const r = await get(b.port, '/');
    expect(r.status).toBe(200);
    expect(r.body).toContain('bridge ui');
    expect(r.body).toContain(`window.__YURT_ADMIN__=${JSON.stringify(b.cfg.adminToken)}`);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-frame-options']).toBe('DENY');
    for (const [p, type] of [
      ['/app.js', 'text/javascript'],
      ['/app.css', 'text/css'],
      ['/data.bin', 'application/octet-stream'],
    ] as const) {
      const a = await get(b.port, p);
      expect([a.status, a.headers['content-type'], a.headers['cache-control']]).toEqual([200, type, 'max-age=3600']);
    }
  });

  it('answers unknown paths and folders with the app, so client routes work', async () => {
    for (const p of ['/settings', '/assets', '/%2E']) expect((await get(b.port, p)).body).toContain('bridge ui');
  });

  it('answers a malformed escape with 400 instead of crashing', async () => {
    expect((await get(b.port, '/%E0')).status).toBe(400);
    expect((await get(b.port, '/')).status).toBe(200); // still up
  });

  it('refuses a sibling folder that shares the UI folder name as a prefix', async () => {
    const r = await get(b.port, '/..%2fui-secret/secret.txt');
    expect(r.status).toBe(403);
    expect(r.body).not.toContain('top secret');
  });

  it('only answers to its own host name (DNS rebinding)', async () => {
    expect((await get(b.port, '/', 'evil.example')).status).toBe(403);
    expect((await get(b.port, '/', `localhost:${b.port}`)).status).toBe(200);
  });

  it('says how to build the UI when it is missing', async () => {
    const empty = await start({ ui: tempDir('yurt-noui-') });
    const r = await get(empty.port, '/');
    expect([r.status, r.body]).toEqual([500, 'Bridge UI is missing. Run: npm run build -w packages/bridge']);
  });
});

describe('who may connect', () => {
  let b: Bridge;
  beforeAll(async () => {
    b = await start();
  });

  it('refuses other paths, host names and origins', async () => {
    await expect(connect(b, { path: '/other' })).rejects.toThrow('403');
    await expect(connect(b, { host: 'evil.example' })).rejects.toThrow('403');
    await expect(connect(b, { origin: 'https://evil.example' })).rejects.toThrow('403');
    await expect(connect(b, { origin: null })).rejects.toThrow('403');
  });

  it('accepts its own page (127.0.0.1 or localhost) and allowed web apps', async () => {
    for (const origin of [`http://127.0.0.1:${b.port}`, `http://localhost:${b.port}`, 'http://localhost:5173']) {
      const c = await connect(b, { origin });
      c.sock.close();
    }
  });

  it('answers invalid messages with an error, and anything but hello/pair before pairing', async () => {
    const c = await connect(b);
    c.send('not json');
    expect(await c.next()).toEqual({ t: 'error', msg: 'Invalid message' });
    c.send({ t: 'agent.save' });
    expect(await c.next()).toEqual({ t: 'error', msg: 'Invalid message' });
    c.send({ t: 'ws.leave', code: 'AAAABBBB' });
    expect(await c.next()).toEqual({ t: 'error', msg: 'Not paired' });
    c.send({ t: 'hello' });
    expect(await c.next()).toMatchObject({ t: 'hello', paired: false, admin: false });
    c.send({ t: 'hello', token: 'wrong' });
    expect(await c.next()).toMatchObject({ t: 'hello', paired: false });
    c.sock.close();
  });

  it('gives the bridge page the pairing code and recent logs, and web apps neither', async () => {
    mods.log.log('info', 'test', 'something happened');
    const page = await connect(b);
    page.send({ t: 'hello', token: b.cfg.adminToken });
    const st = stateOf(await page.next(isState));
    expect(st?.pairingCode).toBe(b.server.pairingCode);
    await until(() => page.replies.some((m) => m.t === 'log' && m.msg === 'something happened'));
    const app = await webApp(b);
    const token = must(
      app.replies.find((m) => m.t === 'paired'),
      'paired',
    );
    const again = await connect(b);
    again.send({ t: 'hello', token: token.t === 'paired' ? token.token : '' });
    expect(await again.next()).toMatchObject({ t: 'hello', paired: true, admin: false });
    const appState = stateOf(await again.next(isState));
    expect(appState && 'pairingCode' in appState).toBe(false);
    for (const c of [page, app, again]) c.sock.close();
  });
});

describe('pairing limits', () => {
  let b: Bridge;
  beforeAll(async () => {
    b = await start();
  });
  const wrong = () => (b.server.pairingCode === '000000' ? '000001' : '000000');

  it('pairs with the right code, which then changes', async () => {
    const code = b.server.pairingCode;
    const c = await webApp(b);
    expect(b.server.pairingCode).not.toBe(code);
    const paired = c.replies.find((m) => m.t === 'paired');
    expect(b.cfg.tokens.at(-1)).toBe(paired?.t === 'paired' ? paired.token : 'missing');
    c.sock.close();
  });

  it('closes a connection after 3 wrong codes, and changes the code after 5', async () => {
    const before = b.server.pairingCode;
    const c = await connect(b);
    for (let i = 0; i < 3; i++) {
      c.send({ t: 'pair', code: wrong() });
      expect(await c.next()).toEqual({ t: 'error', msg: 'Wrong pairing code' });
    }
    expect(await c.closed).toBe(1008);
    const d = await connect(b);
    for (let i = 0; i < 2; i++) {
      d.send({ t: 'pair', code: wrong() });
      await d.next();
    }
    expect(b.server.pairingCode).not.toBe(before);
    d.sock.close();
  });

  it('locks pairing for everyone after 10 wrong codes a minute, even for the right code', async () => {
    // 5 misses already spent above; 5 more across fresh connections reach the limit.
    for (let left = 5; left > 0; left -= 2) {
      const c = await connect(b);
      for (let i = 0; i < Math.min(2, left); i++) {
        c.send({ t: 'pair', code: wrong() });
        await c.next();
      }
      c.sock.close();
    }
    const c = await connect(b);
    c.send({ t: 'pair', code: b.server.pairingCode });
    const r = await c.next();
    expect(r).toMatchObject({ t: 'error' });
    expect(r.t === 'error' && r.msg).toMatch(/Too many wrong pairing codes\. Try again in \d+ s/);
    c.sock.close();
  });

  it('keeps at most 10 paired browsers', async () => {
    const fresh = await start();
    for (let i = 0; i < 11; i++) (await webApp(fresh)).sock.close();
    expect(fresh.cfg.tokens).toHaveLength(10);
  });

  it('rotates a code that has been shown too long', async () => {
    const fast = await start({ timing: { checkMs: 20, maxAgeMs: 30 } });
    const code = fast.server.pairingCode;
    await until(() => fast.server.pairingCode !== code);
  });
});

describe('what a paired web app may do', () => {
  let b: Bridge;
  let app: Client;
  beforeAll(async () => {
    b = await start();
    app = await webApp(b);
  });

  it('links its identity, and replaces another one with a warning', async () => {
    app.send({ t: 'identity', phrase: 'not a phrase', name: 'Ada', handle: 'ada' });
    expect(await app.next(isError)).toEqual({ t: 'error', msg: 'Invalid identity' });
    const first = newRecoveryPhrase();
    app.send({ t: 'identity', phrase: first, name: 'Ada', handle: 'ada' });
    await until(() => b.ws.me === keyFromPhrase(first).pub);
    app.send({ t: 'identity', phrase: first, name: 'Ada', handle: 'ada' }); // unchanged: nothing rewritten
    app.send({ t: 'identity', phrase: first, name: 'Ada L.', handle: 'ada' });
    await until(() => mods.config.loadIdentity()?.name === 'Ada L.');
    const lines: string[] = [];
    const off = mods.log.onLog((e) => lines.push(e.msg));
    const second = newRecoveryPhrase();
    app.send({ t: 'identity', phrase: second, name: 'Bo', handle: 'bo' });
    await until(() => b.ws.me === keyFromPhrase(second).pub);
    off();
    expect(lines).toContain('identity replaced by a paired browser');
  });

  it('joins, re-assigns agents in, and leaves workspaces', async () => {
    const transport = newNostrTransport(['ws://127.0.0.1:9']);
    app.send({ t: 'ws.join', code: 'JOINTEST', name: 'Join', creator: null, agents: [], transport });
    await until(() => b.cfg.workspaces.some((w) => w.code === 'JOINTEST'));
    app.send({ t: 'ws.agents', code: 'JOINTEST', agents: ['nobody'] });
    app.send({ t: 'ws.agents', code: 'UNKNOWN1', agents: [] }); // never joined: no keyless room gets opened
    expect(await app.next(isError)).toEqual({ t: 'error', msg: 'Unknown workspace UNKNOWN1' });
    app.send({ t: 'ws.leave', code: 'JOINTEST' });
    await until(() => !b.cfg.workspaces.length);
  });

  it("can't change the bridge's own settings", async () => {
    app.send({ t: 'pair.rotate' });
    expect(await app.next(isError)).toEqual({ t: 'error', msg: 'Only the bridge page can change this' });
  });
});

describe('what the bridge page may do', () => {
  let b: Bridge;
  let page: Client;
  const agent = (p: Record<string, unknown> = {}) => ({
    id: '',
    name: 'Scout',
    handle: 'scout',
    runtime: 'copilot',
    workdir: path.join(root, 'agents', 'scout'),
    instructions: '',
    autoApprove: ['read'],
    contextSize: 20,
    respondTo: { mentions: true, replies: false },
    postIn: { thread: true, channel: false },
    discoverable: false,
    ...p,
  });
  beforeAll(async () => {
    b = await start();
    page = await admin(b);
  });

  it('creates agents (and their folder), refuses a taken handle, and updates them', async () => {
    page.send({ t: 'agent.save', agent: agent() });
    await until(() => b.cfg.agents.length === 1);
    const saved = must(b.cfg.agents[0], 'agent');
    expect(fs.existsSync(saved.workdir)).toBe(true);
    page.send({ t: 'agent.save', agent: agent({ name: 'Other' }) });
    expect(await page.next(isError)).toEqual({ t: 'error', msg: 'Another agent already uses @scout' });
    page.send({ t: 'agent.save', agent: agent({ id: saved.id, name: 'Scout 2', instructions: 'be brief' }) });
    await until(() => b.cfg.agents[0]?.name === 'Scout 2');
    page.send({ t: 'agent.save', agent: agent({ id: saved.id, runtime: 'opencode' }) }); // a new runtime restarts its process
    await until(() => b.cfg.agents[0]?.runtime === 'opencode');
    page.send({ t: 'agent.save', agent: agent({ id: saved.id, postIn: { thread: false, channel: false } }) });
    expect(await page.next(isError)).toEqual({ t: 'error', msg: 'Pick where the agent posts: in a thread, in the channel, or both' });
  });

  it('removes an agent from the bridge and every workspace', async () => {
    const id = must(b.cfg.agents[0], 'agent').id;
    page.send({ t: 'ws.join', code: 'REMOVEWS', name: 'R', agents: [id], transport: newNostrTransport(['ws://127.0.0.1:9']) });
    await until(() => b.cfg.workspaces.some((w) => w.agents.includes(id)));
    page.send({ t: 'agent.remove', id });
    await until(() => !b.cfg.agents.length && !b.cfg.workspaces.some((w) => w.agents.includes(id)));
    page.send({ t: 'ws.leave', code: 'REMOVEWS' });
  });

  it('installs, checks and signs in agent CLIs', async () => {
    page.send({ t: 'runtime.install', id: 'copilot' });
    await until(() => page.replies.some((m) => m.t === 'state' && m.state.runtimes.some((r) => r.id === 'copilot' && r.auth === 'signed-in')), 10_000);
    page.send({ t: 'runtime.check', id: 'copilot' });
    page.send({ t: 'runtime.login', id: 'copilot' }); // no ACP sign-in offered: opens a terminal
    await until(() => (bins.record('osascript') + bins.record('x-terminal-emulator')).includes('copilot'), 10_000);
  });

  it('turns start-on-login on and off, keeping the old setting when it fails', async () => {
    page.send({ t: 'startOnLogin', on: true });
    await until(() => b.cfg.startOnLogin);
    page.send({ t: 'startOnLogin', on: false });
    await until(() => !b.cfg.startOnLogin);
    // Where the login item would go is a file, not a folder: writing it fails, the setting stays off.
    const home = must(process.env.HOME, 'HOME');
    fs.rmSync(home, { recursive: true, force: true });
    fs.mkdirSync(home);
    for (const blocker of ['Library', '.config', 'AppData']) fs.writeFileSync(path.join(home, blocker), '');
    page.send({ t: 'startOnLogin', on: true });
    await page.next(isState);
    expect(b.cfg.startOnLogin).toBe(false);
  });

  it('rotates the pairing code, and keeps only valid web app origins', async () => {
    const code = b.server.pairingCode;
    page.send({ t: 'pair.rotate' });
    await until(() => b.server.pairingCode !== code);
    page.send({ t: 'origins', list: [' https://yurt.example.com/ ', 'https://a.example/path', 'ftp://x', 'http://localhost:3000'] });
    await until(() => b.cfg.allowedOrigins.length === 2);
    expect(b.cfg.allowedOrigins).toEqual(['https://yurt.example.com', 'http://localhost:3000']);
  });
});

describe('shutdown', () => {
  it('closes a server that never listened, or with a state update pending', async () => {
    const idle = await start({ listen: false });
    await idle.server.close();
    const busy = await start();
    busy.server.changed();
    busy.server.changed(); // coalesced into one pending update
    await busy.server.close();
  });
});

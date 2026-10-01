import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import WebSocket from 'ws';
import type { BridgeServer } from '../src/server';
import { tempDir } from './helpers';

// config.ts reads YURT_HOME on import, so everything is imported after pointing it at a temp folder.
const root = tempDir('yurt-server-');
const uiDir = path.join(root, 'ui');
let server: BridgeServer;
let port: number;

beforeAll(async () => {
  process.env.YURT_HOME = path.join(root, 'home');
  fs.mkdirSync(uiDir);
  fs.writeFileSync(path.join(uiDir, 'index.html'), '<html><head></head><body>bridge ui</body></html>');
  fs.mkdirSync(path.join(root, 'ui-secret'));
  fs.writeFileSync(path.join(root, 'ui-secret', 'secret.txt'), 'top secret');
  const [{ loadConfig }, { Workspaces }, { AgentHost }, { BridgeServer }] = await Promise.all([
    import('../src/config'),
    import('../src/workspaces'),
    import('../src/agents'),
    import('../src/server'),
  ]);
  const cfg = loadConfig();
  const ws = new Workspaces(cfg, () => {});
  const host = new AgentHost(
    cfg,
    () => null,
    () => {},
    () => {},
  );
  ws.host = host;
  server = new BridgeServer(0, cfg, ws, host, uiDir);
  await server.listen();
  port = server.boundPort;
});
afterAll(async () => {
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** Raw GET: fetch() would normalize or reject the hostile paths under test. */
const get = (p: string) =>
  new Promise<{ status: number; body: string }>((res, rej) => {
    http
      .get({ host: '127.0.0.1', port, path: p }, (r) => {
        let body = '';
        r.on('data', (d) => (body += d)).on('end', () => res({ status: r.statusCode ?? 0, body }));
      })
      .on('error', rej);
  });

describe('static UI server', () => {
  it('serves the UI', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.body).toContain('bridge ui');
  });

  it('answers a malformed escape with 400 instead of crashing', async () => {
    expect((await get('/%E0')).status).toBe(400);
    expect((await get('/')).status).toBe(200); // still up
  });

  it('refuses a sibling folder that shares the UI folder name as a prefix', async () => {
    const r = await get('/..%2fui-secret/secret.txt');
    expect(r.status).toBe(403);
    expect(r.body).not.toContain('top secret');
  });
});

type Reply = { t: string; msg?: string; token?: string };
async function connect() {
  const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
  const replies: Reply[] = [];
  const closed = new Promise<number>((res) => sock.on('close', (code) => res(code)));
  sock.on('message', (d) => replies.push(JSON.parse(String(d)) as Reply));
  await new Promise((res, rej) => {
    sock.once('open', res);
    sock.once('error', rej);
  });
  const pair = async (code: string) => {
    const n = replies.length;
    sock.send(JSON.stringify({ t: 'pair', code }));
    const end = Date.now() + 3000;
    while (replies.length === n && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    return replies[n];
  };
  return { sock, pair, closed };
}
const wrong = () => (server.pairingCode === '000000' ? '000001' : '000000');

describe('pairing limits', () => {
  it('pairs with the right code', async () => {
    const c = await connect();
    expect((await c.pair(server.pairingCode)).t).toBe('paired');
    c.sock.close();
  });

  it('closes a connection after 3 wrong codes', async () => {
    const c = await connect();
    for (let i = 0; i < 3; i++) expect((await c.pair(wrong())).msg).toBe('Wrong pairing code');
    expect(await c.closed).toBe(1008);
  });

  it('locks pairing for everyone after 10 wrong codes a minute, even for the right code', async () => {
    // 3 misses already spent above; 7 more across fresh connections reach the limit.
    for (let left = 7; left > 0; left -= 3) {
      const c = await connect();
      for (let i = 0; i < Math.min(3, left); i++) await c.pair(wrong());
      c.sock.close();
    }
    const c = await connect();
    const r = await c.pair(server.pairingCode);
    expect(r.t).toBe('error');
    expect(r.msg).toMatch(/Too many wrong pairing codes\. Try again in \d+ s/);
    c.sock.close();
  });
});

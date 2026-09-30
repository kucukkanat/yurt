import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import { slug, keyFromPhrase, isValidPhrase, TOOL_KINDS, type BridgeState, type ToBridge, type FromBridge, type AgentConfig } from '@yurt/protocol';
import { saveConfig, saveIdentity, loadIdentity, type Config } from './config';
import type { Workspaces } from './workspaces';
import type { AgentHost } from './agents';
import { RUNTIMES, RUNTIME_IDS, runtimeStatus, install, check, login, onRuntimeChange } from './runtimes';
import { setStartOnLogin } from './autostart';
import { log, onLog, recentLogs } from './log';

export const VERSION = '0.1.0';

interface Client { sock: WebSocket; paired: boolean; admin: boolean }

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.map': 'application/json' };

export class BridgeServer {
  private clients = new Set<Client>();
  private code = '';
  private codeAt = 0;
  private misses = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private port: number, private cfg: Config, private ws: Workspaces, private host: AgentHost, private uiDir: string) {
    this.rotate();
    setInterval(() => Date.now() - this.codeAt > 10 * 60_000 && this.rotate(), 30_000);
    onRuntimeChange(() => this.changed());
    onLog((e) => this.send((c) => c.admin, e));
  }

  get pairingCode() { return this.code; }
  get origin() { return `http://127.0.0.1:${this.port}`; }

  rotate() {
    this.code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    this.codeAt = Date.now();
    this.misses = 0;
    this.changed();
  }

  changed() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const c of this.clients) if (c.paired) this.sendTo(c, { t: 'state', state: this.state(c.admin) });
    }, 50);
  }

  private state(admin: boolean): BridgeState {
    const id = loadIdentity();
    return {
      version: VERSION,
      identity: id ? { pub: keyFromPhrase(id.phrase).pub, name: id.name, handle: id.handle } : null,
      agents: this.cfg.agents.map((a) => ({ ...a, status: this.host.status.get(a.id) || 'idle' })),
      workspaces: this.cfg.workspaces.map((w) => ({ code: w.code, name: w.name, agents: w.agents, peers: this.ws.peerCount(w.code) })),
      runtimes: runtimeStatus(),
      startOnLogin: this.cfg.startOnLogin,
      allowedOrigins: this.cfg.allowedOrigins,
      pairingCode: admin ? this.code : undefined,
      home: admin ? os.homedir() : undefined,
    };
  }

  private sendTo(c: Client, m: FromBridge) { if (c.sock.readyState === 1) c.sock.send(JSON.stringify(m)); }
  private send(pred: (c: Client) => boolean, m: FromBridge) { for (const c of this.clients) if (pred(c)) this.sendTo(c, m); }

  private okHost(h?: string) { return h === `127.0.0.1:${this.port}` || h === `localhost:${this.port}`; }

  listen() {
    const server = http.createServer((req, res) => this.http(req, res));
    const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
    server.on('upgrade', (req, sock, head) => {
      const origin = req.headers.origin || '';
      const allowed = origin === this.origin || origin === `http://localhost:${this.port}` || this.cfg.allowedOrigins.includes(origin);
      if (!req.url?.startsWith('/ws') || !this.okHost(req.headers.host) || !allowed) {
        log('warn', 'bridge', 'refused connection from origin ' + (origin || '(none)'));
        sock.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        sock.destroy();
        return;
      }
      wss.handleUpgrade(req, sock, head, (s) => this.accept(s));
    });
    return new Promise<void>((res, rej) => {
      server.once('error', rej);
      server.listen(this.port, '127.0.0.1', () => res());
    });
  }

  private http(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.okHost(req.headers.host)) { res.writeHead(403).end(); return; }
    const url = new URL(req.url || '/', this.origin);
    let file = path.normalize(path.join(this.uiDir, decodeURIComponent(url.pathname)));
    if (!file.startsWith(this.uiDir)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(this.uiDir, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(500, { 'content-type': 'text/plain' }).end('Bridge UI is missing. Run: npm run build -w packages/bridge'); return; }
    const ext = path.extname(file);
    const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'x-frame-options': 'DENY', 'cache-control': ext === '.html' ? 'no-store' : 'max-age=3600' };
    if (ext === '.html') {
      // Same-origin only: other sites can't read this response, so the admin token stays local.
      const html = fs.readFileSync(file, 'utf8').replace('</head>', `<script>window.__YURT_ADMIN__=${JSON.stringify(this.cfg.adminToken)}</script></head>`);
      res.writeHead(200, headers).end(html);
    } else {
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    }
  }

  private accept(sock: WebSocket) {
    const c: Client = { sock, paired: false, admin: false };
    this.clients.add(c);
    sock.on('close', () => this.clients.delete(c));
    sock.on('message', (raw) => {
      let m: ToBridge;
      try { m = JSON.parse(String(raw)); } catch { return; }
      try { this.handle(c, m); } catch (e) { this.sendTo(c, { t: 'error', msg: (e as Error).message }); }
    });
  }

  private handle(c: Client, m: ToBridge) {
    if (m.t === 'hello') {
      c.admin = !!m.token && m.token === this.cfg.adminToken;
      c.paired = c.admin || (!!m.token && this.cfg.tokens.includes(m.token));
      this.sendTo(c, { t: 'hello', ok: true, paired: c.paired, admin: c.admin, version: VERSION });
      if (c.paired) this.sendTo(c, { t: 'state', state: this.state(c.admin) });
      if (c.admin) for (const e of recentLogs()) this.sendTo(c, e);
      return;
    }
    if (m.t === 'pair') {
      if (m.code === this.code) {
        const token = crypto.randomBytes(24).toString('hex');
        this.cfg.tokens = [...this.cfg.tokens.slice(-9), token];
        saveConfig(this.cfg);
        c.paired = true;
        this.sendTo(c, { t: 'paired', token });
        this.sendTo(c, { t: 'state', state: this.state(c.admin) });
        log('info', 'bridge', 'paired a browser');
        this.rotate();
      } else {
        this.sendTo(c, { t: 'error', msg: 'Wrong pairing code' });
        if (++this.misses >= 5) this.rotate();
      }
      return;
    }
    if (!c.paired) return this.sendTo(c, { t: 'error', msg: 'Not paired' });
    switch (m.t) {
      case 'identity': {
        if (!isValidPhrase(m.phrase)) throw new Error('Invalid identity');
        const cur = loadIdentity();
        if (!cur || cur.phrase !== m.phrase || cur.name !== m.name || cur.handle !== m.handle) {
          saveIdentity({ phrase: m.phrase, name: m.name, handle: m.handle });
          if (cur && cur.phrase !== m.phrase) log('warn', 'bridge', 'identity replaced by a paired browser');
        }
        this.ws.setIdentity(m.phrase);
        break;
      }
      case 'ws.join': this.ws.join(m.code, m.name, m.creator, m.agents); break;
      case 'ws.agents': this.ws.join(m.code, this.cfg.workspaces.find((w) => w.code === m.code)?.name || m.code, null, m.agents); break;
      case 'ws.leave': this.ws.leave(m.code); break;
      default:
        if (!c.admin) throw new Error('Only the bridge page can change this');
        this.admin(m);
    }
    this.changed();
  }

  private admin(m: ToBridge) {
    switch (m.t) {
      case 'agent.save': {
        const a = sanitize(m.agent);
        if (this.cfg.agents.some((x) => x.id !== a.id && x.handle === a.handle)) throw new Error('Another agent already uses @' + a.handle);
        fs.mkdirSync(a.workdir, { recursive: true });
        const i = this.cfg.agents.findIndex((x) => x.id === a.id);
        const prev = this.cfg.agents[i];
        if (i >= 0) this.cfg.agents[i] = a; else this.cfg.agents.push(a);
        if (prev && (prev.runtime !== a.runtime || prev.workdir !== a.workdir || prev.model !== a.model)) this.host.drop(a.id);
        saveConfig(this.cfg);
        this.ws.refreshAll();
        log('info', 'bridge', 'saved agent ' + a.name);
        break;
      }
      case 'agent.remove':
        this.cfg.agents = this.cfg.agents.filter((a) => a.id !== m.id);
        for (const w of this.cfg.workspaces) w.agents = w.agents.filter((x) => x !== m.id);
        this.host.drop(m.id);
        saveConfig(this.cfg);
        this.ws.refreshAll();
        break;
      case 'runtime.install': install(m.id); break;
      case 'runtime.check': check(m.id); break;
      case 'runtime.login': login(m.id); break;
      case 'startOnLogin':
        if (setStartOnLogin(m.on)) { this.cfg.startOnLogin = m.on; saveConfig(this.cfg); }
        break;
      case 'pair.rotate': this.rotate(); break;
      case 'origins':
        this.cfg.allowedOrigins = m.list.map((o) => o.trim().replace(/\/+$/, '')).filter((o) => /^https?:\/\/[^/]+$/.test(o));
        saveConfig(this.cfg);
        break;
    }
  }
}

function sanitize(a: AgentConfig): AgentConfig {
  if (!RUNTIME_IDS.includes(a.runtime)) throw new Error('Unknown runtime');
  const name = String(a.name || '').trim().slice(0, 40);
  if (!name) throw new Error('Give the agent a name');
  const handle = slug(a.handle || name).slice(0, 24);
  if (!handle) throw new Error('Give the agent a handle');
  if (!a.workdir || !path.isAbsolute(a.workdir)) throw new Error('Pick a folder with a full path');
  return {
    id: a.id || handle + '-' + crypto.randomBytes(2).toString('hex'),
    name, handle, runtime: a.runtime,
    model: a.model?.trim() || undefined,
    workdir: path.resolve(a.workdir),
    instructions: String(a.instructions || '').slice(0, 8000),
    autoApprove: (a.autoApprove || []).filter((k) => TOOL_KINDS.includes(k)),
    contextSize: Math.max(1, Math.min(200, Math.round(Number(a.contextSize) || 20))),
    replyIn: a.replyIn === 'channel' ? 'channel' : 'thread',
  };
}

export { RUNTIMES };

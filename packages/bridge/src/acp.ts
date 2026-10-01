import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import * as v from 'valibot';
import { parseOr } from '@yurt/protocol';
import { log } from './log';
import { VERSION } from './version';
import { InitializeResultSchema, RpcErrorSchema, RpcMessageSchema, SessionUpdateSchema, type AcpUpdate, type RpcMessage } from './schemas';

export type { AcpUpdate } from './schemas';

/** Minimal Agent Client Protocol client: JSON-RPC 2.0, newline-delimited, over the agent's stdio. */
class AcpError extends Error {
  constructor(
    msg: string,
    public code?: number,
  ) {
    super(msg);
  }
}

interface Pending {
  res: (v: unknown) => void;
  rej: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class AcpConnection {
  private proc: ChildProcessByStdio<Writable, Readable, Readable>;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buf = '';
  closed = false;
  onUpdate?: (sessionId: string, u: AcpUpdate) => void;
  onPermission?: (params: unknown) => Promise<unknown>;
  onExit?: () => void;

  constructor(
    public label: string,
    cmd: string,
    args: string[],
    cwd: string,
  ) {
    this.proc = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env } });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d: string) => this.onData(d));
    // Writing to an agent that just died raises EPIPE on stdin; unhandled, that would crash the bridge.
    this.proc.stdin.on('error', (e) => log('warn', label, 'stdin: ' + e.message));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d: string) => log('acp', label, 'stderr: ' + d.trim()));
    this.proc.on('error', (e) => {
      log('error', label, 'spawn failed: ' + e.message);
      this.fail(e);
    });
    this.proc.on('exit', (code) => {
      log('info', label, 'agent process exited (' + code + ')');
      this.fail(new Error('Agent process exited'));
    });
  }

  private fail(e: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.rej(e);
    }
    this.pending.clear();
    this.onExit?.();
  }

  private write(msg: object) {
    if (this.closed) return; // e.g. an approval answered after the agent died
    const s = JSON.stringify({ jsonrpc: '2.0', ...msg });
    log('acp', this.label, '→ ' + s);
    this.proc.stdin.write(s + '\n');
  }

  private onData(d: string) {
    this.buf += d;
    for (let i = this.buf.indexOf('\n'); i >= 0; i = this.buf.indexOf('\n')) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      log('acp', this.label, '← ' + line);
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue; // not JSON-RPC (agents sometimes print banners); the line is logged above
      }
      const m = parseOr(RpcMessageSchema, raw);
      if (m) void this.handle(m);
    }
  }

  private async handle(m: RpcMessage) {
    if (m.id != null && m.method === undefined) return this.settle(m.id, m);
    if (m.method === 'session/update') {
      const u = parseOr(SessionUpdateSchema, m.params);
      if (u) this.onUpdate?.(u.sessionId, u.update);
      return;
    }
    // A notification we don't handle needs no answer.
    if (m.id == null) return;
    try {
      if (m.method === 'session/request_permission' && this.onPermission) this.write({ id: m.id, result: await this.onPermission(m.params) });
      else this.write({ id: m.id, error: { code: -32601, message: 'Yurt bridge does not provide ' + m.method } });
    } catch (e) {
      this.write({ id: m.id, error: { code: -32603, message: (e instanceof Error && e.message) || 'failed' } });
    }
  }

  /** A response to one of our requests (ids we send are numbers; anything else isn't ours). */
  private settle(id: number | string, m: RpcMessage) {
    const p = typeof id === 'number' ? this.pending.get(id) : undefined;
    if (!p || typeof id !== 'number') return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (m.error == null) return p.res(m.result);
    const err = v.parse(RpcErrorSchema, m.error);
    p.rej(new AcpError(err.message || 'ACP error', err.code));
  }

  /** Sends a request; callers parse the parts of the result they rely on. */
  request(method: string, params: unknown, timeoutMs = 0): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Agent is not running'));
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const p: Pending = { res, rej };
      if (timeoutMs)
        p.timer = setTimeout(() => {
          this.pending.delete(id);
          rej(new Error(method + ' timed out'));
        }, timeoutMs);
      this.pending.set(id, p);
      this.write({ id, method, params });
    });
  }

  async initialize() {
    const r = await this.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'yurt-bridge', version: VERSION },
      },
      60_000,
    );
    return v.parse(InitializeResultSchema, r);
  }

  /** Stops the agent and rejects in-flight requests: the exit event arrives after `closed` is set, so it can't. */
  close() {
    this.fail(new Error('Agent was stopped'));
    this.proc.kill();
  }
}

export const isAuthError = (e: unknown) => (e instanceof AcpError && e.code === -32000) || (e instanceof Error && /auth|login|sign.?in|credential|api key/i.test(e.message));

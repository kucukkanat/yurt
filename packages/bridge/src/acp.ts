import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { log } from './log';
import { VERSION } from './version';

/** Minimal Agent Client Protocol client: JSON-RPC 2.0, newline-delimited, over the agent's stdio. */
export interface AcpUpdate {
  sessionUpdate: string;
  content?: { type: string; text?: string };
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  entries?: { content: string; status: string }[];
}

/** A JSON-RPC message from the agent, checked only as far as routing needs; fields stay untrusted. */
interface RpcMessage {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
const isRpcId = (x: unknown): x is number | string => typeof x === 'number' || typeof x === 'string';

/** A `session/update` notification's payload, or null when it isn't one. */
function parseUpdate(params: unknown): { sessionId: string; update: AcpUpdate } | null {
  if (!isRecord(params) || !isRecord(params.update)) return null;
  const u = params.update;
  const sessionUpdate = str(u.sessionUpdate);
  if (!sessionUpdate) return null;
  const content = isRecord(u.content) ? { type: str(u.content.type) ?? '', text: str(u.content.text) } : undefined;
  return {
    sessionId: str(params.sessionId) ?? '',
    update: { sessionUpdate, content, toolCallId: str(u.toolCallId), title: str(u.title), kind: str(u.kind), status: str(u.status) },
  };
}

class AcpError extends Error {
  constructor(
    msg: string,
    public code?: number,
    public data?: unknown,
  ) {
    super(msg);
  }
}

export class AcpConnection {
  private proc: ChildProcessByStdio<Writable, Readable, Readable>;
  private nextId = 1;
  private pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
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
    for (const p of this.pending.values()) p.rej(e);
    this.pending.clear();
    this.onExit?.();
  }

  private write(msg: object) {
    if (this.closed) return;
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
      let m: unknown;
      try {
        m = JSON.parse(line);
      } catch {
        continue; // not JSON-RPC (agents sometimes print banners); the line is logged above
      }
      if (isRecord(m)) this.handle(m);
    }
  }

  private async handle(m: RpcMessage) {
    if (m.id != null && !m.method) return this.settle(m);
    if (m.method === 'session/update') {
      const u = parseUpdate(m.params);
      if (u) this.onUpdate?.(u.sessionId, u.update);
      return;
    }
    if (!isRpcId(m.id)) return;
    try {
      if (m.method === 'session/request_permission' && this.onPermission) this.write({ id: m.id, result: await this.onPermission(m.params) });
      else this.write({ id: m.id, error: { code: -32601, message: 'Yurt bridge does not provide ' + String(m.method) } });
    } catch (e) {
      this.write({ id: m.id, error: { code: -32603, message: (e instanceof Error && e.message) || 'failed' } });
    }
  }

  /** A response to one of our requests. */
  private settle(m: RpcMessage) {
    const p = typeof m.id === 'number' ? this.pending.get(m.id) : undefined;
    if (!p || typeof m.id !== 'number') return;
    this.pending.delete(m.id);
    if (m.error == null) return p.res(m.result);
    const err = isRecord(m.error) ? m.error : {};
    p.rej(new AcpError(str(err.message) || 'ACP error', typeof err.code === 'number' ? err.code : undefined, err.data));
  }

  /** Sends a request. `T` is the result shape the ACP spec promises for `method`; agents are trusted that far. */
  request<T = unknown>(method: string, params: unknown, timeoutMs = 0): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Agent is not running'));
    const id = this.nextId++;
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { res: (v) => res(v as T), rej });
      this.write({ id, method, params });
      if (timeoutMs)
        setTimeout(() => {
          if (this.pending.delete(id)) rej(new Error(method + ' timed out'));
        }, timeoutMs);
    });
  }

  notify(method: string, params: unknown) {
    if (!this.closed) this.write({ method, params });
  }

  async initialize() {
    return this.request<{ protocolVersion: number; agentCapabilities?: unknown; authMethods?: { id: string; name: string; description?: string }[] }>(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'yurt-bridge', version: VERSION },
      },
      60_000,
    );
  }

  /** Stops the agent and rejects in-flight requests: the exit event arrives after `closed` is set, so it can't. */
  close() {
    this.fail(new Error('Agent was stopped'));
    try {
      this.proc.kill();
    } catch {
      /* gone */
    }
  }
}

export const isAuthError = (e: unknown) => (e instanceof AcpError && e.code === -32000) || (e instanceof Error && /auth|login|sign.?in|credential|api key/i.test(e.message));

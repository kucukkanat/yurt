import { spawn, type ChildProcess } from 'node:child_process';
import { log } from './log';

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

export class AcpError extends Error {
  constructor(msg: string, public code?: number, public data?: unknown) { super(msg); }
}

export class AcpConnection {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  private buf = '';
  closed = false;
  onUpdate?: (sessionId: string, u: AcpUpdate) => void;
  onPermission?: (params: any) => Promise<any>;
  onExit?: () => void;

  constructor(public label: string, cmd: string, args: string[], cwd: string) {
    this.proc = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env } });
    this.proc.stdout!.setEncoding('utf8');
    this.proc.stdout!.on('data', (d: string) => this.onData(d));
    this.proc.stderr!.setEncoding('utf8');
    this.proc.stderr!.on('data', (d: string) => log('acp', label, 'stderr: ' + d.trim()));
    this.proc.on('error', (e) => { log('error', label, 'spawn failed: ' + e.message); this.fail(e); });
    this.proc.on('exit', (code) => { log('info', label, 'agent process exited (' + code + ')'); this.fail(new Error('Agent process exited')); });
  }

  private fail(e: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.rej(e);
    this.pending.clear();
    this.onExit?.();
  }

  private write(msg: object) {
    const s = JSON.stringify({ jsonrpc: '2.0', ...msg });
    log('acp', this.label, '→ ' + s);
    this.proc.stdin!.write(s + '\n');
  }

  private onData(d: string) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      log('acp', this.label, '← ' + line);
      let m: any;
      try { m = JSON.parse(line); } catch { continue; }
      this.handle(m);
    }
  }

  private async handle(m: any) {
    if (m.id != null && !m.method) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.error ? p.rej(new AcpError(m.error.message || 'ACP error', m.error.code, m.error.data)) : p.res(m.result);
      return;
    }
    if (m.method === 'session/update') { this.onUpdate?.(m.params?.sessionId, m.params?.update || {}); return; }
    if (m.id == null) return;
    try {
      if (m.method === 'session/request_permission' && this.onPermission) this.write({ id: m.id, result: await this.onPermission(m.params) });
      else this.write({ id: m.id, error: { code: -32601, message: 'Yurt bridge does not provide ' + m.method } });
    } catch (e: any) {
      this.write({ id: m.id, error: { code: -32603, message: e?.message || 'failed' } });
    }
  }

  request<T = any>(method: string, params: unknown, timeoutMs = 0): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Agent is not running'));
    const id = this.nextId++;
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { res, rej });
      this.write({ id, method, params });
      if (timeoutMs) setTimeout(() => { if (this.pending.delete(id)) rej(new Error(method + ' timed out')); }, timeoutMs);
    });
  }

  notify(method: string, params: unknown) { if (!this.closed) this.write({ method, params }); }

  async initialize() {
    return this.request<{ protocolVersion: number; agentCapabilities?: any; authMethods?: { id: string; name: string; description?: string }[] }>('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'yurt-bridge', version: '0.1.0' },
    }, 60_000);
  }

  close() { this.closed = true; try { this.proc.kill(); } catch { /* gone */ } }
}

export const isAuthError = (e: unknown) => {
  const err = e as AcpError;
  return err?.code === -32000 || /auth|login|sign.?in|credential|api key/i.test(err?.message || '');
};

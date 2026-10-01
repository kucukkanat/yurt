import { BRIDGE_URL, type BridgeState, type FromBridge, type ToBridge } from '@yurt/protocol';
import { kv } from './db';

export type BridgeStatus = 'off' | 'missing' | 'connecting' | 'unpaired' | 'connected';

type Listener = (status: BridgeStatus, state: BridgeState | null) => void;

/**
 * Talks to the local yurt-bridge. It only dials 127.0.0.1 once the user has asked for agents
 * (or has paired before), so visitors never see a local-network permission prompt out of nowhere.
 */
class BridgeClient {
  status: BridgeStatus = 'off';
  state: BridgeState | null = null;
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private retry = 2000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private waiters: ((m: FromBridge) => void)[] = [];
  private identity: { phrase: string; name: string; handle: string } | null = null;

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private set(s: BridgeStatus) {
    this.status = s;
    for (const l of this.listeners) l(this.status, this.state);
  }

  async autoStart(identity: { phrase: string; name: string; handle: string }) {
    this.identity = identity;
    this.token = (await kv.get<string>('bridgeToken')) || null;
    if (this.token) this.start();
  }

  setIdentity(identity: { phrase: string; name: string; handle: string }) {
    this.identity = identity;
    if (this.status === 'connected') this.send({ t: 'identity', ...identity });
  }

  start() {
    if (this.ws || this.timer) return;
    this.set(this.status === 'off' ? 'connecting' : this.status);
    let ws: WebSocket;
    try {
      ws = new WebSocket(BRIDGE_URL);
    } catch {
      return this.later();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 2000;
      this.send({ t: 'hello', token: this.token || undefined });
    };
    ws.onmessage = (e) => {
      try {
        this.onMsg(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.state = null;
      this.set('missing');
      this.later();
    };
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Detach first: a close event from this socket would otherwise schedule a redial.
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = null;
      ws.close();
    }
    this.state = null;
    this.set('off');
  }

  private later() {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.start();
    }, this.retry);
    this.retry = Math.min(this.retry * 1.6, 30000);
  }

  private onMsg(m: FromBridge) {
    for (const w of [...this.waiters]) w(m);
    if (m.t === 'hello') {
      if (m.paired) {
        this.set('connected');
        if (this.identity) this.send({ t: 'identity', ...this.identity });
      } else this.set('unpaired');
    } else if (m.t === 'paired') {
      this.token = m.token;
      kv.set('bridgeToken', m.token);
      this.set('connected');
      if (this.identity) this.send({ t: 'identity', ...this.identity });
    } else if (m.t === 'state') {
      this.state = m.state;
      this.set(this.status === 'unpaired' ? 'unpaired' : 'connected');
    }
  }

  send(m: ToBridge) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  pair(code: string): Promise<boolean> {
    return new Promise((res) => {
      // Every exit removes the waiter, so timed-out pairings don't pile up.
      const done = (ok: boolean) => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((x) => x !== w);
        res(ok);
      };
      const w = (m: FromBridge) => {
        if (m.t === 'paired' || m.t === 'error') done(m.t === 'paired');
      };
      const timer = setTimeout(() => done(false), 8000);
      this.waiters.push(w);
      this.send({ t: 'pair', code });
    });
  }

  async forget() {
    await kv.del('bridgeToken');
    this.token = null;
    this.stop();
  }
}

export const bridge = new BridgeClient();

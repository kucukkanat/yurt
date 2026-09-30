import fs from 'node:fs';
import path from 'node:path';
import { joinRoom, selfId } from 'trystero';
import { RTCPeerConnection } from 'werift';
import { WorkspacePeer, agentKey, keyFromPhrase, LEGACY_TRYSTERO, type WsTransport, type Ev, type PeerStore, type JoinRoom, type KeyPair, type AgentBody } from '@yurt/protocol';
import { WS_DIR, BLOB_DIR, saveConfig, type Config } from './config';
import type { AgentHost } from './agents';
import { log } from './log';

const safe = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');

const fileStore: PeerStore = {
  async load(ws) {
    try {
      return fs.readFileSync(path.join(WS_DIR, safe(ws) + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ev);
    } catch { return []; }
  },
  async save(evs) {
    fs.appendFileSync(path.join(WS_DIR, safe(evs[0]?.ws || 'x') + '.jsonl'), evs.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
  },
  async getBlob(id) {
    try { const b = fs.readFileSync(path.join(BLOB_DIR, safe(id))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; } catch { return null; }
  },
  async putBlob(id, buf) { fs.writeFileSync(path.join(BLOB_DIR, safe(id)), Buffer.from(buf)); },
  async loadMark(ws) {
    try { return Number(fs.readFileSync(path.join(WS_DIR, safe(ws) + '.mark'), 'utf8')) || 0; } catch { return 0; }
  },
  async saveMark(ws, sec) { fs.writeFileSync(path.join(WS_DIR, safe(ws) + '.mark'), String(sec), { mode: 0o600 }); },
};

/** Headless peers: the bridge joins each workspace with the owner's key so agents answer with the browser closed. */
export class Workspaces {
  peers = new Map<string, WorkspacePeer>();
  private kp: KeyPair | null = null;
  /** Leaves wait a moment so the "agents removed" announcement goes out; a rejoin cancels them. */
  private stopping = new Map<string, ReturnType<typeof setTimeout>>();
  host!: AgentHost;

  constructor(private cfg: Config, private changed: () => void) {}

  setIdentity(phrase: string | null) {
    const next = phrase ? keyFromPhrase(phrase) : null;
    if (next?.pub === this.kp?.pub) return;
    for (const code of [...this.peers.keys()]) this.stop(code);
    this.kp = next;
    this.cfg.workspaces.forEach((w) => this.start(w.code));
  }

  get me() { return this.kp?.pub || null; }

  private start(code: string) {
    const w = this.cfg.workspaces.find((x) => x.code === code);
    if (!this.kp || !w || this.peers.has(code)) return;
    const p = new WorkspacePeer({
      code, kp: this.kp, selfId, creator: w.creator, isBridge: true, transport: w.transport ?? LEGACY_TRYSTERO,
      // Relay workspaces are Nostr-only for the bridge: files come from Blossom, and it never joins calls.
      joinRoom: (w.transport ?? LEGACY_TRYSTERO).kind === 'trystero' ? (joinRoom as unknown as JoinRoom) : undefined,
      store: fileStore,
      // No third-party TURN: it would see who the bridge connects to. The browser is usually on the same machine.
      rtc: { rtcPolyfill: RTCPeerConnection },
      onState: (s, fresh) => {
        if (s.name && w.name !== s.name) { w.name = s.name; saveConfig(this.cfg); this.changed(); }
        this.announce(code);
        this.host.onEvents(p, fresh);
      },
      onPeers: () => this.changed(),
      onCreator: (pub) => { w.creator = pub; saveConfig(this.cfg); },
      onJoinError: (d) => log('warn', 'p2p', 'join error in ' + code + ': ' + JSON.stringify(d).slice(0, 300)),
      onError: (msg) => log('error', 'relay', code + ': ' + msg),
    });
    this.peers.set(code, p);
    p.start().then(
      () => { this.presence(code); log('info', 'p2p', 'joined workspace ' + code); },
      (e: unknown) => log('error', 'p2p', `couldn't start workspace ${code}: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  private stop(code: string) {
    clearTimeout(this.stopping.get(code));
    this.stopping.delete(code);
    this.peers.get(code)?.leave();
    this.peers.delete(code);
  }

  /** Publish an `agent` event whenever what the room knows about one of my agents differs from local config. */
  announce(code: string) {
    const p = this.peers.get(code);
    const w = this.cfg.workspaces.find((x) => x.code === code);
    if (!p || !w || !this.kp) return;
    const me = this.kp.pub;
    for (const a of this.cfg.agents) {
      const want: AgentBody = { id: a.id, name: a.name, handle: a.handle, runtime: a.runtime, model: a.model, replyIn: a.replyIn, removed: w.agents.includes(a.id) ? undefined : true };
      const have = p.state.agents.get(agentKey(me, a.id));
      if (!have && want.removed) continue;
      const same = have && have.name === want.name && have.handle === want.handle && have.runtime === want.runtime && (have.model || undefined) === want.model && have.replyIn === want.replyIn && !!have.removed === !!want.removed;
      if (!same) p.publish({ t: 'agent', b: want });
    }
    for (const have of p.state.agents.values()) {
      if (have.owner === me && !have.removed && !this.cfg.agents.some((a) => a.id === have.id)) p.publish({ t: 'agent', b: { ...have, owner: undefined, ts: undefined, removed: true } });
    }
  }

  presence(code: string) {
    const p = this.peers.get(code);
    const w = this.cfg.workspaces.find((x) => x.code === code);
    if (!p || !w) return;
    p.setPresence({ st: 'online', bridge: true, agents: Object.fromEntries(w.agents.map((id) => [id, { working: this.host.workingIn(id, code) }])) });
  }

  join(code: string, name: string, creator: string | null | undefined, agents: string[], transport?: WsTransport) {
    clearTimeout(this.stopping.get(code));
    this.stopping.delete(code);
    let w = this.cfg.workspaces.find((x) => x.code === code);
    if (!w) { w = { code, name, creator: creator || null, agents: [], transport }; this.cfg.workspaces.push(w); }
    // Kind and key are fixed once known (only filled in for workspaces joined before transports existed);
    // a relay workspace's relay list may be edited, which needs a fresh peer on the new relays.
    const cur = w.transport;
    const relaysEdited = transport?.kind === 'nostr' && cur?.kind === 'nostr' && transport.key === cur.key && transport.relays.join() !== cur.relays.join();
    if (transport && (!cur || relaysEdited)) w.transport = transport;
    w.agents = agents.filter((id) => this.cfg.agents.some((a) => a.id === id));
    if (creator && !w.creator) w.creator = creator;
    saveConfig(this.cfg);
    if (relaysEdited) this.stop(code); // immediate, and clears any pending delayed stop
    const running = this.peers.has(code);
    this.start(code);
    if (running) { this.announce(code); this.presence(code); } // a fresh peer announces after its log loads
    this.changed();
  }

  leave(code: string) {
    const w = this.cfg.workspaces.find((x) => x.code === code);
    if (w) { w.agents = []; this.announce(code); }
    clearTimeout(this.stopping.get(code));
    this.stopping.set(code, setTimeout(() => this.stop(code), 1500));
    this.cfg.workspaces = this.cfg.workspaces.filter((x) => x.code !== code);
    saveConfig(this.cfg);
    this.changed();
  }

  refreshAll() { for (const code of this.peers.keys()) { this.announce(code); this.presence(code); } }

  peerCount(code: string) { return this.peers.get(code)?.presence.size || 0; }
}

import fs from 'node:fs';
import path from 'node:path';
import { joinRoom, selfId } from 'trystero';
import { RTCPeerConnection } from 'werift';
import { WorkspacePeer, agentKey, keyFromPhrase, type Ev, type PeerStore, type JoinRoom, type KeyPair, type AgentBody } from '@yurt/protocol';
import { WS_DIR, BLOB_DIR, saveConfig, type Config } from './config';
import type { AgentHost } from './agents';
import { log } from './log';

const DEFAULT_TURN = [{
  urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'],
  username: 'openrelayproject', credential: 'openrelayproject',
}];

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
};

/** Headless peers: the bridge joins each workspace with the owner's key so agents answer with the browser closed. */
export class Workspaces {
  peers = new Map<string, WorkspacePeer>();
  private kp: KeyPair | null = null;
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
      code, kp: this.kp, selfId, creator: w.creator, isBridge: true,
      joinRoom: joinRoom as unknown as JoinRoom,
      store: fileStore,
      rtc: { rtcPolyfill: RTCPeerConnection, turnConfig: DEFAULT_TURN },
      onState: (s, fresh) => {
        if (s.name && w.name !== s.name) { w.name = s.name; saveConfig(this.cfg); this.changed(); }
        this.announce(code);
        this.host.onEvents(p, fresh);
      },
      onPeers: () => this.changed(),
      onCreator: (pub) => { w.creator = pub; saveConfig(this.cfg); },
      onJoinError: (d) => log('warn', 'p2p', 'join error in ' + code + ': ' + JSON.stringify(d).slice(0, 300)),
    });
    this.peers.set(code, p);
    p.start().then(() => { this.presence(code); log('info', 'p2p', 'joined workspace ' + code); });
  }

  private stop(code: string) { this.peers.get(code)?.leave(); this.peers.delete(code); }

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

  join(code: string, name: string, creator: string | null | undefined, agents: string[]) {
    let w = this.cfg.workspaces.find((x) => x.code === code);
    if (!w) { w = { code, name, creator: creator || null, agents: [] }; this.cfg.workspaces.push(w); }
    w.agents = agents.filter((id) => this.cfg.agents.some((a) => a.id === id));
    if (creator && !w.creator) w.creator = creator;
    saveConfig(this.cfg);
    const running = this.peers.has(code);
    this.start(code);
    if (running) { this.announce(code); this.presence(code); } // a fresh peer announces after its log loads
    this.changed();
  }

  leave(code: string) {
    const w = this.cfg.workspaces.find((x) => x.code === code);
    if (w) { w.agents = []; this.announce(code); }
    setTimeout(() => this.stop(code), 1500);
    this.cfg.workspaces = this.cfg.workspaces.filter((x) => x.code !== code);
    saveConfig(this.cfg);
    this.changed();
  }

  refreshAll() { for (const code of this.peers.keys()) { this.announce(code); this.presence(code); } }

  peerCount(code: string) { return this.peers.get(code)?.peers.size || 0; }
}

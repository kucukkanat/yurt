import fs from 'node:fs';
import path from 'node:path';
import { WorkspacePeer, agentKey, agentPrefs, keyFromPhrase, type WsTransport, type PeerStore, type KeyPair, type AgentBody } from '@yurt/protocol';
import { WS_DIR, BLOB_DIR, saveConfig, type Config } from './config';
import { parseStoredEvent } from './schemas';
import type { AgentHost } from './agents';
import { log } from './log';
import { errorMessage } from './util';
import { compact } from './compact';

const safe = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');

/** A workspace's events, marks and file blobs on disk, under the bridge's data folder. */
export const storeFor = (code: string): PeerStore => {
  const base = path.join(WS_DIR, safe(code));
  return {
    async load() {
      if (!fs.existsSync(base + '.jsonl')) return [];
      // Line by line: a torn last line (crash mid-append) or one bad entry must not cost the rest of the history.
      return fs
        .readFileSync(base + '.jsonl', 'utf8')
        .split('\n')
        .flatMap((l) => {
          const e = parseStoredEvent(l);
          return e ? [e] : [];
        });
    },
    async save(evs) {
      fs.appendFileSync(base + '.jsonl', evs.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
    },
    async getBlob(id) {
      const file = path.join(BLOB_DIR, safe(id));
      if (!fs.existsSync(file)) return null;
      const b = fs.readFileSync(file);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    async putBlob(id, buf) {
      fs.writeFileSync(path.join(BLOB_DIR, safe(id)), Buffer.from(buf));
    },
    async loadMark() {
      if (!fs.existsSync(base + '.mark')) return 0;
      return Number(fs.readFileSync(base + '.mark', 'utf8')) || 0;
    },
    async saveMark(_ws, sec) {
      fs.writeFileSync(base + '.mark', String(sec), { mode: 0o600 });
    },
  };
};

/** What an agent event says that members see; two equal ones need no new announcement. */
const announced = (b: AgentBody) => JSON.stringify([b.name, b.handle, b.runtime, b.model || null, b.replyIn, b.removed === true, agentPrefs(b)]);

/** Headless peers: the bridge joins each workspace with the owner's key so agents answer with the browser closed. */
export class Workspaces {
  peers = new Map<string, WorkspacePeer>();
  private kp: KeyPair | null = null;
  /** Leaves wait a moment so the "agents removed" announcement goes out; a rejoin cancels them. */
  private stopping = new Map<string, ReturnType<typeof setTimeout>>();
  host!: AgentHost;

  /** `devFileServers`: also fetch files from http:// Blossom servers (local test servers; never in the CLI). */
  constructor(
    private cfg: Config,
    private changed: () => void,
    private opts: { devFileServers?: boolean } = {},
  ) {}

  setIdentity(phrase: string | null) {
    const next = phrase ? keyFromPhrase(phrase) : null;
    if (next?.pub === this.kp?.pub) return;
    for (const code of [...this.peers.keys()]) this.stop(code);
    this.kp = next;
    for (const w of this.cfg.workspaces) this.start(w.code);
  }

  get me() {
    return this.kp?.pub || null;
  }

  private start(code: string) {
    const w = this.cfg.workspaces.find((x) => x.code === code);
    if (!this.kp || !w || this.peers.has(code)) return;
    const p = new WorkspacePeer({
      code,
      kp: this.kp,
      isBridge: true,
      devFileServers: this.opts.devFileServers,
      transport: w.transport,
      // The bridge is Nostr-only: files come from Blossom, and it never joins calls (no `calls`, so no WebRTC).
      // Absent (not undefined) unless known: the peer pins the creator.
      ...compact({ creator: w.creator }),
      store: storeFor(code),
      onState: (s, fresh) => {
        if (s.name && w.name !== s.name) {
          w.name = s.name;
          saveConfig(this.cfg);
          this.changed();
        }
        this.announce(code);
        this.host.onEvents(p, fresh);
      },
      onPeers: () => this.changed(),
      onCreator: (pub) => {
        w.creator = pub;
        saveConfig(this.cfg);
      },
      // A key rotation: keep the newest key, which opens every earlier one, so the config matches the app's.
      onKey: (key) => {
        w.transport = { ...w.transport, key };
        saveConfig(this.cfg);
      },
      onError: (msg) => log('error', 'relay', code + ': ' + msg),
    });
    this.peers.set(code, p);
    p.start().then(
      () => {
        this.presence(code);
        log('info', 'p2p', 'joined workspace ' + code);
      },
      (e: unknown) => log('error', 'p2p', `couldn't start workspace ${code}: ${errorMessage(e)}`),
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
      // replyIn stays for peers that predate respondTo/postIn (they drop agent events without it).
      const want: AgentBody = compact({
        id: a.id,
        name: a.name,
        handle: a.handle,
        runtime: a.runtime,
        model: a.model,
        replyIn: a.postIn.thread ? ('thread' as const) : ('channel' as const),
        respondTo: a.respondTo,
        postIn: a.postIn,
        discoverable: a.discoverable,
        removed: w.agents.includes(a.id) ? undefined : true,
      });
      const have = p.state.agents.get(agentKey(me, a.id));
      if (!have && want.removed) continue;
      if (!have || announced(have) !== announced(want)) p.publish({ t: 'agent', b: want });
    }
    for (const have of p.state.agents.values()) {
      if (have.owner === me && !have.removed && !this.cfg.agents.some((a) => a.id === have.id))
        p.publish({ t: 'agent', b: { ...have, owner: undefined, ts: undefined, removed: true } });
    }
  }

  presence(code: string) {
    const p = this.peers.get(code);
    const w = this.cfg.workspaces.find((x) => x.code === code);
    if (!p || !w) return;
    p.setPresence({
      st: 'online',
      bridge: true,
      agents: Object.fromEntries(
        w.agents
          .filter((id) => this.cfg.agents.some((a) => a.id === id && a.online))
          .map((id) => {
            const on = this.host.workingOn(id, code);
            return [id, { working: this.host.workingIn(id, code), ...(on ? { on } : {}) }];
          }),
      ),
    });
  }

  join(code: string, name: string, creator: string | null | undefined, agents: string[], transport: WsTransport) {
    clearTimeout(this.stopping.get(code));
    this.stopping.delete(code);
    let w = this.cfg.workspaces.find((x) => x.code === code);
    if (!w) {
      w = { code, name, creator: creator || null, agents: [], transport };
      this.cfg.workspaces.push(w);
    }
    // The key is fixed once known, but the app owns the relays: a list edited there needs a fresh peer on
    // the new relays, or the bridge waits where no member ever looks. (Key rotations reach the bridge by itself.)
    const cur = w.transport;
    const edited = transport.key === cur.key && JSON.stringify(transport.relays) !== JSON.stringify(cur.relays);
    if (edited) w.transport = transport;
    w.agents = agents.filter((id) => this.cfg.agents.some((a) => a.id === id));
    if (creator && !w.creator) w.creator = creator;
    saveConfig(this.cfg);
    if (edited) this.stop(code); // immediate, and clears any pending delayed stop
    const running = this.peers.has(code);
    this.start(code);
    if (running) {
      this.announce(code);
      this.presence(code);
    } // a fresh peer announces after its log loads
    this.changed();
  }

  leave(code: string) {
    const w = this.cfg.workspaces.find((x) => x.code === code);
    if (w) {
      w.agents = [];
      this.announce(code);
    }
    clearTimeout(this.stopping.get(code));
    this.stopping.set(
      code,
      setTimeout(() => this.stop(code), 1500),
    );
    this.cfg.workspaces = this.cfg.workspaces.filter((x) => x.code !== code);
    saveConfig(this.cfg);
    this.changed();
  }

  refreshAll() {
    for (const code of this.peers.keys()) {
      this.announce(code);
      this.presence(code);
    }
  }

  peerCount(code: string) {
    return this.peers.get(code)?.presence.size ?? 0;
  }
}

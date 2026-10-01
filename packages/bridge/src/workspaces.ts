import fs from 'node:fs';
import path from 'node:path';
import { joinRoom as joinNostr, selfId } from 'trystero';
import { joinRoom as joinTorrent } from '@trystero-p2p/torrent';
import { RTCPeerConnection } from 'werift';
import {
  WorkspacePeer,
  agentKey,
  agentPrefs,
  keyFromPhrase,
  LEGACY_TRYSTERO,
  isLegacy,
  signalingOf,
  type WsTransport,
  type PeerStore,
  type JoinRoom,
  type KeyPair,
  type AgentBody,
} from '@yurt/protocol';
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

/** The part of a transport members must share to meet: relays, or signaling (absent = Trystero's defaults). */
const networkOf = (t: WsTransport) => (t.kind === 'nostr' ? { relays: t.relays } : { signal: t.signal ?? null });

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
      selfId,
      isBridge: true,
      devFileServers: this.opts.devFileServers,
      transport: w.transport,
      // Relay workspaces are Nostr-only for the bridge: files come from Blossom, and it never joins calls.
      // Members only meet over the workspace's own signaling method, so pick the matching strategy.
      // Absent (not undefined) unless known: the peer pins the creator, and only Trystero workspaces get a room.
      ...compact({
        creator: w.creator,
        joinRoom: w.transport.kind === 'trystero' ? ((signalingOf(w.transport).kind === 'torrent' ? joinTorrent : joinNostr) as unknown as JoinRoom) : undefined,
      }),
      store: storeFor(code),
      // No third-party TURN: it would see who the bridge connects to. The browser is usually on the same machine.
      rtc: { rtcPolyfill: RTCPeerConnection },
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
      // A key rotation (relay workspaces): keep the newest key, which opens every earlier one, so the config matches the app's.
      onKey: (key) => {
        w.transport = { ...w.transport, key };
        saveConfig(this.cfg);
      },
      onJoinError: (d) => log('warn', 'p2p', 'join error in ' + code + ': ' + JSON.stringify(d).slice(0, 300)),
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
    p.setPresence({ st: 'online', bridge: true, agents: Object.fromEntries(w.agents.map((id) => [id, { working: this.host.workingIn(id, code) }])) });
  }

  /** `transport` absent: an older web app, whose workspaces are legacy Trystero ones. */
  join(code: string, name: string, creator: string | null | undefined, agents: string[], transport: WsTransport = LEGACY_TRYSTERO) {
    clearTimeout(this.stopping.get(code));
    this.stopping.delete(code);
    let w = this.cfg.workspaces.find((x) => x.code === code);
    if (!w) {
      w = { code, name, creator: creator || null, agents: [], transport };
      this.cfg.workspaces.push(w);
    }
    // Kind and key are fixed once known (only filled in for workspaces joined before transports existed),
    // but the app owns the rest: a relay list or signaling edited there needs a fresh peer on the new
    // servers, or the bridge waits where no member ever looks. (Key rotations reach the bridge by itself.)
    const cur = w.transport;
    const sameIdentity = transport.kind === cur.kind && transport.key === cur.key;
    const edited = sameIdentity && JSON.stringify(networkOf(transport)) !== JSON.stringify(networkOf(cur));
    if ((isLegacy(cur) && !isLegacy(transport)) || edited) w.transport = transport;
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

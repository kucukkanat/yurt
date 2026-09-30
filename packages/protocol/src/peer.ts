import type { Ev, FileRef, MsgBody } from './types';
import { makeEvent, verifyEvent, visibleTo, type EventFields } from './events';
import { reduce, type WsState } from './reduce';
import { APP_ID, roomIdFor } from './codes';
import { sign, verify, type KeyPair } from './crypto';
import { workspaceKeys } from './seal';
import { downloadFile } from './blossom';
import { LEGACY_TRYSTERO, type WsTransport } from './invite';
import type { DataLink, LinkHost, Presence } from './transport';
import { TrysteroData } from './transports/trystero';
import { NostrData } from './transports/nostr';

export type { Presence } from './transport';

/* Structural subset of the Trystero ≥0.25 room API, so this package doesn't depend on it. */
export interface TCtx { peerId: string; metadata?: any }
export interface TAction<T = any> {
  send(data: T, opts?: { target?: string | string[] | null; metadata?: any; onProgress?: (p: number, c: { peerId: string }) => void }): Promise<unknown>;
  onMessage: ((data: T, ctx: TCtx) => void) | null;
  onReceiveProgress?: ((p: number, ctx: TCtx) => void) | null;
}
export interface TRoom {
  makeAction<T = any>(name: string): TAction<T>;
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  onPeerStream: ((stream: MediaStream, peerId: string, metadata?: any) => void) | null;
  addStream(stream: MediaStream, opts?: { target?: string | string[] | null; metadata?: any }): unknown;
  removeStream(stream: MediaStream, opts?: { target?: string | string[] | null }): unknown;
  getPeers(): Record<string, RTCPeerConnection>;
  leave(): unknown;
}
export type JoinRoom = (config: any, roomId: string, callbacks?: any) => TRoom;

export interface HuddleState { ch: string | null; mic: boolean; cam: boolean; screen: boolean }

export interface PeerStore {
  load(ws: string): Promise<Ev[]>;
  save(evs: Ev[]): Promise<void>;
  getBlob?(id: string): Promise<ArrayBuffer | null>;
  putBlob?(id: string, buf: ArrayBuffer): Promise<void>;
  /** Unix seconds of the last completed relay backfill (Nostr only); lets a restart fetch just what's new. */
  loadMark?(ws: string): Promise<number>;
  saveMark?(ws: string, sec: number): Promise<void>;
}

export interface WorkspacePeerOpts {
  code: string;
  kp: KeyPair;
  selfId: string;
  /** How events travel. Defaults to Trystero. */
  transport?: WsTransport;
  /** WebRTC room for huddles and files. Required for Trystero, which also carries events over it. */
  joinRoom?: JoinRoom;
  store: PeerStore;
  creator?: string | null;
  rtc?: Record<string, unknown>;   // turnConfig / rtcConfig / rtcPolyfill / relayConfig
  isBridge?: boolean;
  /** Relay workspaces leave the WebRTC room after it's been unneeded this long. Default 60 s. */
  roomIdleMs?: number;
  onState?(s: WsState, fresh: Ev[]): void;
  onPeers?(): void;
  onCreator?(pub: string): void;
  onBlob?(id: string): void;
  onBlobProgress?(id: string, p: number): void;
  onJoinError?(d: unknown): void;
  onError?(msg: string): void;
}

const hsMsg = (code: string, from: string, to: string) => `yurt-hs:${code}:${from}>${to}`;
const FUTURE_SKEW_MS = 10 * 60 * 1000;
const NO_PRESENCE: ReadonlyMap<string, Presence> = new Map();
const ROOM_IDLE_MS = 60_000;
const FETCH_MS = 60_000;

async function sha256Buf(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
export { sha256Buf };

// Files only travel over WebRTC in Trystero workspaces; relay workspaces use Blossom.
type MediaActs = { hud: TAction<HuddleState>; fwant?: TAction<{ id: string }>; file?: TAction<ArrayBuffer> };

/**
 * One workspace. Holds the signed event log and derived state; a DataLink (Trystero or Nostr)
 * carries events and presence. Huddles and file transfer always run over a WebRTC room: always
 * joined for Trystero (it's also the event plane), joined on demand for Nostr so members don't
 * expose IPs or signaling metadata while nobody needs it.
 * Shared by the web app and the headless bridge.
 */
export class WorkspacePeer implements LinkHost {
  events = new Map<string, Ev>();
  state: WsState;
  /** Handshaked WebRTC peers (media plane; also the event plane for Trystero workspaces). */
  peers = new Map<string, { pub: string }>();
  huddles = new Map<string, HuddleState>();
  /** Published here but not yet delivered to any peer or relay. */
  queued = new Set<string>();
  room: TRoom | null = null;
  myPresence: Presence;
  myHuddle: HuddleState = { ch: null, mic: false, cam: false, screen: false };
  onHuddle?: (peerId: string, h: HuddleState | null) => void;
  onPeerJoined?: (peerId: string) => void;
  private data: DataLink | null = null;
  private act: MediaActs | null = null;
  private pendingPub = new Map<string, string>();
  private fetching = new Map<string, number>(); // Trystero: blob id → give up at (ms)
  private waiters = new Map<string, ((b: ArrayBuffer | null) => void)[]>();
  private downloads = new Map<string, Promise<ArrayBuffer | null>>(); // Nostr: in-flight Blossom fetches
  private idleSince = 0;
  private roomTimer: ReturnType<typeof setInterval> | null = null;
  private fresh: Ev[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(public o: WorkspacePeerOpts) {
    if ((o.transport ?? LEGACY_TRYSTERO).kind === 'trystero' && !o.joinRoom) throw new Error('Trystero workspaces need joinRoom');
    this.state = reduce(o.code, [], { creator: o.creator });
    this.myPresence = { pub: o.kp.pub, st: 'online', bridge: o.isBridge || undefined };
  }

  get me() { return this.o.kp.pub; }
  get kp() { return this.o.kp; }
  get code() { return this.o.code; }
  get transport(): WsTransport { return this.o.transport ?? LEGACY_TRYSTERO; }
  /** Online members, keyed by a link-specific id; each entry's `pub` is authenticated. */
  get presence(): ReadonlyMap<string, Presence> { return this.data?.presence ?? NO_PRESENCE; }
  /** Whether events can currently leave this device (a peer or relay is reachable). */
  get connected(): boolean { return this.data?.connected ?? false; }
  private get lazyRoom() { return this.transport.kind === 'nostr'; }
  /** Whether this peer may open WebRTC for voice and video. Relay workspaces only with the user's opt-in (joinRoom given). */
  get calls(): boolean { return !!this.o.joinRoom; }

  async start() {
    const evs = await this.o.store.load(this.o.code);
    for (const e of evs) this.events.set(e.id, e);
    this.recompute();
    const t = this.transport;
    if (t.kind === 'nostr') {
      const { code, store } = this.o;
      const mark = (await store.loadMark?.(code)) ?? 0;
      this.data = new NostrData(this, { key: t.key, relays: t.relays, mark, saveMark: (sec) => void store.saveMark?.(code, sec) });
      if (this.o.joinRoom) this.roomTimer = setInterval(() => this.syncRoom(), Math.min(5_000, this.o.roomIdleMs ?? 5_000));
    } else {
      const room = this.joinMedia();
      if (room) this.data = new TrysteroData(this, room);
    }
    this.data?.setPresence(this.myPresence);
    // Events published while the link was still starting (e.g. ws.create right after creation).
    const early = [...this.queued].flatMap((id) => this.events.get(id) ?? []);
    if (early.length) this.data?.send(early);
  }

  /** The WebRTC room, joining it now if needed (huddles call this). Null when this peer has no WebRTC. */
  ensureRoom(): TRoom | null { return this.room ?? this.joinMedia(); }

  private joinMedia(): TRoom | null {
    const { code, kp, selfId, joinRoom } = this.o;
    if (!joinRoom) return null;
    const t = this.transport;
    // Keyed workspaces derive every room credential from the 256-bit key; only legacy ones use the code.
    const k = t.key ? workspaceKeys(t.key) : null;
    const config = {
      appId: k?.app ?? APP_ID, password: k?.password ?? code, ...(this.o.rtc || {}),
      // Relay workspaces signal over their own relays, so no other relay learns anything about them.
      ...(t.kind === 'nostr' ? { relayConfig: { urls: [...t.relays] } } : {}),
    };
    const room = joinRoom(config, k?.room ?? roomIdFor(code), {
      onJoinError: (d: unknown) => this.o.onJoinError?.(d),
      onPeerHandshake: async (peerId: string, send: (d: any) => Promise<void>, receive: () => Promise<{ data: any }>) => {
        await send({ pub: kp.pub, sig: sign(kp.sec, hsMsg(code, selfId, peerId)) });
        const { data } = await receive();
        if (!data || typeof data.pub !== 'string' || !verify(data.pub, hsMsg(code, peerId, selfId), data.sig)) throw new Error('identity check failed');
        if (this.state.bans.has(data.pub)) throw new Error('banned');
        this.pendingPub.set(peerId, data.pub);
      },
    });
    this.room = room;
    const act: MediaActs = { hud: room.makeAction<HuddleState>('hud') };
    this.act = act;
    act.hud.onMessage = (h, { peerId }) => {
      if (!this.peers.has(peerId)) return;
      this.huddles.set(peerId, h);
      this.onHuddle?.(peerId, h);
      this.o.onPeers?.();
    };
    if (!this.lazyRoom) this.wireFiles(room, act);
    room.onPeerJoin = (peerId) => {
      const pub = this.pendingPub.get(peerId);
      if (!pub) return;
      this.pendingPub.delete(peerId);
      this.peers.set(peerId, { pub });
      if (this.myHuddle.ch) act.hud.send(this.myHuddle, { target: peerId });
      for (const id of this.fetching.keys()) if (this.canSeeFile(id, pub)) act.fwant?.send({ id }, { target: peerId });
      this.data?.onPeerJoin?.(peerId, pub);
      this.onPeerJoined?.(peerId);
      this.o.onPeers?.();
      this.emit();
    };
    room.onPeerLeave = (peerId) => {
      this.peers.delete(peerId);
      this.data?.onPeerLeave?.(peerId);
      if (this.huddles.has(peerId)) { this.huddles.delete(peerId); this.onHuddle?.(peerId, null); }
      this.o.onPeers?.();
    };
    return room;
  }

  private wireFiles(room: TRoom, act: MediaActs) {
    const fwant = (act.fwant = room.makeAction<{ id: string }>('fwant'));
    const file = (act.file = room.makeAction<ArrayBuffer>('file'));
    fwant.onMessage = async ({ id }, { peerId }) => {
      const who = this.peers.get(peerId);
      if (!who || typeof id !== 'string' || !this.canSeeFile(id, who.pub)) return;
      const b = await this.o.store.getBlob?.(id);
      if (b) file.send(b, { target: peerId, metadata: { id } });
    };
    file.onMessage = async (data: unknown, { metadata }) => {
      const id = metadata?.id;
      // Browsers deliver an ArrayBuffer; Node (the bridge, via werift) delivers a Uint8Array.
      const buf = data instanceof ArrayBuffer ? data : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer : null;
      if (!id || !buf || (await this.o.store.getBlob?.(id))) return;
      if ((await sha256Buf(buf)) !== id) return;
      await this.gotBlob(id, buf);
    };
    file.onReceiveProgress = (p, { metadata }) => metadata?.id && this.o.onBlobProgress?.(metadata.id, p);
  }

  private async gotBlob(id: string, buf: ArrayBuffer) {
    await this.o.store.putBlob?.(id, buf);
    this.fetching.delete(id);
    this.waiters.get(id)?.forEach((w) => w(buf));
    this.waiters.delete(id);
    this.o.onBlob?.(id);
  }

  private leaveMedia() {
    this.room?.leave();
    this.room = null;
    this.act = null;
    this.pendingPub.clear();
    for (const pid of this.peers.keys()) this.data?.onPeerLeave?.(pid);
    this.peers.clear();
    this.huddles.clear();
    this.o.onPeers?.();
  }

  /**
   * Relay workspaces: join the room while I or anyone else needs it (announced via presence `rtc`);
   * leave once nobody has for ROOM_IDLE_MS.
   */
  private syncRoom() {
    if (!this.lazyRoom || !this.o.joinRoom) return;
    const now = Date.now();
    const mine = !!this.myHuddle.ch;
    if (!!this.myPresence.rtc !== mine) this.setPresence({ rtc: mine || undefined });
    const wanted = mine || [...this.presence.values()].some((p) => p.rtc);
    if (wanted) {
      this.idleSince = 0;
      this.ensureRoom();
    } else if (this.room) {
      if (!this.idleSince) this.idleSince = now;
      else if (now - this.idleSince >= (this.o.roomIdleMs ?? ROOM_IDLE_MS)) this.leaveMedia();
    }
  }

  leave() {
    if (this.roomTimer) clearInterval(this.roomTimer);
    this.data?.leave();
    this.data = null;
    this.leaveMedia();
  }

  /* ---------- events ---------- */

  publish<B>(f: Omit<EventFields<B>, 'ws'>): Ev<B> {
    const e = makeEvent(this.o.kp, { ...f, ws: this.o.code });
    this.events.set(e.id, e);
    this.o.store.save([e]);
    this.queued.add(e.id);
    this.schedule([e]);
    this.data?.send([e]);
    return e;
  }

  receive(evs: unknown) {
    if (!Array.isArray(evs)) return;
    const fresh: Ev[] = [];
    const now = Date.now();
    for (const e of evs as unknown[]) {
      if (!e || typeof e !== 'object') continue;
      const ev = e as Ev;
      if (typeof ev.id !== 'string' || this.events.has(ev.id) || ev.ws !== this.o.code) continue;
      if (ev.to && ev.a !== this.me && ev.to !== this.me) continue;
      if (ev.ts > now + FUTURE_SKEW_MS) continue;
      if (!verifyEvent(ev)) continue;
      this.events.set(ev.id, ev);
      fresh.push(ev);
    }
    if (fresh.length) { this.o.store.save(fresh); this.schedule(fresh); }
  }

  delivered(ids: readonly string[] | 'all') {
    if (ids === 'all') this.queued.clear();
    else ids.forEach((id) => this.queued.delete(id));
    this.o.onPeers?.();
  }

  changed() {
    this.syncRoom();
    this.o.onPeers?.();
  }

  error(msg: string) {
    if (!this.o.onError) throw new Error(msg);
    this.o.onError(msg);
  }

  visibleFor(pub: string): Ev[] {
    const out: Ev[] = [];
    for (const e of this.events.values()) if (visibleTo(e, pub)) out.push(e);
    return out;
  }

  /** The attachment `id` as `pub` can see it, if any message visible to them attaches it. */
  private fileRef(id: string, pub: string): FileRef | null {
    for (const e of this.events.values()) {
      if (e.t !== 'msg' || !visibleTo(e, pub)) continue;
      const files = (e.b as MsgBody | undefined)?.files;
      const f = Array.isArray(files) ? files.find((x) => x?.id === id) : undefined;
      if (f) return f;
    }
    return null;
  }

  /** A file may only travel to someone who can see a message attaching it (DM files stay within the pair). */
  private canSeeFile(id: string, pub: string): boolean { return !!this.fileRef(id, pub); }

  private schedule(fresh: Ev[]) {
    this.fresh.push(...fresh);
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.recompute(); }, 16);
  }

  private recompute() {
    const hadCreator = this.o.creator;
    this.state = reduce(this.o.code, [...this.events.values()], { creator: this.o.creator });
    if (!hadCreator && this.state.creator) { this.o.creator = this.state.creator; this.o.onCreator?.(this.state.creator); }
    this.emit();
  }

  private emit() {
    const f = this.fresh;
    this.fresh = [];
    this.o.onState?.(this.state, f);
  }

  /* ---------- ephemeral ---------- */

  setPresence(p: Partial<Presence>) {
    this.myPresence = { ...this.myPresence, ...p, pub: this.me };
    this.data?.setPresence(this.myPresence);
  }

  setHuddle(h: Partial<HuddleState>) {
    this.myHuddle = { ...this.myHuddle, ...h };
    this.syncRoom();
    this.act?.hud.send(this.myHuddle);
  }

  /**
   * Fetch an attachment in the background; `onBlob` fires when it's stored. Relay workspaces
   * download it from Blossom. Trystero workspaces ask peers who may see it, retrying as peers join.
   */
  requestBlob(id: string) {
    if (this.transport.kind === 'nostr') { void this.download(id); return; }
    const now = Date.now();
    for (const [x, until] of this.fetching) if (until < now) this.fetching.delete(x);
    this.fetching.set(id, now + FETCH_MS);
    const t = [...this.peers].filter(([, v]) => this.canSeeFile(id, v.pub)).map(([k]) => k);
    if (t.length) this.act?.fwant?.send({ id }, { target: t });
  }

  /** An attachment's bytes: from the local store, or fetched over the workspace's transport. Null if unavailable. */
  async fetchFile(id: string): Promise<ArrayBuffer | null> {
    const have = await this.o.store.getBlob?.(id);
    if (have) return have;
    if (this.transport.kind === 'nostr') return this.download(id);
    return new Promise((resolve) => {
      this.waiters.set(id, [...(this.waiters.get(id) ?? []), resolve]);
      setTimeout(() => resolve(null), FETCH_MS);
      this.requestBlob(id);
    });
  }

  private download(id: string): Promise<ArrayBuffer | null> {
    const inflight = this.downloads.get(id);
    if (inflight) return inflight;
    const run = (async () => {
      const ref = this.fileRef(id, this.me)?.blob;
      const bytes = ref ? await downloadFile(ref) : null;
      if (!bytes) return null;
      const buf = bytes.slice().buffer;
      if ((await sha256Buf(buf)) !== id) return null; // the plaintext must match what the sender attached
      await this.gotBlob(id, buf);
      return buf;
    })().finally(() => this.downloads.delete(id));
    this.downloads.set(id, run);
    return run;
  }

  peerIdsFor(pubs: string[]): string[] {
    return [...this.peers].filter(([, v]) => pubs.includes(v.pub)).map(([k]) => k);
  }
}

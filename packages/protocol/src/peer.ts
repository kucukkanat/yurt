import type { Ev, FileRef, RekeyBody } from './types';
import { makeEvent, verifyEvent, visibleTo, isEventShape, MAX_FILE_BYTES, type EventFields } from './events';
import { reduce, members, parseRekey, type WsState, type ValidRekey } from './reduce';
import { buildKeyring, makeRekey, type Keyring } from './rekey';
import { sign, verify, type KeyPair } from './crypto';
import { downloadFile } from './blossom';
import { LEGACY_TRYSTERO, type WsTransport } from './invite';
import { roomConfig } from './room';

type NostrTransport = Extract<WsTransport, { kind: 'nostr' }>;
import type { DataLink, LinkHost, LinkKeys, LinkTiming, Presence } from './transport';
import { TrysteroData } from './transports/trystero';
import { NostrData } from './transports/nostr';
import { errMsg } from './util';
import { FileIdSchema, HandshakeSchema, HuddleStateSchema, parseBody, parseOr, type HuddleState } from './schemas';

export type { Presence } from './transport';

/* Structural subset of the Trystero ≥0.25 room API, so this package doesn't depend on it. */
export interface TCtx {
  peerId: string;
  metadata?: unknown;
}
export interface TAction<T = unknown> {
  send(
    data: T,
    opts?: { target?: string | string[] | null | undefined; metadata?: unknown; onProgress?: ((p: number, c: { peerId: string }) => void) | undefined },
  ): Promise<unknown>;
  onMessage: ((data: T, ctx: TCtx) => void) | null;
  onReceiveProgress?: ((p: number, ctx: TCtx) => void) | null;
}
export interface TRoom {
  makeAction<T = unknown>(name: string): TAction<T>;
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  onPeerStream: ((stream: MediaStream, peerId: string, metadata?: unknown) => void) | null;
  addStream(stream: MediaStream, opts?: { target?: string | string[] | null; metadata?: unknown }): unknown;
  removeStream(stream: MediaStream, opts?: { target?: string | string[] | null }): unknown;
  getPeers(): Record<string, RTCPeerConnection>;
  leave(): unknown;
}
/** The callbacks this package passes to Trystero's joinRoom. Handshake payloads come from other peers: untrusted. */
export interface TJoinCallbacks {
  onJoinError?(details: unknown): void;
  onPeerHandshake?(peerId: string, send: (data: unknown) => Promise<void>, receive: () => Promise<{ data: unknown }>): Promise<void>;
}
export type JoinRoom = (config: Record<string, unknown>, roomId: string, callbacks?: TJoinCallbacks) => TRoom;

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
  transport?: WsTransport | undefined;
  /**
   * WebRTC room. Required for Trystero, which carries events, files and huddles over it. Relay
   * workspaces use it only for voice and video, and only when given (the user's opt-in). Must be the
   * Trystero strategy named by `signalingOf(transport).kind`.
   */
  joinRoom?: JoinRoom | undefined;
  store: PeerStore;
  creator?: string | null | undefined;
  /** This device's WebRTC config: turnConfig / rtcConfig / rtcPolyfill. Signaling servers come from the transport. */
  rtc?: Record<string, unknown> | undefined;
  isBridge?: boolean | undefined;
  /** Relay workspaces leave the WebRTC room after it's been unneeded this long. Default 60 s. */
  roomIdleMs?: number | undefined;
  /** Trystero workspaces stop looking for a file among peers after this long. Default 60 s. */
  fetchMs?: number | undefined;
  /** Shorter heartbeats, retries and expiry (tests); defaults suit real use. */
  timing?: Partial<LinkTiming> | undefined;
  /** Allow `http://` Blossom servers in file refs (local development and tests). Otherwise only `https://` ones are fetched. */
  devFileServers?: boolean | undefined;
  onState?: ((s: WsState, fresh: Ev[]) => void) | undefined;
  onPeers?: (() => void) | undefined;
  onCreator?: ((pub: string) => void) | undefined;
  onBlob?: ((id: string) => void) | undefined;
  onBlobProgress?: ((id: string, p: number) => void) | undefined;
  onJoinError?: ((d: unknown) => void) | undefined;
  /** Failures the user should hear about: relays refusing an event, a failed save or download. */
  onError(msg: string): void;
  /** Relay workspaces: the key new events are written with changed (a rotation); invite links should use it. */
  onKey?: ((key: string) => void) | undefined;
}

const hsMsg = (code: string, from: string, to: string) => `yurt-hs:${code}:${from}>${to}`;

/** File bytes as WebRTC delivers them. Never a SharedArrayBuffer, which a Blob couldn't take. */
type Bytes = ArrayBuffer | Uint8Array<ArrayBuffer>;
const isBytes = (d: unknown): d is Bytes => d instanceof ArrayBuffer || (d instanceof Uint8Array && d.buffer instanceof ArrayBuffer);
const FUTURE_SKEW_MS = 10 * 60 * 1000;
const NO_PRESENCE: ReadonlyMap<string, Presence> = new Map();
const NO_RELAYS: ReadonlyMap<string, boolean> = new Map();
const ROOM_IDLE_MS = 60_000;
const FETCH_MS = 60_000;

async function sha256Buf(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
export { sha256Buf };

// Files only travel over WebRTC in Trystero workspaces; relay workspaces use Blossom.
type FileActs = { fwant: TAction<{ id: string }>; file: TAction<ArrayBuffer> };

/**
 * One workspace. Holds the signed event log and derived state; a DataLink (Trystero or Nostr)
 * carries events and presence. Trystero workspaces run everything over their WebRTC room. Relay
 * workspaces keep files on Blossom and open WebRTC only for huddles, only with the user's opt-in,
 * and only while someone is in one, so members don't expose IPs or signaling metadata otherwise.
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
  private data: DataLink | null = null;
  private hud: TAction<HuddleState> | null = null;
  private files: FileActs | null = null;
  private pendingPub = new Map<string, string>();
  private fetching = new Map<string, ReturnType<typeof setTimeout>>(); // Trystero: blob id → give-up timer
  private waiters = new Map<string, ((b: ArrayBuffer | null) => void)[]>();
  private downloads = new Map<string, Promise<ArrayBuffer | null>>(); // Nostr: in-flight Blossom fetches
  private idleSince = 0;
  private roomTimer: ReturnType<typeof setInterval> | null = null;
  private fresh: Ev[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** How events travel: relays, or the Trystero room (which then always exists). */
  private readonly link: { kind: 'nostr'; t: NostrTransport } | { kind: 'trystero'; join: JoinRoom };
  private readonly roomIdleMs: number;

  constructor(public o: WorkspacePeerOpts) {
    const t = o.transport ?? LEGACY_TRYSTERO;
    if (t.kind === 'nostr') this.link = { kind: 'nostr', t };
    else if (o.joinRoom) this.link = { kind: 'trystero', join: o.joinRoom };
    else throw new Error('Trystero workspaces need joinRoom');
    this.roomIdleMs = o.roomIdleMs ?? ROOM_IDLE_MS;
    this.state = reduce(o.code, [], { creator: o.creator });
    this.myPresence = { pub: o.kp.pub, st: 'online', bridge: o.isBridge || undefined };
  }

  get me() {
    return this.o.kp.pub;
  }
  get kp() {
    return this.o.kp;
  }
  get code() {
    return this.o.code;
  }
  get transport(): WsTransport {
    return this.o.transport ?? LEGACY_TRYSTERO;
  }
  /** Online members, keyed by a link-specific id; each entry's `pub` is authenticated. */
  get presence(): ReadonlyMap<string, Presence> {
    const all = this.data?.presence;
    // A ban can arrive after someone's presence did.
    return all ? new Map([...all].filter(([, p]) => !this.isBanned(p.pub))) : NO_PRESENCE;
  }
  /** Relay workspaces: each relay → connected now. Empty for Trystero workspaces. */
  relayStatus(): ReadonlyMap<string, boolean> {
    const t = this.transport;
    if (t.kind !== 'nostr') return NO_RELAYS;
    return this.data?.relayStatus?.() ?? new Map(t.relays.map((u) => [u, false]));
  }
  /** Whether events can currently leave this device (a peer or relay is reachable). */
  get connected(): boolean {
    return this.data?.connected ?? false;
  }
  private get lazyRoom() {
    return this.transport.kind === 'nostr';
  }
  /** Whether this peer may open WebRTC for voice and video. Relay workspaces only with the user's opt-in (joinRoom given). */
  get calls(): boolean {
    return !!this.o.joinRoom;
  }

  /** Relay workspaces: the key chain (see rekey.ts); null for Trystero. */
  private ring: Keyring | null = null;

  /** The workspace key to put in invite links: after a rotation, the newest one. */
  get inviteKey(): string | undefined {
    return this.ring?.write.key ?? this.transport.key;
  }

  /** Removed from this workspace: banned, or the key was rotated without me, so nothing new reaches me. */
  get lockedOut(): boolean {
    return this.state.bans.has(this.me) || !!this.ring?.lockedOut;
  }

  /**
   * Relay workspaces: replace the workspace key so removed members can't read anything new (they keep
   * what they already had). Admins only. The rekey goes out under the old key, for current members,
   * and the new one, for people who join later with a fresh invite.
   */
  rotate(): Ev<RekeyBody> {
    // Apply what's pending first: a ban published a moment ago must already exclude its target.
    this.recompute();
    const ring = this.ring;
    if (this.transport.kind !== 'nostr' || !ring) throw new Error('Only relay workspaces rotate their key.');
    if (!this.state.admins.has(this.me)) throw new Error('Only admins can rotate the workspace key.');
    if (ring.lockedOut) throw new Error('This device no longer holds the current workspace key.');
    const e = makeEvent(this.o.kp, { ws: this.o.code, t: 'rekey', b: makeRekey(ring, this.o.kp, members(this.state)).body });
    this.events.set(e.id, e);
    this.save([e]);
    this.queued.add(e.id);
    this.fresh.push(e);
    this.recompute(); // adopt the new key before sending, so the rekey itself goes out under both keys
    this.data?.send([e]);
    return e;
  }

  private linkKeys(ring: Keyring): LinkKeys {
    return { all: [...ring.keys.values()].map((k) => ({ key: k.key, epoch: k.epoch })), write: ring.write.key };
  }

  /** The key chain from the invite key and every rekey in the log (see rekey.ts). */
  private ringFor(t: NostrTransport): Keyring {
    const raw = [...this.events.values()].flatMap((e) => (e.t === 'rekey' ? [parseRekey(e)] : [])).filter((r): r is ValidRekey => !!r);
    return buildKeyring(t.key, raw, this.state.rekeys, this.o.kp);
  }

  private updateKeyring() {
    if (this.link.kind !== 'nostr') return;
    const before = this.ring;
    const ring = this.ringFor(this.link.t);
    this.ring = ring;
    if (before && before.write.key === ring.write.key && before.keys.size === ring.keys.size) return;
    this.data?.setKeys?.(this.linkKeys(ring));
    if (before?.write.key !== ring.write.key) {
      // The WebRTC room's credentials derive from the write key; rejoin on the new one when needed.
      if (before && this.room) this.leaveMedia();
      if (before) this.o.onKey?.(ring.write.key);
    }
  }

  async start() {
    const evs = await this.o.store.load(this.o.code);
    // Left while loading: opening a link or room now would leak it, since nobody will leave it again.
    if (this.closed) return;
    for (const e of evs) this.events.set(e.id, e);
    this.recompute();
    if (this.link.kind === 'nostr') {
      const { t } = this.link;
      const { code, store } = this.o;
      const mark = (await store.loadMark?.(code)) ?? 0;
      if (this.closed) return;
      const saveMark = (sec: number) => {
        store.saveMark?.(code, sec).catch((err: unknown) => this.error(`Couldn't save the sync mark: ${errMsg(err)}`));
      };
      this.data = new NostrData(this, { keys: this.linkKeys(this.ringFor(t)), relays: t.relays, mark, saveMark, presence: this.myPresence, timing: this.o.timing });
      if (this.o.joinRoom) this.roomTimer = setInterval(() => this.syncRoom(), Math.min(5_000, this.roomIdleMs));
    } else this.data = new TrysteroData(this, this.joinMedia(this.link.join), this.myPresence, this.o.timing);
    // Events published while the link was still starting (e.g. ws.create right after creation).
    const early = [...this.events.values()].filter((e) => this.queued.has(e.id));
    if (early.length) this.data.send(early);
  }

  /** The WebRTC room, joining it now if needed (huddles call this). Null when this peer has no WebRTC. */
  ensureRoom(): TRoom | null {
    if (this.room) return this.room;
    const join = this.o.joinRoom;
    return join ? this.joinMedia(join) : null;
  }

  private joinMedia(joinRoom: JoinRoom): TRoom {
    const { code, kp, selfId } = this.o;
    const { config, roomId } = roomConfig(code, this.transport, this.inviteKey, this.o.rtc);
    const room = joinRoom(config, roomId, {
      onJoinError: (d: unknown) => this.o.onJoinError?.(d),
      onPeerHandshake: async (peerId, send, receive) => {
        await send({ pub: kp.pub, sig: sign(kp.sec, hsMsg(code, selfId, peerId)) });
        // From an unauthenticated peer: checked for shape, then for a valid signature by the key it claims.
        const data = parseOr(HandshakeSchema, (await receive()).data);
        if (!data || !verify(data.pub, hsMsg(code, peerId, selfId), data.sig)) throw new Error('identity check failed');
        if (this.state.bans.has(data.pub)) throw new Error('banned');
        this.pendingPub.set(peerId, data.pub);
      },
    });
    this.room = room;
    const hud = room.makeAction<HuddleState>('hud');
    this.hud = hud;
    hud.onMessage = (raw: unknown, { peerId }) => {
      const h = parseOr(HuddleStateSchema, raw);
      if (!h || !this.peers.has(peerId)) return;
      this.huddles.set(peerId, h);
      this.onHuddle?.(peerId, h);
      this.o.onPeers?.();
    };
    if (!this.lazyRoom) this.files = this.wireFiles(room);
    room.onPeerJoin = (peerId) => {
      const pub = this.pendingPub.get(peerId);
      /* v8 ignore next -- Trystero activates a peer only after our onPeerHandshake resolved, which recorded its key */
      if (!pub) return;
      this.pendingPub.delete(peerId);
      if (this.isBanned(pub)) {
        room.getPeers()[peerId]?.close();
        return;
      } // banned since its handshake
      this.peers.set(peerId, { pub });
      if (this.myHuddle.ch) hud.send(this.myHuddle, { target: peerId });
      if (this.files) for (const id of this.fetching.keys()) if (this.canSeeFile(id, pub)) this.files.fwant.send({ id }, { target: peerId });
      this.data?.onPeerJoin?.(peerId, pub);
      // Only "peers changed". State goes out with the scheduled recompute, together with the fresh
      // events it contains: emitting here would hand out fresh events with a state that lacks them.
      this.o.onPeers?.();
    };
    room.onPeerLeave = (peerId) => this.peerLeft(peerId);
    return room;
  }

  private peerLeft(peerId: string) {
    this.peers.delete(peerId);
    this.data?.onPeerLeave?.(peerId);
    if (this.huddles.has(peerId)) {
      this.huddles.delete(peerId);
      this.onHuddle?.(peerId, null);
    }
    this.o.onPeers?.();
  }

  /** Cut WebRTC peers whose key the current state bans; the handshake keeps them out from then on. */
  private dropBanned() {
    for (const [peerId, { pub }] of this.peers) {
      if (!this.isBanned(pub)) continue;
      this.room?.getPeers()[peerId]?.close();
      this.peerLeft(peerId);
    }
  }

  private wireFiles(room: TRoom): FileActs {
    const fwant = room.makeAction<{ id: string }>('fwant');
    const file = room.makeAction<ArrayBuffer>('file');
    fwant.onMessage = (m: unknown, { peerId }) => {
      const who = this.peers.get(peerId);
      const id = parseOr(FileIdSchema, m)?.id;
      if (!who || id === undefined || !this.canSeeFile(id, who.pub)) return;
      this.o.store
        .getBlob?.(id)
        .then((b) => {
          if (b) file.send(b, { target: peerId, metadata: { id } });
        })
        .catch((err: unknown) => this.error(`Couldn't serve file ${id}: ${errMsg(err)}`));
    };
    file.onMessage = (data: unknown, { peerId, metadata }) => {
      const id = parseOr(FileIdSchema, metadata)?.id;
      const who = this.peers.get(peerId);
      // Only files I'm fetching, from a member who may see them: anything else is a peer pushing bytes at me.
      if (!who || id === undefined || !this.fetching.has(id) || !this.canSeeFile(id, who.pub)) return;
      if (!isBytes(data) || data.byteLength > MAX_FILE_BYTES) return;
      this.storeFile(id, data).catch((err: unknown) => this.error(`Couldn't store file ${id}: ${errMsg(err)}`));
    };
    file.onReceiveProgress = (p, { metadata }) => {
      const id = parseOr(FileIdSchema, metadata)?.id;
      if (id !== undefined && this.fetching.has(id)) this.o.onBlobProgress?.(id, p);
    };
    return { fwant, file };
  }

  private async storeFile(id: string, data: Bytes) {
    // Browsers deliver an ArrayBuffer; Node (the bridge, via werift) a Uint8Array. A Blob takes either and copies it.
    const buf = await new Blob([data]).arrayBuffer();
    if ((await this.o.store.getBlob?.(id)) || (await sha256Buf(buf)) !== id) return;
    await this.gotBlob(id, buf);
  }

  private async gotBlob(id: string, buf: ArrayBuffer) {
    await this.o.store.putBlob?.(id, buf);
    this.settle(id, buf);
    this.o.onBlob?.(id);
  }

  /** Ends a WebRTC file fetch: stops its give-up timer and answers everyone waiting for it. */
  private settle(id: string, buf: ArrayBuffer | null) {
    clearTimeout(this.fetching.get(id));
    this.fetching.delete(id);
    for (const w of this.waiters.get(id) ?? []) w(buf);
    this.waiters.delete(id);
  }

  private leaveMedia() {
    this.room?.leave();
    this.room = null;
    this.hud = null;
    this.files = null;
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
      else if (now - this.idleSince >= this.roomIdleMs) this.leaveMedia();
    }
  }

  leave() {
    this.closed = true;
    if (this.roomTimer) clearInterval(this.roomTimer);
    for (const id of [...this.fetching.keys()]) this.settle(id, null);
    this.data?.leave();
    this.data = null;
    this.leaveMedia();
  }

  /* ---------- events ---------- */

  publish<B>(f: Omit<EventFields<B>, 'ws'>): Ev<B> {
    const e = makeEvent(this.o.kp, { ...f, ws: this.o.code });
    this.events.set(e.id, e);
    this.save([e]);
    this.queued.add(e.id);
    this.schedule([e]);
    this.data?.send([e]);
    return e;
  }

  receive(evs: unknown) {
    if (!Array.isArray(evs)) return;
    const fresh: Ev[] = [];
    const now = Date.now();
    for (const ev of evs as unknown[]) {
      if (!isEventShape(ev) || this.events.has(ev.id) || ev.ws !== this.o.code) continue;
      if (ev.to && ev.a !== this.me && ev.to !== this.me) continue;
      if (ev.ts > now + FUTURE_SKEW_MS) continue;
      if (!verifyEvent(ev)) continue;
      this.events.set(ev.id, ev);
      fresh.push(ev);
    }
    if (fresh.length) {
      this.save(fresh);
      this.schedule(fresh);
    }
  }

  private save(evs: Ev[]) {
    // Async, so a store that throws synchronously (IndexedDB does while its connection closes) is
    // reported like any failed save instead of aborting receive() or publish() halfway.
    void (async () => this.o.store.save(evs))().catch((err: unknown) => this.error(`Couldn't save ${evs.length} event(s) on this device: ${errMsg(err)}`));
  }

  delivered(ids: readonly string[]) {
    if (!ids.length) return;
    for (const id of ids) this.queued.delete(id);
    this.o.onPeers?.();
  }

  isBanned(pub: string): boolean {
    return this.state.bans.has(pub);
  }

  changed() {
    this.syncRoom();
    this.o.onPeers?.();
  }

  error(msg: string) {
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
      const f = parseBody('msg', e.b)?.files.find((x) => x.id === id);
      if (f) return f;
    }
    return null;
  }

  /** A file may only travel to or from someone who can see a message attaching it (DM files stay within the pair), and never a banned key. */
  private canSeeFile(id: string, pub: string): boolean {
    return !this.isBanned(pub) && !!this.fileRef(id, pub);
  }

  private schedule(fresh: Ev[]) {
    this.fresh.push(...fresh);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.recompute();
    }, 16);
  }

  private recompute() {
    const hadCreator = this.o.creator;
    this.state = reduce(this.o.code, [...this.events.values()], { creator: this.o.creator });
    if (!hadCreator && this.state.creator) {
      this.o.creator = this.state.creator;
      this.o.onCreator?.(this.state.creator);
    }
    this.dropBanned();
    this.updateKeyring();
    const fresh = this.fresh;
    this.fresh = [];
    this.o.onState?.(this.state, fresh);
  }

  /* ---------- ephemeral ---------- */

  setPresence(p: Partial<Presence>) {
    this.myPresence = { ...this.myPresence, ...p, pub: this.me };
    this.data?.setPresence(this.myPresence);
  }

  setHuddle(h: Partial<HuddleState>) {
    this.myHuddle = { ...this.myHuddle, ...h };
    this.syncRoom();
    this.hud?.send(this.myHuddle);
  }

  /**
   * Fetch an attachment in the background; `onBlob` fires when it's stored. Relay workspaces
   * download it from Blossom. Trystero workspaces ask peers who may see it, retrying as peers join.
   */
  requestBlob(id: string) {
    if (this.transport.kind === 'nostr') {
      void this.download(id);
      return;
    } // never rejects: failures are reported
    clearTimeout(this.fetching.get(id));
    this.fetching.set(
      id,
      setTimeout(() => this.settle(id, null), this.o.fetchMs ?? FETCH_MS),
    );
    const t = [...this.peers].filter(([, v]) => this.canSeeFile(id, v.pub)).map(([k]) => k);
    if (t.length) this.files?.fwant.send({ id }, { target: t });
  }

  /** An attachment's bytes: from the local store, or fetched over the workspace's transport. Null if unavailable. */
  async fetchFile(id: string): Promise<ArrayBuffer | null> {
    const have = await this.o.store.getBlob?.(id);
    if (have) return have;
    if (this.transport.kind === 'nostr') return this.download(id);
    return new Promise((resolve) => {
      this.waiters.set(id, [...(this.waiters.get(id) ?? []), resolve]); // settled on arrival, give-up or leave
      this.requestBlob(id);
    });
  }

  private download(id: string): Promise<ArrayBuffer | null> {
    const inflight = this.downloads.get(id);
    if (inflight) return inflight;
    const run = (async () => {
      // Another member wrote this ref: downloadFile checks its shape and which servers it names.
      const ref = this.fileRef(id, this.me)?.blob;
      const bytes = ref ? await downloadFile(ref, { allowHttp: this.o.devFileServers }) : null;
      if (!bytes) return null;
      const buf = bytes.slice().buffer;
      if ((await sha256Buf(buf)) !== id) return null; // the plaintext must match what the sender attached
      await this.gotBlob(id, buf);
      return buf;
    })()
      .catch((err: unknown) => {
        this.error(`Couldn't download file ${id}: ${errMsg(err)}`);
        return null;
      })
      .finally(() => this.downloads.delete(id));
    this.downloads.set(id, run);
    return run;
  }

  peerIdsFor(pubs: string[]): string[] {
    return [...this.peers].filter(([, v]) => pubs.includes(v.pub)).map(([k]) => k);
  }
}

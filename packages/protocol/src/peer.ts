import type { AdmitBody, Ev, FileRef, RekeyBody } from './types';
import { makeEvent, verifyEvent, visibleTo, isEventShape, type EventFields } from './events';
import { reduce, members, parseRekey, inviteOpen, type WsState, type ValidRekey } from './reduce';
import { buildKeyring, makeRekey, type Keyring } from './rekey';
import { sign, verify, type KeyPair } from './crypto';
import { downloadFile } from './blossom';
import type { WsTransport } from './invite';
import { roomConfig } from './room';
import type { DataLink, LinkHost, LinkKeys, LinkTiming, Presence } from './transport';
import { NostrData } from './transports/nostr';
import { errMsg } from './util';
import { HandshakeSchema, HuddleStateSchema, parseBody, parseOr, type HuddleState } from './schemas';
import { openJoinRequest, provesAdmin, sealGrant, type JoinReq } from './join';

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

/** What a peer needs for calls (voice, video, screen), the only thing that uses WebRTC. */
export interface CallOpts {
  /** Trystero's Nostr strategy. Signaling goes over the workspace's relays. */
  joinRoom: JoinRoom;
  /** This device's id in Trystero rooms. */
  selfId: string;
  /** This device's WebRTC config: turnConfig / rtcConfig / rtcPolyfill. */
  rtc?: Record<string, unknown> | undefined;
}

export interface WorkspacePeerOpts {
  code: string;
  kp: KeyPair;
  /** The workspace's relays and key. */
  transport: WsTransport;
  /** Absent: this peer never opens WebRTC (no opt-in, or the bridge). */
  calls?: CallOpts | undefined;
  store: PeerStore;
  creator?: string | null | undefined;
  isBridge?: boolean | undefined;
  /** Leave the WebRTC room after it's been unneeded this long. Default 60 s. */
  roomIdleMs?: number | undefined;
  /** Shorter heartbeats, retries and expiry (tests); defaults suit real use. */
  timing?: Partial<LinkTiming> | undefined;
  /** Allow `http://` Blossom servers in file refs (local development and tests). Otherwise only `https://` ones are fetched. */
  devFileServers?: boolean | undefined;
  onState?: ((s: WsState, fresh: Ev[]) => void) | undefined;
  onPeers?: (() => void) | undefined;
  onCreator?: ((pub: string) => void) | undefined;
  onBlob?: ((id: string) => void) | undefined;
  onJoinError?: ((d: unknown) => void) | undefined;
  /** Failures the user should hear about: relays refusing an event, a failed save or download. */
  onError(msg: string): void;
  /** The key new events are written with changed (a rotation); invite links should use it. */
  onKey?: ((key: string) => void) | undefined;
  /** Someone asked to join and an admin (me) can answer: see `joinRequests`. */
  onJoinRequest?: ((r: JoinReq) => void) | undefined;
}

const hsMsg = (code: string, from: string, to: string) => `yurt-hs:${code}:${from}>${to}`;

const FUTURE_SKEW_MS = 10 * 60 * 1000;
const NO_PRESENCE: ReadonlyMap<string, Presence> = new Map();
const ROOM_IDLE_MS = 60_000;

async function sha256Buf(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
export { sha256Buf };

/**
 * One workspace. Holds the signed event log and derived state; Nostr relays carry events and
 * presence, Blossom carries files. WebRTC is only for huddles (voice, video, screen), only when this
 * peer may use it (`calls` given), and only while someone is in one, so members don't expose IPs or
 * signaling metadata otherwise. Shared by the web app and the headless bridge.
 */
export class WorkspacePeer implements LinkHost {
  events = new Map<string, Ev>();
  state: WsState;
  /** Handshaked WebRTC peers in the call room. */
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
  private pendingPub = new Map<string, string>();
  private downloads = new Map<string, Promise<ArrayBuffer | null>>(); // in-flight Blossom fetches
  private idleSince = 0;
  private roomTimer: ReturnType<typeof setInterval> | null = null;
  private fresh: Ev[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly roomIdleMs: number;

  constructor(public o: WorkspacePeerOpts) {
    this.roomIdleMs = o.roomIdleMs ?? ROOM_IDLE_MS;
    this.state = reduce(o.code, [], { creator: o.creator });
    this.ring = this.ringFor(o.transport);
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
    return this.o.transport;
  }
  /** Online members, keyed by a link-specific id; each entry's `pub` is authenticated. */
  get presence(): ReadonlyMap<string, Presence> {
    const all = this.data?.presence;
    // A ban can arrive after someone's presence did.
    return all ? new Map([...all].filter(([, p]) => !this.isBanned(p.pub))) : NO_PRESENCE;
  }
  /** Each relay → connected now. */
  relayStatus(): ReadonlyMap<string, boolean> {
    return this.data?.relayStatus() ?? new Map(this.transport.relays.map((u) => [u, false]));
  }
  /** Whether events can currently leave this device (a relay is reachable). */
  get connected(): boolean {
    return this.data?.connected ?? false;
  }
  /** Whether this peer may open WebRTC for calls: only with the user's opt-in. */
  get calls(): boolean {
    return !!this.o.calls;
  }

  /** The key chain (see rekey.ts). */
  private ring: Keyring;
  /** The invites whose lobbies the data link watches, joined: a change resubscribes. */
  private watching = '';

  /** The workspace key to put in invite links: after a rotation, the newest one. */
  get inviteKey(): string {
    return this.ring.write.key;
  }

  /** Removed from this workspace: banned, or the key was rotated without me, so nothing new reaches me. */
  get lockedOut(): boolean {
    return this.state.bans.has(this.me) || this.ring.lockedOut;
  }

  /**
   * Replace the workspace key so removed members can't read anything new (they keep
   * what they already had). Admins only. The rekey goes out under the old key, for current members,
   * and the new one, for people who join later with a fresh invite.
   */
  rotate(): Ev<RekeyBody> {
    // Apply what's pending first: a ban published a moment ago must already exclude its target.
    this.recompute();
    const ring = this.ring;
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
    return { all: [...ring.keys.values()].map((k) => ({ key: k.key, epoch: k.epoch })), write: ring.write.key, lobby: this.lobby() };
  }

  /** Admins watch every open invite's lobby for requests to join. */
  private lobby(): string[] {
    const s = this.state;
    const now = Date.now();
    return s.admins.has(this.me) ? [...s.invites.keys()].filter((jk) => inviteOpen(s, jk, now)) : [];
  }

  /* ---------- join approval (see join.ts) ---------- */

  /** The newest request per person, as it arrived; `joinRequests` says which still wait. */
  private requests = new Map<string, JoinReq>();

  joinRequest(jk: string, content: string) {
    const r = openJoinRequest(this.o.code, jk, content);
    const have = r && this.requests.get(r.pub);
    if (!r || (have && have.ts >= r.ts)) return;
    this.requests.set(r.pub, r);
    if (this.waiting(r)) this.o.onJoinRequest?.(r);
    this.o.onPeers?.();
  }

  /** Whether a request still needs an answer: its invite is open, and they aren't in, banned or answered since. */
  private waiting(r: JoinReq): boolean {
    const s = this.state;
    const answered = s.admits.get(r.pub);
    return inviteOpen(s, r.jk, Date.now()) && !s.profiles.has(r.pub) && !s.bans.has(r.pub) && !(answered && answered.ts >= r.ts);
  }

  /** Requests to join that wait for an admin, oldest first. */
  get joinRequests(): JoinReq[] {
    return [...this.requests.values()].filter((r) => this.waiting(r)).sort((x, y) => x.ts - y.ts);
  }

  /**
   * Answers a request to join. Letting someone in records it (so other admins see it's handled, and key rotations
   * include them) and hands them the current key, sealed to them in the invite's lobby. Admins only.
   */
  admit(pub: string, on: boolean): Ev<AdmitBody> {
    const r = this.requests.get(pub);
    if (!this.state.admins.has(this.me)) throw new Error('Only admins can let people in.');
    if (!r) throw new Error('They haven’t asked to join.');
    const e = this.publish<AdmitBody>({ t: 'admit', b: { target: pub, jk: r.jk, on } });
    /* v8 ignore next -- requests only arrive through the data link, so it's there while one is answered */
    if (on) this.data?.grant(r.jk, pub, sealGrant(this.o.kp, r.jk, pub, this.inviteKey, this.adminProof()));
    return e;
  }

  /** For an admin who isn't the creator: the creator's newest signed event making me one, which joiners check. */
  private adminProof(): Ev | undefined {
    const { creator } = this.state;
    return [...this.events.values()].filter((e) => provesAdmin(this.o.code, creator, this.me, e)).sort((x, y) => y.ts - x.ts)[0];
  }

  /** The key chain from the invite key and every rekey in the log (see rekey.ts). */
  private ringFor(t: WsTransport): Keyring {
    const raw = [...this.events.values()].flatMap((e) => (e.t === 'rekey' ? [parseRekey(e)] : [])).filter((r): r is ValidRekey => !!r);
    return buildKeyring(t.key, raw, this.state.rekeys, this.o.kp);
  }

  private updateKeyring() {
    const before = this.ring;
    const ring = this.ringFor(this.transport);
    this.ring = ring;
    const lobby = this.lobby().join();
    const lobbyChanged = lobby !== this.watching;
    this.watching = lobby;
    if (before.write.key === ring.write.key && before.keys.size === ring.keys.size && !lobbyChanged) return;
    this.data?.setKeys(this.linkKeys(ring));
    if (before.write.key !== ring.write.key) {
      // The WebRTC room's credentials derive from the write key; rejoin on the new one when needed.
      if (this.room) this.leaveMedia();
      this.o.onKey?.(ring.write.key);
    }
  }

  async start() {
    const evs = await this.o.store.load(this.o.code);
    // Left while loading: opening a link or room now would leak it, since nobody will leave it again.
    if (this.closed) return;
    for (const e of evs) this.events.set(e.id, e);
    this.recompute();
    const { code, store, transport: t } = this.o;
    const mark = (await store.loadMark?.(code)) ?? 0;
    if (this.closed) return;
    const saveMark = (sec: number) => {
      store.saveMark?.(code, sec).catch((err: unknown) => this.error(`Couldn't save the sync mark: ${errMsg(err)}`));
    };
    this.data = new NostrData(this, { keys: this.linkKeys(this.ringFor(t)), relays: t.relays, mark, saveMark, presence: this.myPresence, timing: this.o.timing });
    if (this.o.calls) this.roomTimer = setInterval(() => this.syncRoom(), Math.min(5_000, this.roomIdleMs));
    // Events published while the link was still starting (e.g. ws.create right after creation).
    const early = [...this.events.values()].filter((e) => this.queued.has(e.id));
    if (early.length) this.data.send(early);
  }

  /** The WebRTC room, joining it now if needed (huddles call this). Null when this peer has no WebRTC. */
  ensureRoom(): TRoom | null {
    if (this.room) return this.room;
    const c = this.o.calls;
    return c ? this.joinMedia(c) : null;
  }

  private joinMedia({ joinRoom, selfId, rtc }: CallOpts): TRoom {
    const { code, kp } = this.o;
    const { config, roomId } = roomConfig(this.transport.relays, this.inviteKey, rtc);
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
      this.o.onPeers?.();
    };
    room.onPeerLeave = (peerId) => this.peerLeft(peerId);
    return room;
  }

  private peerLeft(peerId: string) {
    this.peers.delete(peerId);
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

  private async gotBlob(id: string, buf: ArrayBuffer) {
    await this.o.store.putBlob?.(id, buf);
    this.o.onBlob?.(id);
  }

  private leaveMedia() {
    this.room?.leave();
    this.room = null;
    this.hud = null;
    this.pendingPub.clear();
    this.peers.clear();
    this.huddles.clear();
    this.o.onPeers?.();
  }

  /**
   * Join the room while I or anyone else needs it (announced via presence `rtc`); leave once nobody
   * has for ROOM_IDLE_MS.
   */
  private syncRoom() {
    if (!this.o.calls) return;
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

  /** The attachment `id` as `pub` can see it, if any message visible to them attaches it. */
  private fileRef(id: string, pub: string): FileRef | null {
    for (const e of this.events.values()) {
      if (e.t !== 'msg' || !visibleTo(e, pub)) continue;
      const f = parseBody('msg', e.b)?.files.find((x) => x.id === id);
      if (f) return f;
    }
    return null;
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

  /** Download an attachment from Blossom in the background; `onBlob` fires when it's stored. Never rejects: failures are reported. */
  requestBlob(id: string) {
    void this.download(id);
  }

  /** An attachment's bytes: from the local store, or downloaded from Blossom. Null if unavailable. */
  async fetchFile(id: string): Promise<ArrayBuffer | null> {
    return (await this.o.store.getBlob?.(id)) ?? this.download(id);
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

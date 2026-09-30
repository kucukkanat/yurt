import type { Ev } from './types';
import { makeEvent, verifyEvent, visibleTo, type EventFields } from './events';
import { reduce, type WsState } from './reduce';
import { summarize, diffDays, idsByDays, reconcile, type Summary } from './sync';
import { APP_ID, roomIdFor } from './codes';
import { sign, verify, type KeyPair } from './crypto';

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

export interface Presence {
  pub: string;
  st: 'online' | 'away';
  typing?: string | null;                              // channel id
  agents?: Record<string, { working?: string | null }>; // agentId → channel it's working in
  bridge?: boolean;
}
export interface HuddleState { ch: string | null; mic: boolean; cam: boolean; screen: boolean }

export interface PeerStore {
  load(ws: string): Promise<Ev[]>;
  save(evs: Ev[]): Promise<void>;
  getBlob?(id: string): Promise<ArrayBuffer | null>;
  putBlob?(id: string, buf: ArrayBuffer): Promise<void>;
}

export interface WorkspacePeerOpts {
  code: string;
  kp: KeyPair;
  selfId: string;
  joinRoom: JoinRoom;
  store: PeerStore;
  creator?: string | null;
  rtc?: Record<string, unknown>;   // turnConfig / rtcConfig / rtcPolyfill / relayConfig
  isBridge?: boolean;
  onState?(s: WsState, fresh: Ev[]): void;
  onPeers?(): void;
  onCreator?(pub: string): void;
  onBlob?(id: string): void;
  onBlobProgress?(id: string, p: number): void;
  onJoinError?(d: unknown): void;
}

const hsMsg = (code: string, from: string, to: string) => `yurt-hs:${code}:${from}>${to}`;
const FUTURE_SKEW_MS = 10 * 60 * 1000;

async function sha256Buf(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
export { sha256Buf };

type Acts = {
  ev: TAction<Ev[]>; sync: TAction<any>; pres: TAction<Presence>; hud: TAction<HuddleState>;
  fwant: TAction<{ id: string }>; file: TAction<ArrayBuffer>;
};

/**
 * One workspace = one Trystero room. Holds the event log, keeps it in sync with every
 * connected peer, and carries ephemeral presence / typing / huddle state.
 * Shared by the web app and the headless bridge.
 */
export class WorkspacePeer {
  events = new Map<string, Ev>();
  state: WsState;
  peers = new Map<string, { pub: string }>();
  presence = new Map<string, Presence>();
  huddles = new Map<string, HuddleState>();
  queued = new Set<string>();
  room: TRoom | null = null;
  myPresence: Presence;
  myHuddle: HuddleState = { ch: null, mic: false, cam: false, screen: false };
  onHuddle?: (peerId: string, h: HuddleState | null) => void;
  onPeerJoined?: (peerId: string) => void;
  private act: Acts | null = null;
  private pendingPub = new Map<string, string>();
  private fresh: Ev[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;

  constructor(public o: WorkspacePeerOpts) {
    this.state = reduce(o.code, [], { creator: o.creator });
    this.myPresence = { pub: o.kp.pub, st: 'online', bridge: o.isBridge || undefined };
  }

  get me() { return this.o.kp.pub; }
  get code() { return this.o.code; }

  async start() {
    const evs = await this.o.store.load(this.o.code);
    for (const e of evs) this.events.set(e.id, e);
    this.recompute();
    this.connect();
  }

  private connect() {
    const { code, kp, selfId } = this.o;
    const room = this.o.joinRoom({ appId: APP_ID, password: code, ...(this.o.rtc || {}) }, roomIdFor(code), {
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
    const act: Acts = {
      ev: room.makeAction<Ev[]>('ev'), sync: room.makeAction('sync'), pres: room.makeAction<Presence>('pres'),
      hud: room.makeAction<HuddleState>('hud'), fwant: room.makeAction<{ id: string }>('fwant'), file: room.makeAction<ArrayBuffer>('file'),
    };
    this.act = act;
    act.ev.onMessage = (evs, { peerId }) => this.receive(evs, peerId);
    act.sync.onMessage = (m, { peerId }) => this.onSync(m, peerId);
    act.pres.onMessage = (p, { peerId }) => {
      const who = this.peers.get(peerId);
      if (!who || !p || p.pub !== who.pub) return;
      this.presence.set(peerId, p);
      this.o.onPeers?.();
    };
    act.hud.onMessage = (h, { peerId }) => {
      if (!this.peers.has(peerId)) return;
      this.huddles.set(peerId, h);
      this.onHuddle?.(peerId, h);
      this.o.onPeers?.();
    };
    act.fwant.onMessage = async ({ id }, { peerId }) => {
      const b = await this.o.store.getBlob?.(id);
      if (b) act.file.send(b, { target: peerId, metadata: { id } });
    };
    act.file.onMessage = async (buf, { metadata }) => {
      const id = metadata?.id;
      if (!id || !(buf instanceof ArrayBuffer) || (await this.o.store.getBlob?.(id))) return;
      if ((await sha256Buf(buf)) !== id) return;
      await this.o.store.putBlob?.(id, buf);
      this.o.onBlob?.(id);
    };
    act.file.onReceiveProgress = (p, { metadata }) => metadata?.id && this.o.onBlobProgress?.(metadata.id, p);
    room.onPeerJoin = (peerId) => {
      const pub = this.pendingPub.get(peerId);
      if (!pub) return;
      this.pendingPub.delete(peerId);
      this.peers.set(peerId, { pub });
      act.sync.send({ k: 'sum', s: summarize(this.visibleFor(pub)) }, { target: peerId });
      act.pres.send(this.myPresence, { target: peerId });
      if (this.myHuddle.ch) act.hud.send(this.myHuddle, { target: peerId });
      this.queued.clear();
      this.onPeerJoined?.(peerId);
      this.o.onPeers?.();
      this.emit();
    };
    room.onPeerLeave = (peerId) => {
      this.peers.delete(peerId);
      this.presence.delete(peerId);
      if (this.huddles.has(peerId)) { this.huddles.delete(peerId); this.onHuddle?.(peerId, null); }
      this.o.onPeers?.();
    };
    this.beat = setInterval(() => act.pres.send(this.myPresence), 30_000);
  }

  leave() {
    if (this.beat) clearInterval(this.beat);
    this.room?.leave();
    this.room = null;
    this.act = null;
    this.peers.clear();
    this.presence.clear();
    this.huddles.clear();
  }

  /* ---------- events ---------- */

  publish<B>(f: Omit<EventFields<B>, 'ws'>): Ev<B> {
    const e = makeEvent(this.o.kp, { ...f, ws: this.o.code });
    this.events.set(e.id, e);
    this.o.store.save([e]);
    if (!this.peers.size) this.queued.add(e.id);
    this.schedule([e]);
    this.broadcast([e]);
    return e;
  }

  private broadcast(evs: Ev[]) {
    if (!this.act) return;
    const pub = evs.filter((e) => !e.to);
    if (pub.length) this.act.ev.send(pub);
    for (const e of evs.filter((x) => x.to)) {
      const t = this.peerIdsFor([e.a, e.to!]);
      if (t.length) this.act.ev.send([e], { target: t });
    }
  }

  private receive(evs: Ev[], peerId: string) {
    if (!this.peers.has(peerId) || !Array.isArray(evs)) return;
    const fresh: Ev[] = [];
    const now = Date.now();
    for (const e of evs) {
      if (!e || this.events.has(e.id) || e.ws !== this.o.code) continue;
      if (e.to && e.a !== this.me && e.to !== this.me) continue;
      if (e.ts > now + FUTURE_SKEW_MS) continue;
      if (!verifyEvent(e)) continue;
      this.events.set(e.id, e);
      fresh.push(e);
    }
    if (fresh.length) { this.o.store.save(fresh); this.schedule(fresh); }
  }

  private sendEvents(evs: Ev[], peerId: string) {
    for (let i = 0; i < evs.length; i += 100) this.act?.ev.send(evs.slice(i, i + 100), { target: peerId });
  }

  private visibleFor(pub: string): Ev[] {
    const out: Ev[] = [];
    for (const e of this.events.values()) if (visibleTo(e, pub)) out.push(e);
    return out;
  }

  private onSync(m: any, peerId: string) {
    const who = this.peers.get(peerId);
    if (!who || !m || !this.act) return;
    const vis = this.visibleFor(who.pub);
    if (m.k === 'sum') {
      const days = diffDays(summarize(vis), (m.s || {}) as Summary);
      if (days.length) this.act.sync.send({ k: 'ids', d: idsByDays(vis, days) }, { target: peerId });
    } else if (m.k === 'ids') {
      const { want, give } = reconcile(vis, m.d || {}, (id) => this.events.has(id));
      if (want.length) this.act.sync.send({ k: 'want', ids: want }, { target: peerId });
      this.sendEvents(give.map((id) => this.events.get(id)!).filter(Boolean), peerId);
    } else if (m.k === 'want' && Array.isArray(m.ids)) {
      const out = m.ids.map((id: string) => this.events.get(id)).filter((e: Ev | undefined): e is Ev => !!e && visibleTo(e, who.pub));
      this.sendEvents(out, peerId);
    }
  }

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
    this.act?.pres.send(this.myPresence);
  }

  setHuddle(h: Partial<HuddleState>) {
    this.myHuddle = { ...this.myHuddle, ...h };
    this.act?.hud.send(this.myHuddle);
  }

  requestBlob(id: string) { this.act?.fwant.send({ id }); }

  peerIdsFor(pubs: string[]): string[] {
    return [...this.peers].filter(([, v]) => pubs.includes(v.pub)).map(([k]) => k);
  }

  onlinePubs(): Set<string> {
    return new Set([this.me, ...[...this.peers.values()].map((p) => p.pub)]);
  }
}

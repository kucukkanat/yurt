import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools/core';
import type { Ev } from '../types';
import type { DataLink, LinkHost, Presence } from '../transport';
import { sign, verify } from '../crypto';
import { open, seal, workspaceKeys, type WsKeys } from '../seal';

export const KIND_EVENT = 4344;     // regular: relays store it
export const KIND_PRESENCE = 24344; // ephemeral: relays forward it, never store it

const BEAT_MS = 60_000;
const PRESENCE_TTL_MS = 150_000;
const RETRY_MS = 15_000;
const PAGE = 500;
// created_at is backdated by a random 0–2 h so relay dumps don't show precise activity times.
// (A relay operator still sees when events arrive.)
const FUZZ_S = 7_200;
// Nostr created_at is the sender's (fuzzed, possibly skewed) clock. Re-fetching a day before our
// last sync mark covers both; duplicates are dropped by event id.
const SKEW_S = 86_400;

export interface NostrOpts {
  key: string;
  relays: readonly string[];
  /** Unix seconds of the last completed backfill (0 = fetch full history). */
  mark: number;
  saveMark(sec: number): void;
}

const parse = (s: string | null): unknown => { if (s === null) return null; try { return JSON.parse(s); } catch { return null; } };
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const now = () => Math.floor(Date.now() / 1000);
const fuzzed = () => now() - Math.floor(Math.random() * FUZZ_S);
const presMsg = (code: string, t: number, j: string) => `yurt-pres:${code}:${t}:${j}`;

/**
 * Events and presence through Nostr relays, end-to-end encrypted with the workspace key.
 * What a relay sees: an opaque tag, ciphertext, timestamps and a throwaway per-session pubkey.
 * Private events are additionally sealed with the pair's X25519 key, so other members can't read them.
 */
export class NostrData implements DataLink {
  readonly presence = new Map<string, Presence>(); // keyed by the sender's session pubkey
  private seen = new Map<string, number>();
  private pool = new SimplePool({ enableReconnect: true });
  private sk = generateSecretKey();
  private self = getPublicKey(this.sk);
  private k: WsKeys;
  private relays: string[];
  private pending = new Map<string, NostrEvent[]>();
  /** Yurt event ids we've seen come back from a relay. */
  private onRelay = new Set<string>();
  private me: Presence | null = null;
  private timers: ReturnType<typeof setInterval>[];
  private closeSub: () => void;
  private tags: string[];
  private mark: number;
  private wasConnected = false;
  private needSync = true;
  private syncing = false;

  constructor(private host: LinkHost, private o: NostrOpts) {
    this.k = workspaceKeys(o.key);
    this.relays = [...o.relays];
    this.tags = [this.k.tag, this.k.inbox(host.kp.pub)];
    this.mark = o.mark;
    // Live first, then backfill, so nothing published in between slips through the gap.
    const sub = this.pool.subscribe(this.relays, { kinds: [KIND_EVENT, KIND_PRESENCE], '#y': this.tags, since: now() - FUZZ_S - 60 }, { onevent: (e) => this.onNostr(e) });
    this.closeSub = () => sub.close();
    void this.backfill();
    this.timers = [
      // Heartbeats only while the member is actually here, or needs the WebRTC room.
      setInterval(() => { if (this.me && (this.me.st === 'online' || this.me.rtc || this.me.bridge)) this.publishPresence(); }, BEAT_MS),
      setInterval(() => { for (const [id, e] of this.pending) this.publish(id, e); }, RETRY_MS),
      setInterval(() => this.sweep(), 5_000),
    ];
  }

  get connected() { return [...this.pool.listConnectionStatus().values()].some(Boolean); }

  send(evs: readonly Ev[]) {
    for (const e of evs) {
      const nes = e.to ? this.wrapPrivate(e) : [this.wrap(KIND_EVENT, this.k.tag, seal(this.k.enc, this.k.tag, JSON.stringify(e)))];
      this.pending.set(e.id, nes);
      this.publish(e.id, nes);
    }
  }

  setPresence(p: Presence) {
    this.me = p;
    this.publishPresence();
  }

  leave() {
    this.timers.forEach(clearInterval);
    this.closeSub();
    this.pool.destroy();
    this.presence.clear();
  }

  private wrap(kind: number, tag: string, content: string, sk = this.sk): NostrEvent {
    return finalizeEvent({ kind, created_at: fuzzed(), tags: [['y', tag]], content }, sk);
  }

  // Inner layer: only author and recipient hold the pair key. Outer layer: `a`/`to` tell a
  // recipient (or the author's other device) which pair key to use; only members can read it.
  // One copy per inbox, each signed by a one-off key: a relay can't link the two inboxes as a
  // pair, or tie the DM to this session's other traffic (arrival timing remains).
  private wrapPrivate(e: Ev): NostrEvent[] {
    const { a, to } = e;
    const other = a === this.host.kp.pub ? to : a;
    if (!to || !other) throw new Error('private event without a recipient');
    const pair = this.k.pair(this.host.kp.sec, other);
    return [...new Set([to, a])].map((who) => {
      const tag = this.k.inbox(who);
      return this.wrap(KIND_EVENT, tag, seal(this.k.enc, this.k.tag, JSON.stringify({ a, to, c: seal(pair, this.k.tag, JSON.stringify(e)) })), generateSecretKey());
    });
  }

  private publish(id: string, nes: NostrEvent[]) {
    Promise.all(nes.map((ne) => Promise.any(this.pool.publish(this.relays, ne)))).then(
      () => { this.onRelay.add(id); if (this.pending.delete(id)) this.host.delivered([id]); },
      // While offline every relay fails; only a reachable relay refusing it is worth reporting.
      (err: unknown) => this.connected && this.host.error(`No relay accepted event ${id}: ${err instanceof AggregateError ? err.errors.map(String).join('; ') : String(err)}`),
    );
  }

  private publishPresence() {
    if (!this.me) return;
    const t = Date.now();
    const j = JSON.stringify(this.me);
    const body = JSON.stringify({ j, t, s: sign(this.host.kp.sec, presMsg(this.host.code, t, j)) });
    // Presence is best effort: a missed heartbeat is covered by the next one.
    Promise.any(this.pool.publish(this.relays, this.wrap(KIND_PRESENCE, this.k.tag, seal(this.k.enc, this.k.tag, body)))).catch(() => {});
  }

  /** Page backwards from now to the last mark. Runs at start and again whenever relays come back. */
  private async backfill() {
    if (this.syncing) return;
    this.syncing = true;
    const started = now();
    const since = Math.max(0, this.mark - SKEW_S);
    let until = started;
    for (;;) {
      const evs = await this.pool.querySync(this.relays, { kinds: [KIND_EVENT], '#y': this.tags, since, until, limit: PAGE }, { maxWait: 10_000 });
      evs.forEach((e) => this.onNostr(e));
      if (evs.length < PAGE) break;
      const oldest = Math.min(...evs.map((e) => e.created_at));
      until = oldest < until ? oldest : until - 1;
      if (until < since) break;
    }
    this.syncing = false;
    if (!this.connected) return;
    // My own recent events the relays don't have, e.g. the app closed before any relay acked them.
    const me = this.host.kp.pub;
    const lost = [...this.host.events.values()].filter((e) => e.a === me && e.ts / 1000 >= since && !this.onRelay.has(e.id) && !this.pending.has(e.id));
    if (lost.length) this.send(lost);
    this.needSync = false;
    this.mark = started;
    this.o.saveMark(started);
  }

  private onNostr(ne: NostrEvent) {
    if (ne.pubkey === this.self) return;
    const outer = parse(open(this.k.enc, this.k.tag, ne.content));
    if (ne.kind === KIND_PRESENCE) return this.onPresence(ne.pubkey, outer);
    if (isObj(outer) && typeof outer.a === 'string' && typeof outer.to === 'string' && typeof outer.c === 'string') {
      const me = this.host.kp.pub;
      if (outer.a !== me && outer.to !== me) return;
      return this.accept(parse(open(this.k.pair(this.host.kp.sec, outer.a === me ? outer.to : outer.a), this.k.tag, outer.c)));
    }
    this.accept(outer);
  }

  private accept(e: unknown) {
    if (isObj(e) && typeof e.id === 'string') this.onRelay.add(e.id);
    this.host.receive([e]);
  }

  private onPresence(session: string, m: unknown) {
    if (!isObj(m) || typeof m.j !== 'string' || typeof m.t !== 'number' || typeof m.s !== 'string') return;
    if (Math.abs(Date.now() - m.t) > PRESENCE_TTL_MS) return; // stale or replayed
    const p = parse(m.j);
    if (!isObj(p) || typeof p.pub !== 'string' || !verify(p.pub, presMsg(this.host.code, m.t, m.j), m.s)) return;
    this.presence.set(session, p as unknown as Presence);
    this.seen.set(session, Date.now());
    this.host.changed();
  }

  private sweep() {
    const up = this.connected;
    let dirty = up !== this.wasConnected;
    if (!up) this.needSync = true;
    else if (this.needSync) void this.backfill();
    this.wasConnected = up;
    for (const [s, at] of this.seen) if (Date.now() - at > PRESENCE_TTL_MS) { this.seen.delete(s); this.presence.delete(s); dirty = true; }
    if (dirty) this.host.changed();
  }
}

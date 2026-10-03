import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import type { Event as NostrEvent } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import type { Ev } from '../types';
import type { DataLink, LinkHost, LinkKeys, LinkTiming, Presence } from '../transport';
import { sign, verify } from '../crypto';
import { open, seal, workspaceKeys, type WsKeys } from '../seal';
import { errMsg } from '../util';
import { lobbyEvent } from '../join';
import { PresenceEnvelopeSchema, PresenceSchema, PrivateWrapperSchema, isRecord, parseBody, parseOr } from '../schemas';

export const KIND_EVENT = 4344; // regular: relays store it
const KIND_PRESENCE = 24344; // ephemeral: relays forward it, never store it

const TIMING: LinkTiming = { beatMs: 60_000, presenceTtlMs: 150_000, retryMs: 15_000, sweepMs: 5_000 };
const PAGE = 500;
// A relay that answered "no" to the same event this often will keep saying it; stop and tell the user.
const MAX_REFUSALS = 3;
// created_at is backdated by a random 0–2 h so relay dumps don't show precise activity times.
// (A relay operator still sees when events arrive.)
export const FUZZ_S = 7_200;
// Nostr created_at is the sender's (fuzzed, possibly skewed) clock. Re-fetching a day before our
// last sync mark covers both; duplicates are dropped by event id.
const SKEW_S = 86_400;
// nostr-tools' close reason when a relay answered a query to the end (EOSE); anything else means it didn't.
export const EOSE = 'closed automatically on eose';

export interface NostrOpts {
  keys: LinkKeys;
  relays: readonly string[];
  /** Unix seconds of the last completed backfill (0 = fetch full history). */
  mark: number;
  saveMark(sec: number): void;
  /** This member's presence, published from the start. */
  presence: Presence;
  timing?: Partial<LinkTiming> | undefined;
}

/** A pool whose relays reconnect after `reconnectMs` when it's given, instead of after nostr-tools' backoff. */
class Pool extends SimplePool {
  constructor(private reconnectMs: number | undefined) {
    super({ enableReconnect: true });
  }

  // Every relay the pool uses passes through here, and reconnect() reads the backoff only once a connection drops.
  override async ensureRelay(...args: Parameters<SimplePool['ensureRelay']>) {
    const r = await super.ensureRelay(...args);
    if (this.reconnectMs !== undefined) r.resubscribeBackoff = [this.reconnectMs];
    return r;
  }
}

const parse = (s: string | null): unknown => {
  if (s === null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const now = () => Math.floor(Date.now() / 1000);
const fuzzed = () => now() - Math.floor(Math.random() * FUZZ_S);
const presMsg = (code: string, t: number, j: string) => `yurt-pres:${code}:${t}:${j}`;

/**
 * Whether a relay's rejection is a refusal. NIP-01 makes `OK false` carry a machine-readable prefix
 * ("blocked: …"); connection failures and timeouts have none. "rate-limited" passes, so it isn't one.
 */
const isRefusal = (reason: unknown): reason is Error => reason instanceof Error && /^[a-z-]+:/.test(reason.message) && !reason.message.startsWith('rate-limited:');
const rejected = (r: PromiseSettledResult<unknown>): r is PromiseRejectedResult => r.status === 'rejected';

/**
 * Events and presence through Nostr relays, end-to-end encrypted with the workspace key. After key
 * rotations a member holds several keys: it reads with all of them (each has its own tags) and
 * writes with the newest.
 * What a relay sees: an opaque tag, ciphertext, timestamps and a throwaway per-session pubkey.
 * Private events are additionally sealed with the pair's X25519 key, so other members can't read them.
 */
export class NostrData implements DataLink {
  readonly presence = new Map<string, Presence>(); // keyed by the sender's session pubkey
  private seen = new Map<string, number>();
  private pool: Pool;
  private sk = generateSecretKey();
  private self = getPublicKey(this.sk);
  /** The key new events are sealed with. */
  private k: WsKeys;
  /** Every tag I listen on → the key its events are sealed with. */
  private byTag = new Map<string, WsKeys>();
  /** Lobby tags of the invites I watch for join requests → their join key. */
  private lobby = new Map<string, string>();
  private epochs = new Map<WsKeys, number>();
  private relays: string[];
  /** Events still being retried, as their wrapped copies. */
  private pending = new Map<string, NostrEvent[]>();
  private refused = new Map<string, number>();
  /** Given up on after repeated refusals: still queued for the UI, but not retried or re-sent. */
  private abandoned = new Set<string>();
  /** Yurt event ids we've seen come back from a relay. */
  private onRelay = new Set<string>();
  private me: Presence;
  private timing: LinkTiming;
  private timers: ReturnType<typeof setInterval>[];
  private closeSub: () => void = () => {};
  private mark: number;
  private wasConnected = false;
  private needSync = true;
  private syncing = false;
  private closed = false;
  // A refused heartbeat is reported once, not every minute.
  private presenceRefused = false;

  constructor(
    private host: LinkHost,
    private o: NostrOpts,
  ) {
    this.k = this.adoptKeys(o.keys);
    this.relays = [...o.relays];
    this.mark = o.mark;
    this.me = o.presence;
    const t = { ...TIMING, ...o.timing };
    this.timing = t;
    this.pool = new Pool(t.reconnectMs);
    // Live first, then backfill, so nothing published in between slips through the gap.
    this.subscribe();
    void this.backfill();
    this.publishPresence();
    this.timers = [
      // Heartbeats only while the member is actually here, or needs the WebRTC room.
      setInterval(() => {
        if (this.me.st === 'online' || this.me.rtc || this.me.bridge) this.publishPresence();
      }, t.beatMs),
      setInterval(() => {
        for (const [id, e] of this.pending) this.publish(id, e);
      }, t.retryMs),
      setInterval(() => this.sweep(), t.sweepMs),
    ];
  }

  private get tags() {
    return [...this.byTag.keys(), ...this.lobby.keys()];
  }

  /** Listens on every key's tags and returns the write key's derived keys (`write` is always one of `all`). */
  private adoptKeys(keys: LinkKeys): WsKeys {
    this.byTag.clear();
    this.epochs.clear();
    this.lobby = new Map(keys.lobby.map((jk) => [workspaceKeys(jk).tag, jk]));
    for (const { key, epoch } of keys.all) {
      const k = workspaceKeys(key);
      this.byTag.set(k.tag, k).set(k.inbox(this.host.kp.pub), k);
      this.epochs.set(k, epoch ?? 0);
    }
    return workspaceKeys(keys.write);
  }

  private subscribe() {
    this.closeSub();
    const sub = this.pool.subscribe(this.relays, { kinds: [KIND_EVENT, KIND_PRESENCE], '#y': this.tags, since: now() - FUZZ_S - 60 }, { onevent: (e) => this.onNostr(e) });
    this.closeSub = () => sub.close();
  }

  /** A rotation or a new invite: listen on the new tags too, and fetch their whole history (they're new to me). */
  setKeys(keys: LinkKeys) {
    const before = new Set(this.tags);
    this.k = this.adoptKeys(keys);
    const added = this.tags.filter((t) => !before.has(t));
    if (!added.length || this.closed) return;
    this.subscribe();
    void this.reporting(Promise.all(this.relays.map((url) => this.pageRelay(url, 0, now(), added))));
  }

  /** Background relay work: a failure is reported to the user, never left as an unhandled rejection. */
  private async reporting(work: Promise<unknown>) {
    try {
      await work;
    } catch (err) {
      this.host.error(`Relay sync failed: ${errMsg(err)}`);
    }
  }

  get connected() {
    return [...this.relayStatus().values()].some(Boolean);
  }

  /** Each of this workspace's relays → whether it's connected now (the pool may also hold others). */
  relayStatus(): ReadonlyMap<string, boolean> {
    const s = this.pool.listConnectionStatus();
    return new Map(this.relays.map((u) => [u, s.get(normalizeURL(u)) ?? false]));
  }

  send(evs: readonly Ev[]) {
    for (const e of evs) {
      const nes = e.to ? this.wrapPrivate(e, e.to) : this.sealFor(e).map((k) => this.wrap(KIND_EVENT, k.tag, seal(k.enc, k.tag, JSON.stringify(e))));
      this.abandoned.delete(e.id);
      this.refused.delete(e.id);
      this.pending.set(e.id, nes);
      this.publish(e.id, nes);
    }
  }

  /** Hands an admitted joiner the key: a sealed grant (see join.ts) in their lobby inbox, retried like events. */
  grant(jk: string, to: string, content: string) {
    const id = 'grant:' + to;
    const nes = [lobbyEvent(workspaceKeys(jk).inbox(to), content)];
    this.pending.set(id, nes);
    this.publish(id, nes);
  }

  setPresence(p: Presence) {
    this.me = p;
    this.publishPresence();
  }

  leave() {
    this.closed = true;
    this.timers.forEach(clearInterval);
    this.closeSub();
    this.pool.destroy();
    this.presence.clear();
  }

  // Everything goes out under the write key. A rekey also goes out under the key it replaces, so current
  // members get it, and under the new one, so someone joining later with the new key finds its history.
  private sealFor(e: Ev): WsKeys[] {
    const epoch = e.t === 'rekey' ? parseBody('rekey', e.b)?.epoch : undefined;
    const ks = [...this.epochs].filter(([, n]) => n === epoch || n === (epoch ?? 0) - 1).map(([k]) => k);
    // Derived keys are compared by tag: the write key is derived separately from the ring's copy.
    return [...new Map([this.k, ...ks].map((k) => [k.tag, k])).values()];
  }

  private wrap(kind: number, tag: string, content: string, sk = this.sk, createdAt = fuzzed()): NostrEvent {
    return finalizeEvent({ kind, created_at: createdAt, tags: [['y', tag]], content }, sk);
  }

  // Inner layer: only author and recipient hold the pair key. Outer layer: `a`/`to` tell a
  // recipient (or the author's other device) which pair key to use; only members can read it.
  // One copy per inbox, each signed by a one-off key: a relay can't link the two inboxes as a
  // pair, or tie the DM to this session's other traffic (arrival timing remains).
  // Only my own events are sent, so the other party is always the recipient.
  private wrapPrivate(e: Ev, to: string): NostrEvent[] {
    const { a } = e;
    const pair = this.k.pair(this.host.kp.sec, to);
    return [...new Set([to, a])].map((who) => {
      const tag = this.k.inbox(who);
      return this.wrap(KIND_EVENT, tag, seal(this.k.enc, this.k.tag, JSON.stringify({ a, to, c: seal(pair, this.k.tag, JSON.stringify(e)) })), generateSecretKey());
    });
  }

  // Every copy must land somewhere (a private event has one per inbox). Being offline is retried
  // quietly; reachable relays refusing it is retried MAX_REFUSALS times, then reported once.
  private publish(id: string, nes: NostrEvent[]) {
    void Promise.all(nes.map((ne) => Promise.allSettled(this.pool.publish(this.relays, ne)))).then((copies) => {
      // A copy landed if any relay took it; the event is delivered once every copy landed.
      const failed = copies.filter((rs) => !rs.some((r) => r.status === 'fulfilled'));
      if (!failed.length) {
        this.onRelay.add(id);
        this.refused.delete(id);
        this.pending.delete(id);
        this.host.delivered([id]);
        return;
      }
      const why = failed
        .flat()
        .filter(rejected)
        .map((r) => r.reason)
        .filter(isRefusal)
        .map((err) => err.message);
      if (!why.length || !this.pending.has(id)) return;
      const n = (this.refused.get(id) ?? 0) + 1;
      this.refused.set(id, n);
      if (n < MAX_REFUSALS) return;
      this.pending.delete(id);
      this.refused.delete(id);
      this.abandoned.add(id);
      this.host.error(`Relays refused event ${id}, giving up: ${[...new Set(why)].join('; ')}`);
    });
  }

  private publishPresence() {
    const t = Date.now();
    const j = JSON.stringify(this.me);
    const body = JSON.stringify({ j, t, s: sign(this.host.kp.sec, presMsg(this.host.code, t, j)) });
    // Not backdated: relays refuse ephemeral events more than about a minute old ("ephemeral event expired"), and
    // they don't store them, so arrival time is all an operator learns either way.
    const ne = this.wrap(KIND_PRESENCE, this.k.tag, seal(this.k.enc, this.k.tag, body), this.sk, now());
    // Best effort: a missed heartbeat is covered by the next one. Being offline is quiet; every relay refusing is
    // reported once, since then nobody can see this member online.
    void Promise.allSettled(this.pool.publish(this.relays, ne)).then((rs) => {
      if (rs.some((r) => r.status === 'fulfilled') || this.presenceRefused) return;
      const why = rs
        .filter(rejected)
        .map((r) => r.reason)
        .filter(isRefusal)
        .map((e) => e.message);
      if (!why.length) return;
      this.presenceRefused = true;
      this.host.error(`Relays refused presence: ${[...new Set(why)].join('; ')}`);
    });
  }

  /** Page backwards from now to the last mark. Runs at start and again whenever relays come back. */
  private async backfill() {
    if (this.syncing) return;
    this.syncing = true;
    await this.reporting(this.syncHistory());
    this.syncing = false;
  }

  private async syncHistory() {
    const started = now();
    const since = Math.max(0, this.mark - SKEW_S);
    const results = await Promise.all(this.relays.map((url) => this.pageRelay(url, since, started, this.tags)));
    // The mark only moves once every reachable relay was read to the end; otherwise the next
    // backfill (sweep retries while needSync) would skip what we didn't get to.
    if (this.closed || results.includes('partial') || !results.includes('done')) return;
    // My own recent events the relays don't have, e.g. the app closed before any relay acked them.
    // created_at is backdated up to FUZZ_S, so only events newer than since + FUZZ_S surely came back.
    const me = this.host.kp.pub;
    const lost = [...this.host.events.values()].filter(
      (e) => e.a === me && e.ts / 1000 >= since + FUZZ_S && !this.onRelay.has(e.id) && !this.pending.has(e.id) && !this.abandoned.has(e.id),
    );
    if (lost.length) this.send(lost);
    this.needSync = false;
    this.mark = started;
    this.o.saveMark(started);
  }

  /**
   * Reads one relay's history back to `since`. Each relay is paged on its own cursor: merged pages
   * can't tell which relay ran out. Relays may cap `limit` below PAGE, so a short page doesn't mean
   * done; a relay is done when a page brings nothing new.
   */
  private async pageRelay(url: string, since: number, until: number, tags: string[]): Promise<'done' | 'down' | 'partial'> {
    const got = new Set<string>();
    for (let first = true; ; first = false) {
      // After leave() the pool is gone, so a query can't reach EOSE: it ends this loop as 'partial'.
      const evs = await this.query(url, { kinds: [KIND_EVENT], '#y': tags, since, until, limit: PAGE });
      if (!evs) return first ? 'down' : 'partial';
      const fresh = evs.filter((e) => !got.has(e.id));
      if (!fresh.length) return 'done';
      for (const e of fresh) {
        got.add(e.id);
        this.onNostr(e);
      }
      // Inclusive: more events may share the oldest second than fit on this page; `got` drops repeats.
      until = Math.min(until, ...evs.map((e) => e.created_at));
    }
  }

  /** One query to one relay; null when it couldn't be reached or closed the query early. */
  private query(url: string, filter: Filter): Promise<NostrEvent[] | null> {
    return new Promise((resolve) => {
      const evs: NostrEvent[] = [];
      this.pool.subscribeEose([url], filter, {
        maxWait: 10_000,
        onevent: (e) => evs.push(e),
        onclose: ([r]) => resolve(r?.reason === EOSE ? evs : null),
      });
    });
  }

  private onNostr(ne: NostrEvent) {
    try {
      this.handle(ne);
      /* v8 ignore start -- backstop for our own bugs: inputs that can throw are handled where they're parsed */
    } catch (err) {
      // Relay input is untrusted, but a throw here is our bug: surface it without losing the rest of the page.
      this.host.error(`Dropped a relay event: ${errMsg(err)}`);
    }
    /* v8 ignore stop */
  }

  private handle(ne: NostrEvent) {
    if (ne.pubkey === this.self) return;
    // Which key sealed it follows from the tag it was published under.
    // nostr-tools only delivers events matching our filter, so a `y` tag names one of my keys.
    const tag = String(ne.tags.find((t) => t[0] === 'y')?.[1]);
    const jk = this.lobby.get(tag);
    if (jk !== undefined) return this.host.joinRequest(jk, ne.content);
    const k = this.byTag.get(tag);
    /* v8 ignore next -- unreachable while nostr-tools applies the subscription filter (it does, client side) */
    if (!k) return;
    const outer = parse(open(k.enc, k.tag, ne.content));
    if (ne.kind === KIND_PRESENCE) return this.onPresence(ne.pubkey, outer);
    const wrapper = parseOr(PrivateWrapperSchema, outer);
    if (wrapper) {
      const me = this.host.kp.pub;
      if (wrapper.a !== me && wrapper.to !== me) return;
      const pair = this.pairWith(k, wrapper.a === me ? wrapper.to : wrapper.a);
      return pair ? this.accept(parse(open(pair, k.tag, wrapper.c))) : undefined;
    }
    this.accept(outer);
  }

  /** The pair key with `pub`, or null if it isn't a valid public key: any key holder can write the wrapper naming it. */
  private pairWith(k: WsKeys, pub: string): Uint8Array | null {
    if (!/^[0-9a-f]{64}$/.test(pub)) return null;
    try {
      return k.pair(this.host.kp.sec, pub);
    } catch {
      return null; // well-formed hex that isn't a curve point: foreign junk, like any unopenable event
    }
  }

  private accept(e: unknown) {
    // Marks "this event is on a relay" before validation; receive() still rejects it if it's bad.
    if (isRecord(e) && typeof e.id === 'string') this.onRelay.add(e.id);
    this.host.receive([e]);
  }

  private onPresence(session: string, raw: unknown) {
    const m = parseOr(PresenceEnvelopeSchema, raw);
    if (!m || Math.abs(Date.now() - m.t) > this.timing.presenceTtlMs) return; // stale or replayed
    const p = parseOr(PresenceSchema, parse(m.j));
    if (!p || !verify(p.pub, presMsg(this.host.code, m.t, m.j), m.s)) return;
    if (this.host.isBanned(p.pub)) return;
    this.presence.set(session, p);
    this.seen.set(session, Date.now());
    this.host.changed();
  }

  private sweep() {
    const up = this.connected;
    let dirty = up !== this.wasConnected;
    if (!up) this.needSync = true;
    else if (this.needSync) void this.backfill(); // never rejects: failures are reported inside
    this.wasConnected = up;
    for (const [s, at] of this.seen)
      if (Date.now() - at > this.timing.presenceTtlMs) {
        this.seen.delete(s);
        this.presence.delete(s);
        dirty = true;
      }
    if (dirty) this.host.changed();
  }
}

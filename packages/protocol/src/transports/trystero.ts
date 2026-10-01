import type { Ev } from '../types';
import type { TAction, TRoom } from '../peer';
import type { DataLink, LinkHost, Presence } from '../transport';
import { visibleTo } from '../events';
import { summarize, diffDays, idsByDays, reconcile, type Summary } from '../sync';
import { isObj } from '../util';

type SyncMsg = { k: 'sum'; s: Summary } | { k: 'ids'; d: Record<string, string[]> } | { k: 'want'; ids: string[] };

/**
 * Events and presence straight between online peers over the Trystero room. History exists
 * only on members' devices; peers reconcile it by day summaries when they meet (see sync.ts).
 * Nothing goes to, or is taken from, a peer whose key is banned.
 */
export class TrysteroData implements DataLink {
  readonly presence = new Map<string, Presence>();
  private ev: TAction<Ev[]>;
  private sync: TAction<SyncMsg>;
  private pres: TAction<Presence>;
  private me: Presence | null = null;
  private beat: ReturnType<typeof setInterval>;

  constructor(
    private host: LinkHost,
    room: TRoom,
  ) {
    this.ev = room.makeAction<Ev[]>('ev');
    this.sync = room.makeAction<SyncMsg>('sync');
    this.pres = room.makeAction<Presence>('pres');
    this.ev.onMessage = (evs, { peerId }) => {
      if (this.member(peerId)) host.receive(evs);
    };
    this.sync.onMessage = (m, { peerId }) => this.onSync(m, peerId);
    this.pres.onMessage = (p, { peerId }) => {
      const who = this.member(peerId);
      if (!who || !isObj(p) || p.pub !== who.pub) return;
      this.presence.set(peerId, p);
      host.changed();
    };
    this.beat = setInterval(() => this.me && this.broadcast(this.pres, this.me), 30_000);
  }

  get connected() {
    return this.targets(() => true).length > 0;
  }

  send(evs: readonly Ev[]) {
    const pub = evs.filter((e) => !e.to);
    const reached = pub.length && this.broadcast(this.ev, pub) ? pub.map((e) => e.id) : [];
    for (const e of evs) {
      if (!e.to) continue;
      const t = this.targets((p) => p === e.a || p === e.to);
      if (t.length) {
        this.ev.send([e], { target: t });
        reached.push(e.id);
      }
    }
    // A public event that reached any member spreads onwards through their syncs. A private one
    // only travels between its two parties, so it counts once the other one (or my other device) has it.
    if (reached.length) this.host.delivered(reached);
  }

  setPresence(p: Presence) {
    this.me = p;
    this.broadcast(this.pres, p);
  }

  onPeerJoin(peerId: string, pub: string) {
    // Count them as online right away; their own presence message refines it.
    this.presence.set(peerId, { pub, st: 'online' });
    this.sync.send({ k: 'sum', s: summarize(this.host.visibleFor(pub)) }, { target: peerId });
    if (this.me) this.pres.send(this.me, { target: peerId });
    // The sync just started hands them whatever of my queue they may see (public events, or
    // private ones they're a party to); nothing else in the queue got any closer to delivery.
    const { events, queued } = this.host;
    this.host.delivered(
      [...queued].filter((id) => {
        const e = events.get(id);
        return !!e && visibleTo(e, pub);
      }),
    );
  }

  onPeerLeave(peerId: string) {
    this.presence.delete(peerId);
  }

  leave() {
    clearInterval(this.beat);
    this.presence.clear();
  }

  /** The handshaked peer's identity, unless it's banned. */
  private member(peerId: string): { pub: string } | null {
    const who = this.host.peers.get(peerId);
    return who && !this.host.isBanned(who.pub) ? who : null;
  }

  private targets(want: (pub: string) => boolean): string[] {
    return [...this.host.peers].filter(([, v]) => !this.host.isBanned(v.pub) && want(v.pub)).map(([k]) => k);
  }

  /** Sends to every non-banned peer (never a room-wide broadcast); false if there was nobody to send to. */
  private broadcast<T>(act: TAction<T>, data: T): boolean {
    const t = this.targets(() => true);
    if (t.length) act.send(data, { target: t });
    return t.length > 0;
  }

  private sendEvents(evs: Ev[], peerId: string) {
    for (let i = 0; i < evs.length; i += 100) this.ev.send(evs.slice(i, i + 100), { target: peerId });
  }

  private onSync(m: unknown, peerId: string) {
    const who = this.member(peerId);
    if (!who || !isObj(m)) return;
    const { events } = this.host;
    const vis = this.host.visibleFor(who.pub);
    if (m.k === 'sum' && isObj(m.s)) {
      const days = diffDays(summarize(vis), m.s as Summary);
      if (days.length) this.sync.send({ k: 'ids', d: idsByDays(vis, days) }, { target: peerId });
    } else if (m.k === 'ids' && isObj(m.d)) {
      const { want, give } = reconcile(vis, m.d as Record<string, string[]>, (id) => events.has(id));
      if (want.length) this.sync.send({ k: 'want', ids: want }, { target: peerId });
      this.sendEvents(
        give.flatMap((id) => events.get(id) ?? []),
        peerId,
      );
    } else if (m.k === 'want' && Array.isArray(m.ids)) {
      this.sendEvents(
        m.ids.flatMap((id) => {
          const e = typeof id === 'string' ? events.get(id) : undefined;
          return e && visibleTo(e, who.pub) ? [e] : [];
        }),
        peerId,
      );
    }
  }
}

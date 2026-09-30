import type { Ev } from '../types';
import type { TAction, TRoom } from '../peer';
import type { DataLink, LinkHost, Presence } from '../transport';
import { visibleTo } from '../events';
import { summarize, diffDays, idsByDays, reconcile, type Summary } from '../sync';

type SyncMsg =
  | { k: 'sum'; s: Summary }
  | { k: 'ids'; d: Record<string, string[]> }
  | { k: 'want'; ids: string[] };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/**
 * Events and presence straight between online peers over the Trystero room. History exists
 * only on members' devices; peers reconcile it by day summaries when they meet (see sync.ts).
 */
export class TrysteroData implements DataLink {
  readonly presence = new Map<string, Presence>();
  private ev: TAction<Ev[]>;
  private sync: TAction<SyncMsg>;
  private pres: TAction<Presence>;
  private me: Presence | null = null;
  private beat: ReturnType<typeof setInterval>;

  constructor(private host: LinkHost, room: TRoom) {
    this.ev = room.makeAction<Ev[]>('ev');
    this.sync = room.makeAction<SyncMsg>('sync');
    this.pres = room.makeAction<Presence>('pres');
    this.ev.onMessage = (evs, { peerId }) => { if (host.peers.has(peerId)) host.receive(evs); };
    this.sync.onMessage = (m, { peerId }) => this.onSync(m, peerId);
    this.pres.onMessage = (p, { peerId }) => {
      const who = host.peers.get(peerId);
      if (!who || !isObj(p) || p.pub !== who.pub) return;
      this.presence.set(peerId, p);
      host.changed();
    };
    this.beat = setInterval(() => this.me && this.pres.send(this.me), 30_000);
  }

  get connected() { return this.host.peers.size > 0; }

  send(evs: readonly Ev[]) {
    const pub = evs.filter((e) => !e.to);
    if (pub.length) this.ev.send(pub);
    for (const e of evs) {
      if (!e.to) continue;
      const t = [...this.host.peers].filter(([, v]) => v.pub === e.a || v.pub === e.to).map(([k]) => k);
      if (t.length) this.ev.send([e], { target: t });
    }
    // Any connected peer takes part in sync, so it will relay these onwards to others later.
    if (this.connected) this.host.delivered(evs.map((e) => e.id));
  }

  setPresence(p: Presence) {
    this.me = p;
    this.pres.send(p);
  }

  onPeerJoin(peerId: string, pub: string) {
    // Count them as online right away; their own presence message refines it.
    this.presence.set(peerId, { pub, st: 'online' });
    this.sync.send({ k: 'sum', s: summarize(this.host.visibleFor(pub)) }, { target: peerId });
    if (this.me) this.pres.send(this.me, { target: peerId });
    this.host.delivered('all');
  }

  onPeerLeave(peerId: string) {
    this.presence.delete(peerId);
  }

  leave() {
    clearInterval(this.beat);
    this.presence.clear();
  }

  private sendEvents(evs: Ev[], peerId: string) {
    for (let i = 0; i < evs.length; i += 100) this.ev.send(evs.slice(i, i + 100), { target: peerId });
  }

  private onSync(m: unknown, peerId: string) {
    const who = this.host.peers.get(peerId);
    if (!who || !isObj(m)) return;
    const { events } = this.host;
    const vis = this.host.visibleFor(who.pub);
    if (m.k === 'sum' && isObj(m.s)) {
      const days = diffDays(summarize(vis), m.s as Summary);
      if (days.length) this.sync.send({ k: 'ids', d: idsByDays(vis, days) }, { target: peerId });
    } else if (m.k === 'ids' && isObj(m.d)) {
      const { want, give } = reconcile(vis, m.d as Record<string, string[]>, (id) => events.has(id));
      if (want.length) this.sync.send({ k: 'want', ids: want }, { target: peerId });
      this.sendEvents(give.flatMap((id) => events.get(id) ?? []), peerId);
    } else if (m.k === 'want' && Array.isArray(m.ids)) {
      this.sendEvents(m.ids.flatMap((id) => { const e = typeof id === 'string' ? events.get(id) : undefined; return e && visibleTo(e, who.pub) ? [e] : []; }), peerId);
    }
  }
}

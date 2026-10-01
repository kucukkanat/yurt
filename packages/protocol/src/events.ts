import type { Ev, UnsignedEv, EvType } from './types';
import { sha256hex, sign, verify, type KeyPair } from './crypto';

export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Stable JSON: sorted keys, undefined dropped. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canonical(x))).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

export function eventId(e: UnsignedEv): string {
  return sha256hex(canonical(e)).slice(0, 32);
}

export interface EventFields<B = any> { ws: string; t: EvType; b: B; ch?: string; to?: string; ag?: string; ts?: number }

// State is reduced in (ts, id) order, so two events in the same millisecond could apply out of
// order (a message before its channel). Handing out strictly increasing timestamps keeps
// everything created on this device in causal order.
let lastTs = 0;
const nextTs = () => (lastTs = Math.max(Date.now(), lastTs + 1));

export function makeEvent<B>(kp: KeyPair, f: EventFields<B>): Ev<B> {
  const base: UnsignedEv<B> = { ws: f.ws, t: f.t, a: kp.pub, ts: f.ts ?? nextTs(), b: f.b };
  if (f.ag) base.ag = f.ag;
  if (f.ch) base.ch = f.ch;
  if (f.to) base.to = f.to;
  const id = eventId(base);
  return { ...base, id, sig: sign(kp.sec, id) };
}

const EV_TYPES: ReadonlySet<string> = new Set<EvType>(['ws.create', 'profile', 'ch.create', 'ch.update', 'msg', 'edit', 'del', 'react', 'pin', 'role', 'ban', 'agent', 'approve', 'rekey']);
const optStr = (x: unknown) => x === undefined || typeof x === 'string';

/** Structural check for untrusted input: the fields reduce and sortEvents rely on have the right types. */
export function isEventShape(e: unknown): e is Ev {
  if (e === null || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.ws === 'string' && typeof o.t === 'string' && EV_TYPES.has(o.t)
    && typeof o.a === 'string' && typeof o.sig === 'string' && Number.isSafeInteger(o.ts)
    && optStr(o.ch) && optStr(o.to) && optStr(o.ag);
}

export function verifyEvent(e: unknown): e is Ev {
  if (!isEventShape(e)) return false;
  const { id, sig, ...rest } = e;
  if (eventId(rest) !== id) return false;
  return verify(e.a, id, sig);
}

/** Total order by (ts, id), given integer ts (see isEventShape). Sorts in place. */
export function sortEvents(evs: Ev[]): Ev[] {
  return evs.sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

export function visibleTo(e: Ev, pub: string): boolean {
  return !e.to || e.a === pub || e.to === pub;
}

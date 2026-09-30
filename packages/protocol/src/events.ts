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

export function verifyEvent(e: Ev): boolean {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.sig !== 'string') return false;
  const { id, sig, ...rest } = e;
  if (eventId(rest) !== id) return false;
  return verify(e.a, id, sig);
}

export function sortEvents(evs: Ev[]): Ev[] {
  return evs.sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

export function visibleTo(e: Ev, pub: string): boolean {
  return !e.to || e.a === pub || e.to === pub;
}

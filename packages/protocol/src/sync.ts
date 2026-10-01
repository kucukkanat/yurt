import type { Ev } from './types';

export const DAY_MS = 86_400_000;
export type Summary = Record<string, string>; // day → "count:xor"

export const dayOf = (ts: number) => String(Math.floor(ts / DAY_MS));

/** Cheap per-day fingerprint of a set of event ids. Two peers compare these first. */
export function summarize(evs: Pick<Ev, 'id' | 'ts'>[]): Summary {
  const acc = new Map<string, { n: number; x: number }>();
  for (const e of evs) {
    const d = dayOf(e.ts);
    const day = acc.get(d) ?? { n: 0, x: 0 };
    acc.set(d, { n: day.n + 1, x: (day.x ^ parseInt(e.id.slice(0, 8), 16)) >>> 0 });
  }
  const out: Summary = {};
  for (const [d, { n, x }] of acc) out[d] = n + ':' + x.toString(16);
  return out;
}

// One side of every comparison came off the wire, so only day-number keys count: never "__proto__" and friends.
const isDay = (d: string) => /^-?\d{1,15}$/.test(d);
const own = <T>(o: Readonly<Record<string, T>>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

export function diffDays(a: Summary, b: Summary): string[] {
  const days = new Set([...Object.keys(a), ...Object.keys(b)].filter(isDay));
  return [...days].filter((d) => own(a, d) !== own(b, d));
}

export function idsByDays(evs: Pick<Ev, 'id' | 'ts'>[], days: string[]): Record<string, string[]> {
  const want = new Map(days.filter(isDay).map((d): [string, string[]] => [d, []]));
  for (const e of evs) want.get(dayOf(e.ts))?.push(e.id);
  return Object.fromEntries(want);
}

/**
 * Given the other side's ids for some days (parsed by SyncMsgSchema), what do I lack (ids to ask
 * for) and what do they lack (my events to send)?
 */
export function reconcile<E extends Pick<Ev, 'id' | 'ts'>>(mine: E[], theirs: Readonly<Record<string, readonly string[]>>, known: (id: string) => boolean) {
  const days = new Set(Object.keys(theirs).filter(isDay));
  const theirIds = new Set(Object.entries(theirs).flatMap(([d, ids]) => (days.has(d) ? ids : [])));
  const mineOnDays = mine.filter((e) => days.has(dayOf(e.ts)));
  const myIds = new Set(mineOnDays.map((e) => e.id));
  return {
    want: [...theirIds].filter((id) => !myIds.has(id) && !known(id)),
    give: mineOnDays.filter((e) => !theirIds.has(e.id)),
  };
}

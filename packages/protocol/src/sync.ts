import type { Ev } from './types';

export const DAY_MS = 86_400_000;
export type Summary = Record<string, string>; // day → "count:xor"

export const dayOf = (ts: number) => String(Math.floor(ts / DAY_MS));

/** Cheap per-day fingerprint of a set of event ids. Two peers compare these first. */
export function summarize(evs: Pick<Ev, 'id' | 'ts'>[]): Summary {
  const acc: Record<string, [number, number]> = {};
  for (const e of evs) {
    const d = dayOf(e.ts);
    const x = acc[d] || (acc[d] = [0, 0]);
    x[0]++;
    x[1] = (x[1] ^ parseInt(e.id.slice(0, 8), 16)) >>> 0;
  }
  const out: Summary = {};
  for (const d in acc) out[d] = acc[d][0] + ':' + acc[d][1].toString(16);
  return out;
}

export function diffDays(a: Summary, b: Summary): string[] {
  const days = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...days].filter((d) => a[d] !== b[d]);
}

export function idsByDays(evs: Pick<Ev, 'id' | 'ts'>[], days: string[]): Record<string, string[]> {
  const want = new Set(days);
  const out: Record<string, string[]> = {};
  for (const d of days) out[d] = [];
  for (const e of evs) { const d = dayOf(e.ts); if (want.has(d)) out[d].push(e.id); }
  return out;
}

/** Given the other side's ids for some days, what do I lack and what do they lack? */
export function reconcile(mine: Pick<Ev, 'id' | 'ts'>[], theirs: Record<string, string[]>, known: (id: string) => boolean) {
  const days = Object.keys(theirs);
  const mineBy = idsByDays(mine, days);
  const want: string[] = [];
  const give: string[] = [];
  for (const d of days) {
    const t = new Set(theirs[d]);
    const m = new Set(mineBy[d]);
    for (const id of t) if (!m.has(id) && !known(id)) want.push(id);
    for (const id of m) if (!t.has(id)) give.push(id);
  }
  return { want, give };
}

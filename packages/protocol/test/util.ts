// Test utilities shared by the protocol, bridge and e2e suites: real implementations, not mocks.
import { makeEvent, type Ev, type EvType, type KeyPair, type PeerStore } from '../src';

/** Polls `cond` until it holds; fails with `what` after `ms`. */
export async function until(cond: () => boolean, ms = 10_000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** In-memory PeerStore: one per simulated device. `mark()` reads the sync mark it saved last. */
export function memStore(opts: { initial?: Ev[] | undefined; mark?: number | undefined; blobs?: Map<string, ArrayBuffer> | undefined } = {}) {
  const evs = new Map<string, Ev>((opts.initial ?? []).map((e) => [e.id, e]));
  const blobs = opts.blobs ?? new Map<string, ArrayBuffer>();
  let mark = opts.mark ?? 0;
  const store: PeerStore = {
    getBlob: async (id) => blobs.get(id) ?? null,
    putBlob: async (id, b) => {
      blobs.set(id, b);
    },
    load: async () => [...evs.values()],
    save: async (xs) => {
      for (const e of xs) evs.set(e.id, e);
    },
    loadMark: async () => mark,
    saveMark: async (_ws, s) => {
      mark = s;
    },
  };
  return { store, mark: () => mark };
}

/** Signs events for workspace `ws` on a fake clock that moves 1 s per event; `later(ms)` jumps it ahead. */
export function eventClock(ws: string) {
  let clock = 1_700_000_000_000;
  const ev = (kp: KeyPair, t: EvType, b: unknown, extra: { ch?: string; to?: string; ag?: string; ts?: number } = {}) => {
    clock += 1000;
    return makeEvent(kp, { ws, t, b, ts: clock, ...extra });
  };
  return {
    ev,
    later: (ms: number) => {
      clock += ms;
    },
  };
}

/** The usual starting workspace: Ada creates "Northwind" with #general, and both Ada and Bo have profiles. */
export function northwind(ev: ReturnType<typeof eventClock>['ev'], ada: KeyPair, bo: KeyPair): Ev[] {
  return [
    ev(ada, 'ws.create', { name: 'Northwind' }),
    ev(ada, 'ch.create', { id: 'general', name: 'general' }),
    ev(ada, 'profile', { name: 'Ada', handle: 'ada' }),
    ev(bo, 'profile', { name: 'Bo', handle: 'bo' }),
  ];
}

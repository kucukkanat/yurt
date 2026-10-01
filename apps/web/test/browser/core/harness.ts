import { vi } from 'vitest';
import type { NetHandlers } from '../../../src/lib/net';
import type { RemoteApi } from './remote';

/** Deletes the app's IndexedDB, so each test file starts as a first visit. Call before the store touches it. */
export function resetDb(): Promise<void> {
  return new Promise((res, rej) => {
    const r = indexedDB.deleteDatabase('yurt');
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('the yurt database is still open'));
  });
}

/** Waits for `cond` (polling), failing with `what` after `ms`. */
export const until = (cond: () => boolean, what = 'condition', ms = 15_000) =>
  vi.waitFor(
    () => {
      if (!cond()) throw new Error('timed out waiting for ' + what);
    },
    { timeout: ms, interval: 25 },
  );

/** A second member: real WorkspacePeers in their own iframe (own Trystero, own peer id). */
export async function openRemote(): Promise<RemoteApi> {
  const f = document.createElement('iframe');
  f.title = 'remote member';
  f.allow = 'camera; microphone';
  document.body.append(f);
  const w = f.contentWindow as (Window & { __remote?: RemoteApi }) | null;
  if (!w) throw new Error('no iframe window');
  const s = w.document.createElement('script');
  s.type = 'module';
  s.src = new URL('/test/browser/core/remote.ts', location.origin).href;
  w.document.head.append(s);
  await until(() => !!w.__remote, 'the remote member to load');
  const api = w.__remote;
  if (!api) throw new Error('remote member failed to load');
  return api;
}

/** Connection callbacks that ignore everything, for tests that only need a live peer. */
export const quiet = (): NetHandlers => ({
  onState: () => {},
  onPeers: () => {},
  onCreator: () => {},
  onKey: () => {},
  onBlob: () => {},
  onBlobProgress: () => {},
  onJoinError: () => {},
  onError: () => {},
});

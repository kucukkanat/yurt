import type { Ev, PeerStore } from '@yurt/protocol';
import { loadBlob, loadEvents, loadMark } from './stored';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('yurt', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('events', { keyPath: 'id' }).createIndex('ws', 'ws');
      d.createObjectStore('blobs');
    };
    r.onsuccess = () => {
      const d = r.result;
      // Another tab upgrading (a newer app version) or deleting the database waits for every open connection to
      // close; holding ours would block it forever. Close, and reopen on the next read or write.
      d.onversionchange = () => {
        d.close();
        dbp = null;
      };
      res(d);
    };
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

/**
 * Resolves when `t` commits. Rejects when it fails, including a failure at commit time (disk full, quota),
 * which only fires `abort`: listening for `error` alone would leave the caller waiting forever.
 */
function settle(t: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    t.oncomplete = () => res();
    /* istanbul ignore next -- needs a failing disk or quota; tests can't make IndexedDB fail a commit */
    const fail = () => rej(t.error ?? new Error('IndexedDB transaction aborted'));
    t.onerror = fail;
    t.onabort = fail;
  });
}

/** Runs `fn` in a transaction on `store` and resolves once it commits: with the request's result for reads, nothing for writes. */
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => T): Promise<T> {
  const t = (await open()).transaction(store, mode);
  const out = fn(t.objectStore(store));
  await settle(t);
  return out;
}

const read = <T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => tx(store, 'readonly', fn).then((req) => req.result);
const write = (store: string, fn: (s: IDBObjectStore) => void): Promise<void> => tx(store, 'readwrite', fn);

export const kv = {
  /** Whatever is stored under `k`, unchecked: callers parse it (see stored.ts). */
  get: (k: string) => read<unknown>('kv', (s) => s.get(k)),
  set: (k: string, v: unknown) =>
    write('kv', (s) => {
      s.put(v, k);
    }),
  del: (k: string) =>
    write('kv', (s) => {
      s.delete(k);
    }),
  clear: () =>
    write('kv', (s) => {
      s.clear();
    }),
};

export const eventsDb = {
  byWs: (ws: string): Promise<Ev[]> => read<unknown[]>('events', (s) => s.index('ws').getAll(ws)).then(loadEvents),
  put: (evs: Ev[]) =>
    write('events', (s) => {
      for (const e of evs) s.put(e);
    }),
  clear: () =>
    write('events', (s) => {
      s.clear();
    }),
  deleteWs: async (ws: string) => {
    const t = (await open()).transaction('events', 'readwrite');
    const req = t.objectStore('events').index('ws').openKeyCursor(IDBKeyRange.only(ws));
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        t.objectStore('events').delete(c.primaryKey);
        c.continue();
      }
    };
    await settle(t);
  },
};

export const blobsDb = {
  get: (id: string): Promise<ArrayBuffer | null> => read<unknown>('blobs', (s) => s.get(id)).then(loadBlob),
  put: (id: string, buf: ArrayBuffer) =>
    write('blobs', (s) => {
      s.put(buf, id);
    }),
  del: (ids: readonly string[]) =>
    write('blobs', (s) => {
      for (const id of ids) s.delete(id);
    }),
  clear: () =>
    write('blobs', (s) => {
      s.clear();
    }),
};

export const peerStore: PeerStore = {
  load: (ws) => eventsDb.byWs(ws),
  save: async (evs) => {
    await eventsDb.put(evs);
  },
  getBlob: (id) => blobsDb.get(id),
  putBlob: async (id, buf) => {
    await blobsDb.put(id, buf);
  },
  loadMark: (ws) => kv.get('mark:' + ws).then(loadMark),
  saveMark: async (ws, sec) => {
    await kv.set('mark:' + ws, sec);
  },
};

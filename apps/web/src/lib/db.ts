import type { Ev, PeerStore } from '@yurt/protocol';

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
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

/** Runs `fn` in a transaction on `store` and resolves once it commits: with the request's result for reads, nothing for writes. */
function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => T): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const t = d.transaction(store, mode);
        const out = fn(t.objectStore(store));
        t.oncomplete = () => res(out);
        t.onerror = () => rej(t.error);
      }),
  );
}

const read = <T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => tx(store, 'readonly', fn).then((req) => req.result);
const write = (store: string, fn: (s: IDBObjectStore) => void): Promise<void> => tx(store, 'readwrite', fn);

export const kv = {
  get: <T>(k: string) => read<T | undefined>('kv', (s) => s.get(k) as IDBRequest<T | undefined>),
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
  byWs: (ws: string) => read<Ev[]>('events', (s) => s.index('ws').getAll(ws) as IDBRequest<Ev[]>),
  put: (evs: Ev[]) =>
    write('events', (s) => {
      for (const e of evs) s.put(e);
    }),
  clear: () =>
    write('events', (s) => {
      s.clear();
    }),
  deleteWs: async (ws: string) => {
    const d = await open();
    await new Promise<void>((res, rej) => {
      const t = d.transaction('events', 'readwrite');
      const req = t.objectStore('events').index('ws').openKeyCursor(IDBKeyRange.only(ws));
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          t.objectStore('events').delete(c.primaryKey);
          c.continue();
        }
      };
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  },
};

export const blobsDb = {
  get: (id: string) => read<ArrayBuffer | undefined>('blobs', (s) => s.get(id) as IDBRequest<ArrayBuffer | undefined>),
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
  getBlob: async (id) => (await blobsDb.get(id)) ?? null,
  putBlob: async (id, buf) => {
    await blobsDb.put(id, buf);
  },
  loadMark: async (ws) => (await kv.get<number>('mark:' + ws)) ?? 0,
  saveMark: async (ws, sec) => {
    await kv.set('mark:' + ws, sec);
  },
};

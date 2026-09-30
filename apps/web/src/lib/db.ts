import type { Ev, PeerStore } from '@yurt/protocol';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('yurt', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('events', { keyPath: 'id' }).createIndex('ws', 'ws');
      d.createObjectStore('blobs');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : (undefined as T));
    t.onerror = () => rej(t.error);
  });
}

export const kv = {
  get: <T>(k: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(k) as IDBRequest<T | undefined>),
  set: (k: string, v: unknown) => run('kv', 'readwrite', (s) => { s.put(v, k); }),
  del: (k: string) => run('kv', 'readwrite', (s) => { s.delete(k); }),
};

export const eventsDb = {
  byWs: (ws: string) => run<Ev[]>('events', 'readonly', (s) => s.index('ws').getAll(ws) as IDBRequest<Ev[]>),
  put: (evs: Ev[]) => run('events', 'readwrite', (s) => { for (const e of evs) s.put(e); }),
  deleteWs: async (ws: string) => {
    const d = await open();
    await new Promise<void>((res, rej) => {
      const t = d.transaction('events', 'readwrite');
      const req = t.objectStore('events').index('ws').openKeyCursor(IDBKeyRange.only(ws));
      req.onsuccess = () => { const c = req.result; if (c) { t.objectStore('events').delete(c.primaryKey); c.continue(); } };
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  },
};

export const blobsDb = {
  get: (id: string) => run<ArrayBuffer | undefined>('blobs', 'readonly', (s) => s.get(id) as IDBRequest<ArrayBuffer | undefined>),
  put: (id: string, buf: ArrayBuffer) => run('blobs', 'readwrite', (s) => { s.put(buf, id); }),
};

export const peerStore: PeerStore = {
  load: (ws) => eventsDb.byWs(ws),
  save: (evs) => eventsDb.put(evs),
  getBlob: async (id) => (await blobsDb.get(id)) ?? null,
  putBlob: (id, buf) => blobsDb.put(id, buf),
  loadMark: async (ws) => (await kv.get<number>('mark:' + ws)) ?? 0,
  saveMark: async (ws, sec) => { await kv.set('mark:' + ws, sec); },
};

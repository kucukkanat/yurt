import { beforeAll, describe, expect, it } from 'vitest';
import { keyFromPhrase, makeEvent, newRecoveryPhrase, type Ev } from '@yurt/protocol';
import { blobsDb, eventsDb, kv, peerStore } from '../../../src/lib/db';
import { resetDb } from './harness';

/** Writes `value` straight into the app's database, bypassing db.ts: what an older version or devtools could leave. */
const raw = (store: string, value: unknown, key?: string) =>
  new Promise<void>((res, rej) => {
    const r = indexedDB.open('yurt', 1);
    r.onsuccess = () => {
      const t = r.result.transaction(store, 'readwrite');
      t.objectStore(store).put(value, key);
      t.oncomplete = () => {
        r.result.close();
        res();
      };
      t.onerror = () => rej(t.error);
    };
  });

const kp = keyFromPhrase(newRecoveryPhrase());
const ev = (ws: string, text: string) => makeEvent(kp, { ws, t: 'msg', ch: 'general', b: { text } });

beforeAll(resetDb);

describe('key-value store', () => {
  it('sets, gets, deletes and clears', async () => {
    expect(await kv.get('missing')).toBeUndefined();
    await kv.set('a', { x: 1 });
    await kv.set('b', 'two');
    expect(await kv.get('a')).toEqual({ x: 1 });
    await kv.del('a');
    expect(await kv.get('a')).toBeUndefined();
    await kv.clear();
    expect(await kv.get('b')).toBeUndefined();
  });

  it('rejects a value the browser can’t store, instead of hanging', async () => {
    await expect(kv.set('fn', () => 1)).rejects.toThrow();
  });
});

describe('events', () => {
  it('stores per workspace and deletes one workspace’s history', async () => {
    const [a1, a2, b1] = [ev('AAAAAAAA', '1'), ev('AAAAAAAA', '2'), ev('BBBBBBBB', '3')];
    await eventsDb.put([a1, a2, b1]);
    expect((await eventsDb.byWs('AAAAAAAA')).map((e) => e.id).sort()).toEqual([a1.id, a2.id].sort());
    await eventsDb.deleteWs('AAAAAAAA');
    expect(await eventsDb.byWs('AAAAAAAA')).toEqual([]);
    expect(await eventsDb.byWs('BBBBBBBB')).toEqual([b1]);
    await eventsDb.deleteWs('NOTHING1');
    await eventsDb.clear();
    expect(await eventsDb.byWs('BBBBBBBB')).toEqual([]);
  });

  it('skips corrupt rows when loading, so a workspace still opens', async () => {
    const good = ev('CCCCCCCC', 'ok');
    await eventsDb.put([good]);
    await raw('events', { id: 'broken', ws: 'CCCCCCCC', t: 'msg' });
    expect(await peerStore.load('CCCCCCCC')).toEqual([good]);
  });

  it('rejects an event without an id', async () => {
    await expect(eventsDb.put([{ ws: 'X' } as unknown as Ev])).rejects.toThrow();
  });
});

describe('files', () => {
  it('stores bytes by id and deletes or clears them', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    await blobsDb.put('f1', buf);
    await blobsDb.put('f2', buf);
    expect(new Uint8Array((await blobsDb.get('f1')) ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1, 2, 3]));
    await blobsDb.del(['f1']);
    expect(await blobsDb.get('f1')).toBeNull();
    await blobsDb.clear();
    expect(await blobsDb.get('f2')).toBeNull();
  });

  it('treats a stored non-byte value as missing', async () => {
    await raw('blobs', 'not bytes', 'f3');
    expect(await blobsDb.get('f3')).toBeNull();
  });
});

describe('the peer store', () => {
  it('saves and loads events, files and the sync mark', async () => {
    const e = ev('DDDDDDDD', 'x');
    await peerStore.save([e]);
    expect(await peerStore.load('DDDDDDDD')).toEqual([e]);
    const buf = new Uint8Array([9]).buffer;
    await peerStore.putBlob?.('blob', buf);
    expect(await peerStore.getBlob?.('blob')).toBeInstanceOf(ArrayBuffer);
    expect(await peerStore.getBlob?.('none')).toBeNull();
    expect(await peerStore.loadMark?.('DDDDDDDD')).toBe(0);
    await peerStore.saveMark?.('DDDDDDDD', 1234);
    expect(await peerStore.loadMark?.('DDDDDDDD')).toBe(1234);
    await kv.set('mark:EEEEEEEE', 'soon');
    expect(await peerStore.loadMark?.('EEEEEEEE')).toBe(0);
  });
});

describe('sharing the database with other tabs', () => {
  it('lets another tab delete or upgrade it, then reopens on the next use', async () => {
    await kv.set('k', 1);
    await resetDb(); // would be "blocked" if this connection stayed open
    expect(await kv.get('k')).toBeUndefined();
    await kv.set('k', 2);
    expect(await kv.get('k')).toBe(2);
  });
});

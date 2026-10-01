import { beforeAll, expect, it } from 'vitest';
import { kv } from '../../../src/lib/db';
import { resetDb } from './harness';

// A database left at a newer version (by a newer app in another tab) can't be opened by this one: every read and
// write must fail clearly instead of hanging.
beforeAll(async () => {
  await resetDb();
  await new Promise<void>((res, rej) => {
    const r = indexedDB.open('yurt', 2);
    r.onsuccess = () => {
      r.result.close();
      res();
    };
    r.onerror = () => rej(r.error);
  });
});

it('fails reads and writes when the database can’t be opened', async () => {
  await expect(kv.get('identity')).rejects.toThrow(/version/i);
  await expect(kv.set('x', 1)).rejects.toThrow(/version/i);
});

it('leaves a clean database for the next test file', async () => {
  await resetDb();
});

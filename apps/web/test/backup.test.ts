import { describe, expect, it } from 'vitest';
import { docOf, ledgerFromText, ledgerOf, merge, missing, record, sameLedger, type Ledger } from '../src/lib/backup';
import type { WsRecord } from '../src/lib/stored';
import { anything, fc } from './fuzz';

const KEY = 'k'.repeat(43);
const ws = (code: string, p: Partial<WsRecord> = {}): WsRecord => ({
  code,
  name: code,
  transport: { key: KEY, relays: ['wss://r.example'] },
  creator: null,
  lastRead: { general: 5 },
  ...p,
});
const A = ws('AAAAAAAA');
const B = ws('BBBBBBBB');
const kept = (w: WsRecord) => ({ code: w.code, name: w.name, transport: w.transport, creator: w.creator });

describe('the workspace backup ledger', () => {
  it('records joins, changes and leaves, but not read positions', () => {
    const joined = record({}, [], [A, B], 1);
    expect(joined).toEqual({ [A.code]: { at: 1, ws: kept(A) }, [B.code]: { at: 1, ws: kept(B) } });
    expect(sameLedger(record(joined, [A, B], [{ ...A, lastRead: {} }, B], 2), joined)).toBe(true);
    const renamed = record(joined, [A, B], [{ ...A, name: 'Renamed' }, B], 3);
    expect(renamed[A.code]).toEqual({ at: 3, ws: { ...kept(A), name: 'Renamed' } });
    const left = record(renamed, [A, B], [B], 4);
    expect(left[A.code]).toEqual({ at: 4, ws: null });
    expect(left[B.code]).toEqual({ at: 1, ws: kept(B) });
  });

  it('keeps file servers when a workspace has them', () => {
    const w = ws('CCCCCCCC', { blossom: ['https://files.example'] });
    expect(record({}, [], [w], 1)[w.code]?.ws).toEqual({ ...kept(w), blossom: ['https://files.example'] });
  });

  it('doesn’t re-add a workspace another device left, nor re-record one restored as it was', () => {
    const theirs: Ledger = { [A.code]: { at: 9, ws: null } };
    // A is still here and unchanged: another workspace changing doesn't bring A back.
    expect(record(theirs, [A], [A, B], 10)[A.code]).toEqual({ at: 9, ws: null });
    // Leaving one already marked left keeps its time.
    expect(record(theirs, [A], [], 10)[A.code]).toEqual({ at: 9, ws: null });
    // Restoring B just as the ledger has it records nothing new, whatever the key order.
    const restored: Ledger = { [B.code]: { at: 5, ws: { creator: null, transport: { relays: ['wss://r.example'], key: KEY }, name: B.name, code: B.code } } };
    expect(record(restored, [], [B], 10)).toEqual(restored);
  });

  it('merges by each workspace’s newest change, keeping mine on a tie', () => {
    const mine: Ledger = { [A.code]: { at: 5, ws: kept(A) }, [B.code]: { at: 5, ws: kept(B) } };
    const theirs: Ledger = { [A.code]: { at: 6, ws: null }, [B.code]: { at: 5, ws: null }, CCCCCCCC: { at: 1, ws: null } };
    expect(merge(mine, theirs)).toEqual({ [A.code]: { at: 6, ws: null }, [B.code]: { at: 5, ws: kept(B) }, CCCCCCCC: { at: 1, ws: null } });
    expect(merge(theirs, mine)[A.code]).toEqual({ at: 6, ws: null });
  });

  it('lists the joined workspaces this device lacks, with fresh read state', () => {
    const l: Ledger = { [A.code]: { at: 1, ws: kept(A) }, [B.code]: { at: 1, ws: kept(B) }, CCCCCCCC: { at: 1, ws: null } };
    expect(missing(l, [A])).toEqual([{ ...kept(B), lastRead: {} }]);
    expect(missing(l, [A, B])).toEqual([]);
  });

  it('round-trips through text, and reads anything else as empty or drops the bad entries', () => {
    const l = record({}, [], [A, ws('CCCCCCCC', { blossom: ['https://f.example'] })], 1);
    expect(ledgerFromText(JSON.stringify(docOf(l)))).toEqual(l);
    expect(ledgerOf(docOf(l))).toEqual(l);
    expect(ledgerFromText(null)).toEqual({});
    expect(ledgerFromText('not json')).toEqual({});
    expect(ledgerOf({ v: 2, ws: {} })).toEqual({});
    const doc = {
      v: 1,
      ws: {
        [A.code]: { at: 1, ws: kept(A) },
        [B.code]: { at: 2, ws: null },
        CCCCCCCC: { at: 3, ws: kept(A) }, // filed under another code
        __proto__x: { at: 4, ws: null }, // not a code
        DDDDDDDD: { at: 'soon', ws: null },
      },
    };
    expect(ledgerOf(doc)).toEqual({ [A.code]: { at: 1, ws: kept(A) }, [B.code]: { at: 2, ws: null } });
    fc.assert(
      fc.property(anything, (x) => {
        expect(ledgerOf(x)).toEqual({});
      }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { callKey, dmCalls, nextRing, QUIET, RING_MS, silence, type Call } from '../src/lib/ring';

const ME = 'a'.repeat(64);
const BO = 'b'.repeat(64);
const CY = 'c'.repeat(64);
const dm = (x: string, y: string) => 'dm:' + [x, y].sort().join(':');
const call = (from: string, code = 'K7QX2MPD'): Call => ({ code, ch: dm(ME, from), from });

describe('which DM huddles ring', () => {
  it('are huddles someone else is in, in a DM between them and me', () => {
    const huddles = [
      { pub: BO, ch: dm(ME, BO) },
      { pub: BO, ch: dm(ME, BO) }, // his second device: still one call
      { pub: ME, ch: dm(ME, CY) }, // mine
      { pub: CY, ch: dm(BO, CY) }, // not with me
      { pub: CY, ch: 'general' }, // a channel
      { pub: CY, ch: null },
      { pub: CY, ch: dm(ME, BO) }, // in someone else's DM with me: not from the pair
    ];
    expect(dmCalls('K7QX2MPD', ME, huddles)).toEqual([call(BO)]);
  });
});

describe('ringing', () => {
  it('rings a new call until it rings out, then not again while it lasts', () => {
    const s1 = nextRing(QUIET, [call(BO)], null, 1_000);
    expect(s1.ringing).toEqual(call(BO));
    expect(nextRing(s1, [call(BO)], null, 1_000 + RING_MS - 1).ringing).toEqual(call(BO));
    const out = nextRing(s1, [call(BO)], null, 1_000 + RING_MS);
    expect(out.ringing).toBeNull();
    expect(nextRing(out, [call(BO)], null, 99_999).ringing).toBeNull();
  });

  it('keeps ringing the same call while it lasts, from when it started', () => {
    const s1 = nextRing(QUIET, [call(BO)], null, 1_000);
    expect(nextRing(s1, [call(BO)], null, 5_000)).toMatchObject({ ringing: call(BO), since: 1_000 });
  });

  it('stops when I join, and doesn’t ring again for that call after I leave it', () => {
    const s1 = nextRing(QUIET, [call(BO)], null, 0);
    const joined = nextRing(s1, [call(BO)], callKey(call(BO)), 10);
    expect(joined.ringing).toBeNull();
    expect(nextRing(joined, [call(BO)], null, 20).ringing).toBeNull();
  });

  it('never rings a call I start myself and someone then joins', () => {
    expect(nextRing(QUIET, [call(BO)], callKey(call(BO)), 0).ringing).toBeNull();
  });

  it('stops when silenced, rings again once the call ends and starts over', () => {
    const quiet = silence(nextRing(QUIET, [call(BO)], null, 0));
    expect(quiet.ringing).toBeNull();
    expect(nextRing(quiet, [call(BO)], null, 10).ringing).toBeNull();
    const ended = nextRing(quiet, [], null, 20);
    expect(ended).toEqual(QUIET);
    expect(nextRing(ended, [call(BO)], null, 30).ringing).toEqual(call(BO));
    expect(silence(QUIET)).toBe(QUIET);
  });

  it('stops when the caller hangs up, and moves on to another call', () => {
    const s1 = nextRing(QUIET, [call(BO), call(CY)], null, 0);
    expect(s1.ringing).toEqual(call(BO));
    expect(nextRing(s1, [call(CY)], null, 10)).toMatchObject({ ringing: call(CY), since: 10 });
    expect(nextRing(s1, [], null, 10).ringing).toBeNull();
    // Rung out: the next call rings.
    expect(nextRing(s1, [call(BO), call(CY)], null, RING_MS).ringing).toEqual(call(CY));
  });
});

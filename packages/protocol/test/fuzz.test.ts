import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import {
  reduce,
  makeEvent,
  keyFromPhrase,
  newRecoveryPhrase,
  canonical,
  verifyEvent,
  parseBody,
  parseOr,
  isEventShape,
  summarize,
  diffDays,
  normalizeCode,
  parseInvite,
  inviteHash,
  newWorkspaceKey,
  workspaceKeys,
  seal,
  open,
  sealBytes,
  openBytes,
  b64,
  unb64,
  EV_TYPES,
  BODY_SCHEMAS,
  PresenceSchema,
  HuddleStateSchema,
  SyncMsgSchema,
  HandshakeSchema,
  FileIdSchema,
  PrivateWrapperSchema,
  PresenceEnvelopeSchema,
  KeyHistorySchema,
  type Ev,
  type WsState,
  type Invite,
} from '../src';

// Property tests: every run checks the same inputs (fixed seed), so a failure reproduces exactly.
// A failure prints its seed and shrunk counterexample; keep it as a regular test case once fixed.
beforeAll(() => {
  fc.configureGlobal({ seed: 20_261_001, numRuns: 300 });
});

const WS = 'K7QX2MPD';
const hex32 = fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 32, maxLength: 32 });
const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());

/** Strings biased towards the keys and values code is likeliest to trip on. */
const sharpString = fc.oneof(fc.string(), fc.constantFrom('__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', '', 'general', 'x'.repeat(5_000)));
/** Any JSON value, with hostile object keys mixed in (JSON.parse makes `__proto__` an own key, as on the wire). */
const hostileJson = fc
  .jsonValue({ maxDepth: 4 })
  .chain((j) => fc.constantFrom(j, JSON.parse(`{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"text":${JSON.stringify(j)}}`)));
const anyEvent = fc.record({
  id: fc.oneof(hex32, sharpString),
  ws: fc.constantFrom(WS, 'OTHER123'),
  t: fc.oneof(fc.constantFrom(...EV_TYPES), sharpString),
  a: fc.constantFrom(A.pub, B.pub, 'not a key'),
  ts: fc.oneof(fc.integer(), fc.double(), fc.constant(Number.MAX_SAFE_INTEGER)),
  sig: fc.string(),
  ch: fc.option(fc.oneof(sharpString, fc.constantFrom('general', `dm:${A.pub}:${B.pub}`, `adm:${A.pub}:x`, `gdm:${B.pub}:${A.pub}:x`)), { nil: undefined }),
  to: fc.option(fc.constantFrom(A.pub, B.pub), { nil: undefined }),
  ag: fc.option(sharpString, { nil: undefined }),
  b: hostileJson,
});

const noPollution = () => {
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.keys(Object.prototype)).toEqual([]);
};

describe('the reducer, fuzzed', () => {
  it('never throws, whatever events and bodies it is given, and never pollutes prototypes', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(anyEvent, fc.anything()), { maxLength: 40 }), fc.option(fc.constantFrom(A.pub, B.pub), { nil: undefined }), (evs, creator) => {
        reduce(WS, evs as Ev[], { creator });
        noPollution();
      }),
    );
  });

  // Realistic signed events from a small vocabulary, so they interact: replies, reactions, bans, edits.
  const action = fc.oneof(
    fc.record({ t: fc.constant('ws.create'), b: fc.record({ name: fc.string() }) }),
    fc.record({ t: fc.constant('ch.create'), b: fc.record({ id: fc.constantFrom('general', 'side'), name: fc.string() }) }),
    fc.record({ t: fc.constant('profile'), b: fc.record({ name: fc.string({ minLength: 1 }), handle: fc.string() }) }),
    fc.record({ t: fc.constant('msg'), ch: fc.constantFrom('general', 'side'), b: fc.record({ text: fc.string() }) }),
    fc.record({ t: fc.constant('ban'), b: fc.record({ target: fc.constantFrom(A.pub, B.pub), on: fc.boolean() }) }),
    fc.record({ t: fc.constant('role'), b: fc.record({ target: fc.constantFrom(A.pub, B.pub), admin: fc.boolean() }) }),
  );
  const snapshot = (s: WsState) => JSON.stringify(s, (_k, v: unknown) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));

  it('is deterministic: the same events in any order give the same state', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), action, fc.integer({ min: 0, max: 20 })), { minLength: 1, maxLength: 20 }), fc.nat(), (spec, seed) => {
        const evs = spec.map(([byA, a, at], i) =>
          makeEvent<unknown>(byA ? A : B, { ws: WS, t: a.t, b: a.b, ch: 'ch' in a ? a.ch : undefined, ts: 1_700_000_000_000 + at * 1000 + i }),
        );
        const shuffled = [...evs].sort((x, y) => ((x.id.charCodeAt(0) + seed) % 7) - ((y.id.charCodeAt(0) + seed) % 7) || 0);
        expect(snapshot(reduce(WS, shuffled, { creator: A.pub }))).toBe(snapshot(reduce(WS, evs, { creator: A.pub })));
      }),
    );
  });
});

describe('schemas, fuzzed', () => {
  const live = { PresenceSchema, HuddleStateSchema, SyncMsgSchema, HandshakeSchema, FileIdSchema, PrivateWrapperSchema, PresenceEnvelopeSchema, KeyHistorySchema };

  it('never throw, and what they accept is a fixed point (parsing it again changes nothing)', () => {
    fc.assert(
      fc.property(fc.oneof(hostileJson, fc.anything()), (x) => {
        for (const t of EV_TYPES) {
          const out = parseBody(t, x);
          if (out !== null) expect(parseBody(t, out)).toEqual(out);
        }
        for (const s of Object.values(live)) {
          const out = parseOr(s, x);
          if (out !== null) expect(parseOr(s, out)).toEqual(out);
        }
        expect(typeof isEventShape(x)).toBe('boolean');
        noPollution();
      }),
    );
  });

  it('cover every event type the reducer knows', () => {
    expect(Object.keys(BODY_SCHEMAS).sort()).toEqual([...EV_TYPES].sort());
  });
});

describe('wire formats, fuzzed', () => {
  it('canonical JSON is stable: re-encoding its own output changes nothing', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (j) => {
        expect(canonical(JSON.parse(canonical(j)))).toBe(canonical(j));
      }),
    );
  });

  it('verifyEvent rejects any change to a signed event, and never throws', () => {
    const e = makeEvent(A, { ws: WS, t: 'msg', ch: 'general', b: { text: 'hello' } });
    fc.assert(
      fc.property(fc.constantFrom<keyof Ev>('id', 'ws', 't', 'a', 'ts', 'ch', 'b', 'sig'), fc.anything(), (field, value) => {
        fc.pre(JSON.stringify(value) !== JSON.stringify(e[field]));
        expect(verifyEvent({ ...e, [field]: value })).toBe(false);
      }),
    );
    expect(verifyEvent(e)).toBe(true);
  });

  it('day summaries ignore order, and two equal logs have no differing days', () => {
    const ev = fc.record({ id: hex32, ts: fc.integer({ min: 0, max: 10 ** 13 }) });
    fc.assert(
      fc.property(fc.array(ev), (evs) => {
        expect(summarize([...evs].reverse())).toEqual(summarize(evs));
        expect(diffDays(summarize(evs), summarize([...evs].reverse()))).toEqual([]);
      }),
    );
  });

  it('code and invite parsers never throw on arbitrary text', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.webUrl({ withFragments: true }),
          fc.string().map((s) => `#/w/K7QX2MPD/k/${s}/n/${s}/o/${s}/s/${s}`),
        ),
        (s) => {
          normalizeCode(s);
          parseInvite(s);
        },
      ),
    );
  });

  it('invite links round-trip', () => {
    const alpha = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
    const code = fc.array(fc.constantFrom(...alpha), { minLength: 8, maxLength: 8 }).map((c) => c.join(''));
    const relays = fc.array(
      fc.webUrl().map((u) => u.replace(/^https?/, 'wss')),
      { minLength: 1, maxLength: 3 },
    );
    const invite: fc.Arbitrary<Invite> = fc.record({
      code,
      transport: fc.oneof(
        fc.record({ kind: fc.constant('nostr' as const), key: fc.constant(newWorkspaceKey()), relays: relays.map((r) => [...new Set(r)]) }),
        fc.record({ kind: fc.constant('trystero' as const), key: fc.constant(newWorkspaceKey()) }),
      ),
    });
    fc.assert(
      fc.property(invite, (inv) => {
        fc.pre(inv.transport.kind !== 'nostr' || inv.transport.relays.every((u) => /^wss?:\/\/[^\s/,]+/.test(u) && !/[\s,]/.test(u)));
        expect(parseInvite('https://yurt.example/' + inviteHash(inv))).toEqual(inv);
      }),
    );
  });
});

describe('sealing, fuzzed', () => {
  const key = workspaceKeys(newWorkspaceKey()).enc;

  it('opens what it sealed, and nothing else', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (text, aad) => {
        const sealed = seal(key, aad, text);
        expect(open(key, aad, sealed)).toBe(text);
        expect(open(key, aad + 'x', sealed)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('rejects any tampered ciphertext', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), fc.nat(), fc.integer({ min: 1, max: 255 }), (body, at, flip) => {
        const sealed = sealBytes(key, 'aad', body);
        expect(openBytes(key, 'aad', sealed)).toEqual(body);
        const bad = sealed.slice();
        const i = at % bad.length;
        bad.set([(bad.at(i) ?? 0) ^ flip], i);
        expect(openBytes(key, 'aad', bad)).toBeNull();
        expect(open(key, 'aad', b64(bad))).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('base64url round-trips any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 100_000 }), (b) => {
        expect(unb64(b64(b))).toEqual(b);
      }),
      { numRuns: 50 },
    );
  });
});

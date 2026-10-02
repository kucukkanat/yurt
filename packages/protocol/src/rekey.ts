import type { KeyPair } from './crypto';
import type { RekeyBody } from './types';
import type { ValidRekey } from './reduce';
import * as v from 'valibot';
import { isWorkspaceKey, newWorkspaceKey, open, seal, workspaceKeys, type WsKeys } from './seal';
import { KeyHistorySchema } from './schemas';

/**
 * Key rotation. A workspace key is a chain: the invite key, then one key per
 * `rekey` event. Every device rebuilds its chain from the key it holds plus the rekeys in its log,
 * so nothing but the invite key is ever stored:
 * - forwards: a rekey seals the new key for each remaining member with the admin↔member pair key;
 * - backwards: a rekey's `history` seals every earlier key under the new one, so a member who
 *   joins with the newest key can still read what came before.
 * Reading with extra keys is harmless, so any unwrappable rekey adds a key; only valid ones (see
 * reduce) decide which key new events are written with.
 */

const WRAP = 'yurt-rekey-v1';
const HISTORY = 'yurt-rekey-history-v1';

export interface RingKey {
  readonly key: string;
  readonly keys: WsKeys;
  epoch: number | null;
}
export type RawRekey = Pick<ValidRekey, 'id' | 'a' | 'epoch' | 'keys' | 'history'>;
export interface Keyring {
  readonly keys: ReadonlyMap<string, RingKey>;
  /** The key new events are sealed with: the newest one a valid rekey handed to me. */
  readonly write: RingKey;
  /** A valid rekey exists that I can't open: I was removed, or my invite predates the rotation. */
  readonly lockedOut: boolean;
}

const derived = new Map<string, WsKeys>();
const keysOf = (key: string) => {
  const have = derived.get(key);
  if (have) return have;
  const k = workspaceKeys(key);
  derived.set(key, k);
  return k;
};

function historyOf(k: WsKeys, r: RawRekey): { key: string; epoch: number | null }[] | null {
  const text = open(k.enc, HISTORY, r.history);
  if (text === null) return null;
  // Authenticated but malformed (a buggy or hostile admin): the rekey still counts, with whatever history entries are valid.
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return [];
  }
  return v.parse(KeyHistorySchema, list); // never throws: anything that isn't a list of entries is an empty list
}

type Opened = { key: string; history: { key: string; epoch: number | null }[] };

/** `key` with the history it opens on `r`, if it is the key r's history is sealed under. */
function opens(key: string | null, r: RawRekey): Opened | null {
  const history = key !== null && isWorkspaceKey(key) ? historyOf(keysOf(key), r) : null;
  return key !== null && history ? { key, history } : null;
}

// The rekey's author sealed my copy with the pair key salted by *their* current key, which may be
// any key I hold; trying each is a handful of X25519 operations.
function unwrap(ring: Map<string, RingKey>, me: KeyPair, r: RawRekey): Opened | null {
  const sealed = r.keys[me.pub];
  if (!sealed || !/^[0-9a-f]{64}$/.test(r.a)) return null;
  for (const e of ring.values()) {
    let key: string | null;
    try {
      key = open(e.keys.pair(me.sec, r.a), WRAP, sealed);
    } catch {
      continue; // 64 hex characters that aren't a curve point: junk
    }
    const found = opens(key, r);
    if (found) return found;
  }
  return null;
}

/** Adds a key to the ring, or learns its epoch; true when the ring changed. */
function addKey(ring: Map<string, RingKey>, key: string, epoch: number | null): boolean {
  const e = ring.get(key);
  if (!e) {
    ring.set(key, { key, keys: keysOf(key), epoch });
    return true;
  }
  if (e.epoch === null && epoch !== null) {
    e.epoch = epoch;
    return true;
  }
  return false;
}

/**
 * Opens every rekey it can, growing `ring` as it goes, until nothing more opens (a rekey's history
 * can unlock older keys that open other rekeys). Returns rekey id → the key it introduced.
 */
function openRekeys(ring: Map<string, RingKey>, rekeys: readonly RawRekey[], me: KeyPair): Map<string, string> {
  const introduced = new Map<string, string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of rekeys) {
      if (introduced.has(r.id)) continue;
      // I may already hold the key (from an invite, or another rekey's history); it opens the history.
      const held = [...ring.values()].map((e) => opens(e.key, r)).find((o) => o !== null);
      const found = held ?? unwrap(ring, me, r);
      if (!found) continue;
      introduced.set(r.id, found.key);
      addKey(ring, found.key, r.epoch);
      for (const h of found.history) addKey(ring, h.key, h.epoch);
      changed = true;
    }
  }
  return introduced;
}

export function buildKeyring(invite: string, rekeys: readonly RawRekey[], valid: readonly ValidRekey[], me: KeyPair): Keyring {
  const inviteKey: RingKey = { key: invite, keys: keysOf(invite), epoch: null };
  // Opening rekeys only ever adds keys or learns their epochs, so the invite key's entry stays this object.
  const ring = new Map<string, RingKey>([[invite, inviteKey]]);
  const introduced = openRekeys(ring, rekeys, me);
  let write = inviteKey;
  let epoch = inviteKey.epoch ?? 0;
  for (const r of valid) {
    const k = introduced.get(r.id);
    const e = k === undefined ? undefined : ring.get(k);
    if (e && r.epoch > epoch) {
      write = e;
      epoch = r.epoch;
    }
  }
  return { keys: ring, write, lockedOut: valid.some((r) => r.epoch > epoch && !introduced.has(r.id)) };
}

/** A new key for `recipients` (the remaining members, including me), sealed from my current write key. */
export function makeRekey(ring: Keyring, me: KeyPair, recipients: readonly string[]): { key: string; body: RekeyBody } {
  const key = newWorkspaceKey();
  const w = ring.write;
  const keys: Record<string, string> = {};
  for (const pub of new Set([...recipients, me.pub])) keys[pub] = seal(w.keys.pair(me.sec, pub), WRAP, key);
  const history = seal(keysOf(key).enc, HISTORY, JSON.stringify([...ring.keys.values()].map((k) => ({ key: k.key, epoch: k.epoch }))));
  return { key, body: { epoch: (w.epoch ?? 0) + 1, keys, history } };
}

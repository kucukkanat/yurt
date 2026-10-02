import * as v from 'valibot';
import { DEFAULT_RELAYS, isRecord, normalizeCode, parseOr } from '@yurt/protocol';
import { WsRecordSchema, type WsRecord } from './stored';

/*
 * Which workspaces an identity belongs to, kept across its devices in an encrypted note on Nostr relays
 * (`identityBackup` in @yurt/protocol), so importing the recovery phrase elsewhere brings them back.
 * Each workspace's newest change wins, joined or left, so devices merge in any order and a workspace left on one
 * device isn't brought back by another's older copy. Read positions and alert levels aren't in it: they sync as events
 * addressed to myself inside each workspace (`read`, `notify`).
 */

/**
 * Where the backup lives and how soon a change is synced. A new device knows nothing else yet, so the relays are
 * fixed, not a setting. Tests point it at their local relay (test/browser/backup-setup.ts).
 */
export const backupConfig: { relays: readonly string[]; delayMs: number } = { relays: DEFAULT_RELAYS, delayMs: 2_000 };

/** What's kept of a workspace: enough to rejoin it, with a key that may have rotated since the invite. */
type Kept = Pick<WsRecord, 'code' | 'name' | 'transport' | 'creator' | 'blossom'>;
/** A workspace's latest change, in ms: joined (with what rejoining takes) or left (null). */
interface Entry {
  at: number;
  ws: Kept | null;
}
export type Ledger = Readonly<Record<string, Entry>>;

const keep = ({ code, name, transport, creator, blossom }: Kept): Kept => ({ code, name, transport, creator, ...(blossom ? { blossom } : {}) });
// Key order differs between a record built from an invite and one read back, so compare with sorted keys.
const canon = (x: unknown) => JSON.stringify(x, (_k, val: unknown) => (isRecord(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));
const same = (a: Kept | null | undefined, b: Kept | null) => canon(a ?? null) === canon(b);

/**
 * Notes what changed from `before` to `after` at `at`: joined or changed, or left. A workspace another device left
 * stays left here until this device changes it, so devices don't keep re-adding each other's leftovers.
 */
export function record(ledger: Ledger, before: readonly WsRecord[], after: readonly WsRecord[], at: number): Ledger {
  const was = new Map(before.map((w) => [w.code, keep(w)]));
  const out: Record<string, Entry> = { ...ledger };
  for (const w of after) {
    const k = keep(w);
    const prior = was.get(w.code);
    if ((!prior || !same(prior, k)) && !same(ledger[w.code]?.ws, k)) out[w.code] = { at, ws: k };
    was.delete(w.code);
  }
  for (const code of was.keys()) if (ledger[code]?.ws !== null) out[code] = { at, ws: null };
  return out;
}

/** Both ledgers' newest change per workspace; `mine` wins a tie. */
export function merge(mine: Ledger, theirs: Ledger): Ledger {
  const out: Record<string, Entry> = { ...mine };
  for (const [code, e] of Object.entries(theirs)) {
    const m = out[code];
    if (!m || e.at > m.at) out[code] = e;
  }
  return out;
}

/** Workspaces the ledger has joined that this device doesn't have yet, ready to connect. */
export const missing = (ledger: Ledger, workspaces: readonly WsRecord[]): WsRecord[] =>
  Object.values(ledger).flatMap((e) => (e.ws && !workspaces.some((w) => w.code === e.ws?.code) ? [{ ...e.ws, lastRead: {} }] : []));

/** The ledger as stored on this device and, as text, in the backup. */
export const docOf = (ledger: Ledger) => ({ v: 1, ws: ledger });
export const sameLedger = (a: Ledger, b: Ledger) => canon(a) === canon(b);

const EntrySchema = v.object({ at: v.pipe(v.number(), v.finite()), ws: v.nullable(WsRecordSchema) });
const DocSchema = v.object({ v: v.literal(1), ws: v.record(v.string(), v.unknown()) });

/** A stored or downloaded ledger: bad entries are dropped, anything unreadable is empty. */
export function ledgerOf(raw: unknown): Ledger {
  const doc = parseOr(DocSchema, raw);
  if (!doc) return {};
  return Object.fromEntries(
    Object.entries(doc.ws).flatMap(([code, x]) => {
      const e = parseOr(EntrySchema, x);
      const fits = e && normalizeCode(code) === code && (e.ws === null || e.ws.code === code);
      return fits ? [[code, { at: e.at, ws: e.ws && keep(e.ws) }]] : [];
    }),
  );
}

/** The backup's text, as `identityBackup` loads it. */
export function ledgerFromText(text: string | null): Ledger {
  if (text === null) return {};
  try {
    return ledgerOf(JSON.parse(text));
  } catch {
    return {}; // not JSON: nothing usable, like a malformed entry
  }
}

import * as v from 'valibot';
import {
  DEFAULT_BLOSSOM,
  DEFAULT_RELAYS,
  EventSchema,
  LEGACY_TRYSTERO,
  SIGNAL_KINDS,
  formatCode,
  isRecord,
  isValidPhrase,
  isWorkspaceKey,
  keyFromPhrase,
  normalizeCode,
  parseOr,
  type Ev,
  type KeyPair,
  type Signaling,
  type WsTransport,
} from '@yurt/protocol';
import { handleFrom } from './format';
import { dropLegacy, migrateLastNet, type LastNet } from './newNet';

/**
 * What this app reads back from IndexedDB. It's our own earlier writes, but from any older version, a
 * half-finished write, or a user poking at devtools, so it's parsed like any other input: bad fields fall
 * back to safe defaults, unusable records are skipped, and nothing here throws.
 */

export interface Identity extends KeyPair {
  phrase: string;
  name: string;
  handle: string;
}

export interface WsRecord {
  code: string;
  name: string;
  transport: WsTransport;
  creator: string | null;
  lastRead: Record<string, number>;
  muted: string[];
  /** Blossom servers for this workspace's uploads; falls back to the defaults. */
  blossom?: string[] | undefined;
}

export interface NetSettings {
  turn: 'default' | 'custom' | 'off';
  turnUrls: string;
  turnUser: string;
  turnPass: string;
  /** Relay workspaces use WebRTC (voice and video) only when this is on. Trystero workspaces always use it. */
  webrtc: boolean;
}

export interface Settings extends NetSettings {
  theme: 'dark' | 'light';
  notifications: boolean;
  /** Vibration on touches that do something (long-press, swipe to reply, sending). */
  haptics: boolean;
  /** The "install Yurt" suggestion was shown on this device. */
  installHint: boolean;
  /** What the create step used last for each mode; prefills the next new workspace. */
  lastNet?: LastNet | undefined;
}

// No TURN by default: a third-party relay would see who connects to whom. Opt in under Settings → Network.
export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  notifications: false,
  haptics: true,
  installHint: false,
  turn: 'off',
  turnUrls: '',
  turnUser: '',
  turnPass: '',
  webrtc: false,
};

const text = v.string();
const finite = v.pipe(v.number(), v.finite());
const HEX64 = /^[0-9a-f]{64}$/;
/** The strings in a list (anything else is dropped); a non-list is empty. */
const strings = v.pipe(
  v.optional(v.unknown(), null), // a missing key is an empty value (via the transform), not an invalid record
  v.transform((x): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])),
);
const workspaceKey = v.pipe(text, v.check(isWorkspaceKey));

const SignalingSchema: v.GenericSchema<unknown, Signaling> = v.object({ kind: v.picklist(SIGNAL_KINDS), urls: strings });

const TransportSchema: v.GenericSchema<unknown, WsTransport> = v.variant('kind', [
  v.object({
    kind: v.literal('nostr'),
    key: workspaceKey,
    // A relay workspace with no relays can't reach anyone; the built-ins at least let it sync again.
    relays: v.pipe(
      strings,
      v.transform((rs) => (rs.length ? rs : [...DEFAULT_RELAYS])),
    ),
  }),
  v.pipe(
    v.object({ kind: v.literal('trystero'), key: v.optional(workspaceKey), signal: v.fallback(v.optional(SignalingSchema), undefined) }),
    // Absent fields are left out, not set to undefined (the transport is compared and sent as JSON).
    v.transform(({ key, signal }): WsTransport => ({ kind: 'trystero', ...(key ? { key } : {}), ...(signal ? { signal } : {}) })),
  ),
]);

export const WsRecordSchema: v.GenericSchema<unknown, WsRecord> = v.pipe(
  v.custom<Record<string, unknown>>(isRecord),
  v.object({
    code: v.pipe(
      text,
      v.check((c) => normalizeCode(c) === c),
    ),
    name: v.fallback(v.optional(text), undefined),
    // Records from before transports existed are Trystero workspaces.
    transport: v.optional(TransportSchema, LEGACY_TRYSTERO),
    creator: v.fallback(v.nullable(v.pipe(text, v.regex(HEX64))), null),
    lastRead: v.pipe(
      v.optional(v.unknown(), null), // a missing key is an empty value (via the transform), not an invalid record
      v.transform((x) => {
        // Null prototype: channel ids are keys, and "__proto__" is a valid channel id.
        const out: Record<string, number> = Object.create(null);
        if (isRecord(x)) for (const [ch, ts] of Object.entries(x)) if (typeof ts === 'number' && Number.isFinite(ts)) out[ch] = ts;
        return out;
      }),
    ),
    muted: strings,
    blossom: v.fallback(v.optional(v.array(text)), undefined),
  }),
  v.transform(({ name, blossom, ...r }): WsRecord => ({ ...r, name: name ?? formatCode(r.code), ...(blossom ? { blossom } : {}) })),
);

/** Where a workspace's attachments are uploaded: its file servers (else the defaults) for relay workspaces, none for peer-to-peer ones. */
export const uploadServers = (w: WsRecord): readonly string[] | null => (w.transport.kind !== 'nostr' ? null : w.blossom?.length ? w.blossom : DEFAULT_BLOSSOM);

/** Saved workspaces: bad records are skipped (they couldn't connect anyway), and a code appears once. */
export function loadWorkspaces(raw: unknown): WsRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((x) => {
    const w = parseOr(WsRecordSchema, x);
    if (!w || seen.has(w.code)) return [];
    seen.add(w.code);
    return [w];
  });
}

/** The saved identity. The phrase is the source of truth: keys are derived from it, so a stale or edited key can't win. */
export function loadIdentity(raw: unknown): Identity | null {
  if (!isRecord(raw) || typeof raw.phrase !== 'string' || !isValidPhrase(raw.phrase)) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Me';
  const handle = typeof raw.handle === 'string' && raw.handle.trim() ? raw.handle : handleFrom(name);
  return { ...keyFromPhrase(raw.phrase), phrase: raw.phrase, name, handle };
}

const SettingsSchema = v.object({
  theme: v.fallback(v.picklist(['dark', 'light']), DEFAULT_SETTINGS.theme),
  notifications: v.fallback(v.boolean(), DEFAULT_SETTINGS.notifications),
  haptics: v.fallback(v.boolean(), DEFAULT_SETTINGS.haptics),
  installHint: v.fallback(v.boolean(), DEFAULT_SETTINGS.installHint),
  turn: v.fallback(v.picklist(['default', 'custom', 'off']), DEFAULT_SETTINGS.turn),
  turnUrls: v.fallback(text, DEFAULT_SETTINGS.turnUrls),
  turnUser: v.fallback(text, DEFAULT_SETTINGS.turnUser),
  turnPass: v.fallback(text, DEFAULT_SETTINGS.turnPass),
  webrtc: v.fallback(v.boolean(), DEFAULT_SETTINGS.webrtc),
});

/** Saved settings over the defaults; older versions' app-wide network defaults become `lastNet` once. */
export function loadSettings(raw: unknown): Settings {
  const saved = isRecord(raw) ? raw : {};
  const lastNet = migrateLastNet(saved);
  return { ...v.parse(SettingsSchema, dropLegacy(saved)), ...(lastNet ? { lastNet } : {}) };
}

/** A stored string (e.g. the bridge pairing token), or null. */
export const loadToken = (raw: unknown): string | null => (typeof raw === 'string' && raw ? raw : null);

/** A workspace's Nostr sync mark: seconds, never negative. */
export const loadMark = (raw: unknown): number => {
  const r = v.safeParse(finite, raw);
  return r.success && r.output > 0 ? r.output : 0;
};

/** Stored events that are still well-formed; a corrupt row is skipped instead of breaking the workspace. */
export const loadEvents = (raw: unknown): Ev[] => (Array.isArray(raw) ? raw.filter((e): e is Ev => parseOr(EventSchema, e) !== null) : []);

/** A stored file's bytes, or null when the row isn't bytes. */
export const loadBlob = (raw: unknown): ArrayBuffer | null => (raw instanceof ArrayBuffer ? raw : null);

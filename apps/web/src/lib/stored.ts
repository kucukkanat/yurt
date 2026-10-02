import * as v from 'valibot';
import {
  DEFAULT_BLOSSOM,
  DEFAULT_RELAYS,
  EventSchema,
  formatCode,
  isRecord,
  isValidPhrase,
  isWorkspaceKey,
  keyFromPhrase,
  normalizeCode,
  parseOr,
  type Ev,
  type KeyPair,
  type WsTransport,
} from '@yurt/protocol';
import { handleFrom } from './format';
import { LastNetSchema, type NewWorkspaceNet } from './newNet';

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
  /** Blossom servers for this workspace's uploads; falls back to the defaults. */
  blossom?: string[] | undefined;
}

export interface NetSettings {
  turn: 'default' | 'custom' | 'off';
  turnUrls: string;
  turnUser: string;
  turnPass: string;
  /** Calls (voice, video, screen) are the only thing that uses WebRTC, and only when this is on. */
  webrtc: boolean;
}

export interface Settings extends NetSettings {
  theme: 'dark' | 'light';
  notifications: boolean;
  /** Vibration on touches that do something (long-press, swipe to reply, sending). */
  haptics: boolean;
  /** A short chime for messages that alert me (silent in Focus mode). */
  sound: boolean;
  /** The "install Yurt" suggestion was shown on this device. */
  installHint: boolean;
  /** What the create step used last; prefills the next new workspace. */
  lastNet?: NewWorkspaceNet | undefined;
}

// No TURN by default: a third-party relay would see who connects to whom. Opt in under Settings → Network.
export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  notifications: false,
  haptics: true,
  sound: true,
  installHint: false,
  turn: 'off',
  turnUrls: '',
  turnUser: '',
  turnPass: '',
  webrtc: true,
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

const TransportSchema: v.GenericSchema<unknown, WsTransport> = v.object({
  key: workspaceKey,
  // A workspace with no relays can't reach anyone; the built-ins at least let it sync again.
  relays: v.pipe(
    strings,
    v.transform((rs) => (rs.length ? rs : [...DEFAULT_RELAYS])),
  ),
});

export const WsRecordSchema: v.GenericSchema<unknown, WsRecord> = v.pipe(
  v.custom<Record<string, unknown>>(isRecord),
  v.object({
    code: v.pipe(
      text,
      v.check((c) => normalizeCode(c) === c),
    ),
    name: v.fallback(v.optional(text), undefined),
    transport: TransportSchema,
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
    blossom: v.fallback(v.optional(v.array(text)), undefined),
  }),
  v.transform(({ name, blossom, ...r }): WsRecord => ({ ...r, name: name ?? formatCode(r.code), ...(blossom ? { blossom } : {}) })),
);

/** Where a workspace's attachments are uploaded: its file servers, else the defaults. */
export const uploadServers = (w: WsRecord): readonly string[] => (w.blossom?.length ? w.blossom : DEFAULT_BLOSSOM);

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

/**
 * Conversations muted on this device by an app from before alert levels (a `muted` list per saved workspace), by workspace
 * code. They move to the synced level `none` once; records saved since have no such list.
 */
export function legacyMutes(raw: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!Array.isArray(raw)) return out;
  for (const x of raw as unknown[]) {
    if (!isRecord(x) || typeof x.code !== 'string') continue;
    const muted = v.parse(strings, x.muted);
    if (muted.length) out.set(x.code, muted);
  }
  return out;
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
  sound: v.fallback(v.boolean(), DEFAULT_SETTINGS.sound),
  installHint: v.fallback(v.boolean(), DEFAULT_SETTINGS.installHint),
  turn: v.fallback(v.picklist(['default', 'custom', 'off']), DEFAULT_SETTINGS.turn),
  turnUrls: v.fallback(text, DEFAULT_SETTINGS.turnUrls),
  turnUser: v.fallback(text, DEFAULT_SETTINGS.turnUser),
  turnPass: v.fallback(text, DEFAULT_SETTINGS.turnPass),
  webrtc: v.fallback(v.boolean(), DEFAULT_SETTINGS.webrtc),
  lastNet: LastNetSchema,
});

/** Saved settings over the defaults. */
export function loadSettings(raw: unknown): Settings {
  const { lastNet, ...s } = v.parse(SettingsSchema, isRecord(raw) ? raw : {});
  // Left out rather than undefined when absent (exactOptionalPropertyTypes; settings are compared as JSON).
  return { ...s, ...(lastNet ? { lastNet } : {}) };
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

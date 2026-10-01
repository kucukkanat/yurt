import * as v from 'valibot';
import { DEFAULT_RELAYS, DEFAULT_SIGNAL_URLS, SIGNAL_KINDS, isRecord, parseRelays, parseServers, type SignalKind, type Signaling, type WsTransport } from '@yurt/protocol';

/** What a new workspace starts with: shared by its members, so it travels in the invite link (except file servers). */
export type NewWorkspaceNet = { kind: 'trystero'; signal: Signaling } | { kind: 'nostr'; relays: string[]; blossom: string[] };

/** What the create step used last for each mode; it prefills the next new workspace. */
export interface LastNet {
  trystero?: Signaling;
  nostr?: { relays: string[]; blossom: string[] };
}

const strings = v.array(v.string());
/** A stored `lastNet`: each mode's part is kept only if it's well-formed, so one bad half doesn't lose the other. */
const LastNetSchema: v.GenericSchema<unknown, LastNet> = v.pipe(
  v.custom<Record<string, unknown>>(isRecord),
  v.object({
    trystero: v.fallback(v.optional(v.object({ kind: v.picklist(SIGNAL_KINDS), urls: strings })), undefined),
    nostr: v.fallback(v.optional(v.object({ relays: strings, blossom: strings })), undefined),
  }),
  v.transform(({ trystero, nostr }): LastNet => ({ ...(trystero ? { trystero } : {}), ...(nostr ? { nostr } : {}) })),
);

/** The create form's free text for a mode. */
export interface NetForm {
  sigKind: SignalKind;
  sigUrls: string;
  relays: string;
  blossom: string;
}

type TrysteroNet = Extract<NewWorkspaceNet, { kind: 'trystero' }>;
type NostrNet = Extract<NewWorkspaceNet, { kind: 'nostr' }>;

/** Nostr signaling with no URLs means nos.lol; trackers with none listed use the strategy's public ones. */
const trysteroNet = (f: Pick<NetForm, 'sigKind' | 'sigUrls'>): TrysteroNet => {
  const urls = parseRelays(f.sigUrls);
  return { kind: 'trystero', signal: { kind: f.sigKind, urls: urls.length || f.sigKind !== 'nostr' ? urls : [...DEFAULT_SIGNAL_URLS] } };
};

/** No relays listed means the built-in ones; file servers may stay empty (the defaults apply at upload). */
const nostrNet = (f: Pick<NetForm, 'relays' | 'blossom'>): NostrNet => {
  const relays = parseRelays(f.relays);
  return { kind: 'nostr', relays: relays.length ? relays : [...DEFAULT_RELAYS], blossom: parseServers(f.blossom) };
};

/** The create form's fields for `kind` as network settings; empty fields mean the built-ins. */
export const netFromForm = (kind: WsTransport['kind'], f: NetForm): NewWorkspaceNet => (kind === 'nostr' ? nostrNet(f) : trysteroNet(f));

/** The form prefill for a mode: the last workspace created in it, else the built-ins. */
export function defaultNewNet(last: LastNet | undefined, kind: WsTransport['kind']): NewWorkspaceNet {
  if (kind === 'nostr') return nostrNet({ relays: last?.nostr?.relays.join(', ') ?? '', blossom: last?.nostr?.blossom.join(', ') ?? '' });
  return trysteroNet({ sigKind: last?.trystero?.kind ?? 'nostr', sigUrls: last?.trystero?.urls.join(', ') ?? '' });
}

export const rememberNet = (last: LastNet | undefined, net: NewWorkspaceNet): LastNet =>
  net.kind === 'nostr' ? { ...last, nostr: { relays: net.relays, blossom: net.blossom } } : { ...last, trystero: net.signal };

// Before workspaces chose their network at creation, Settings held app-wide defaults in these fields.
const LEGACY = ['relays', 'blossom', 'signalKind', 'signalUrls'];
const text = (x: unknown) => (typeof x === 'string' ? x : '');

/** Saved settings without the old default fields. */
export const dropLegacy = (saved: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(saved).filter(([k]) => !LEGACY.includes(k)));

/** `lastNet` from saved settings, seeding it once from the old defaults so a returning user keeps them. */
export function migrateLastNet(saved: Record<string, unknown>): LastNet | undefined {
  // Written by rememberNet. Its parts fall back individually, so any object parses.
  if (isRecord(saved.lastNet)) return v.parse(LastNetSchema, saved.lastNet);
  if (!LEGACY.some((k) => typeof saved[k] === 'string' && saved[k] !== '')) return undefined;
  const nostr = nostrNet({ relays: text(saved.relays), blossom: text(saved.blossom) });
  return {
    trystero: trysteroNet({ sigKind: saved.signalKind === 'torrent' ? 'torrent' : 'nostr', sigUrls: text(saved.signalUrls) }).signal,
    nostr: { relays: nostr.relays, blossom: nostr.blossom },
  };
}

import { DEFAULT_RELAYS, DEFAULT_SIGNAL_URLS, parseRelays, parseServers, type SignalKind, type Signaling, type WsTransport } from '@yurt/protocol';

/** What a new workspace starts with: shared by its members, so it travels in the invite link (except file servers). */
export type NewWorkspaceNet = { kind: 'trystero'; signal: Signaling } | { kind: 'nostr'; relays: string[]; blossom: string[] };

/** What the create step used last for each mode; it prefills the next new workspace. */
export interface LastNet {
  trystero?: Signaling;
  nostr?: { relays: string[]; blossom: string[] };
}

/** The create form's free text for a mode. */
export interface NetForm {
  sigKind: SignalKind;
  sigUrls: string;
  relays: string;
  blossom: string;
}

/**
 * Empty fields mean the built-ins: Nostr relays and Nostr signaling fall back to nos.lol; trackers with
 * none listed use the strategy's public ones.
 */
export function netFromForm(kind: WsTransport['kind'], f: NetForm): NewWorkspaceNet {
  if (kind === 'nostr') {
    const relays = parseRelays(f.relays);
    return { kind, relays: relays.length ? relays : [...DEFAULT_RELAYS], blossom: parseServers(f.blossom) };
  }
  const urls = parseRelays(f.sigUrls);
  return { kind, signal: { kind: f.sigKind, urls: urls.length || f.sigKind !== 'nostr' ? urls : [...DEFAULT_SIGNAL_URLS] } };
}

/** The form prefill for a mode: the last workspace created in it, else the built-ins. */
export function defaultNewNet(last: LastNet | undefined, kind: WsTransport['kind']): NewWorkspaceNet {
  if (kind === 'nostr') return netFromForm(kind, { sigKind: 'nostr', sigUrls: '', relays: last?.nostr?.relays.join(', ') ?? '', blossom: last?.nostr?.blossom.join(', ') ?? '' });
  const t = last?.trystero;
  return netFromForm(kind, { sigKind: t?.kind ?? 'nostr', sigUrls: t?.urls.join(', ') ?? '', relays: '', blossom: '' });
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
  if (typeof saved.lastNet === 'object' && saved.lastNet !== null) return saved.lastNet as LastNet; // written by rememberNet
  if (!LEGACY.some((k) => typeof saved[k] === 'string' && saved[k] !== '')) return undefined;
  const trystero = netFromForm('trystero', { sigKind: saved.signalKind === 'torrent' ? 'torrent' : 'nostr', sigUrls: text(saved.signalUrls), relays: '', blossom: '' });
  const nostr = netFromForm('nostr', { sigKind: 'nostr', sigUrls: '', relays: text(saved.relays), blossom: text(saved.blossom) });
  return {
    ...(trystero.kind === 'trystero' ? { trystero: trystero.signal } : {}),
    ...(nostr.kind === 'nostr' ? { nostr: { relays: nostr.relays, blossom: nostr.blossom } } : {}),
  };
}

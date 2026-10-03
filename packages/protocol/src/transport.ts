import type { Ev } from './types';
import type { KeyPair } from './crypto';

export type { Presence } from './schemas';
import type { Presence } from './schemas';

/**
 * How often links act on their own. Defaults suit real use; tests shorten them to exercise the same
 * code paths (heartbeats, retries, expiry) in seconds instead of minutes.
 */
export interface LinkTiming {
  /** Presence heartbeat. 60 s. */
  beatMs: number;
  /** How long a member's presence counts without a heartbeat. 150 s. */
  presenceTtlMs: number;
  /** Resend events relays haven't acknowledged. 15 s. */
  retryMs: number;
  /** Check connectivity, catch up after reconnecting and expire presence. 5 s. */
  sweepMs: number;
  /** Wait before reconnecting a dropped relay. Unset: nostr-tools' backoff, 10 s growing to 60 s. */
  reconnectMs?: number;
}

/** What a data link may see and do in its workspace. Implemented by WorkspacePeer. */
export interface LinkHost {
  readonly code: string;
  readonly kp: KeyPair;
  readonly events: ReadonlyMap<string, Ev>;
  /** Published here but not yet delivered to anyone. */
  readonly queued: ReadonlySet<string>;
  /** Banned in the current state: links ignore their presence and send them nothing. */
  isBanned(pub: string): boolean;
  /** Untrusted input: the host validates every event before accepting it. */
  receive(evs: unknown): void;
  /** A lobby event under invite `jk` (see join.ts): maybe a request to join. Untrusted. */
  joinRequest(jk: string, content: string): void;
  /** These events reached someone else and no longer need "sends when you reconnect". */
  delivered(ids: readonly string[]): void;
  /** Presence or link connectivity changed. */
  changed(): void;
  error(msg: string): void;
}

/** Every workspace key a member holds (epoch null = not yet known), the one new events use, and the invites to watch for requests. */
export interface LinkKeys {
  readonly all: readonly { key: string; epoch: number | null }[];
  readonly write: string;
  readonly lobby: readonly string[];
}

/** Carries events and presence for a workspace: encrypted on its Nostr relays (see transports/nostr.ts). */
export interface DataLink {
  /** Who is online, keyed by a link-specific id. Every entry's `pub` is authenticated. */
  readonly presence: ReadonlyMap<string, Presence>;
  /** Whether the link can currently deliver anything (a relay is reachable). */
  readonly connected: boolean;
  send(evs: readonly Ev[]): void;
  setPresence(p: Presence): void;
  /** Each configured relay → connected. */
  relayStatus(): ReadonlyMap<string, boolean>;
  /** The workspace keys changed (a rotation), or the invites to watch did. Read with all of them, write with `write`. */
  setKeys(keys: LinkKeys): void;
  /** Sends an admitted joiner their sealed grant (see join.ts). */
  grant(jk: string, to: string, content: string): void;
  leave(): void;
}

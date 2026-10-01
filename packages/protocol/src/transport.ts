import type { Ev } from './types';
import type { KeyPair } from './crypto';

export interface Presence {
  pub: string;
  st: 'online' | 'away';
  typing?: string | null;                              // channel id
  agents?: Record<string, { working?: string | null }>; // agentId → channel it's working in
  bridge?: boolean;
  /** Relay workspaces: this member is in a huddle and needs the WebRTC room, so opted-in members should join it. */
  rtc?: boolean;
}

/** What a data link may see and do in its workspace. Implemented by WorkspacePeer. */
export interface LinkHost {
  readonly code: string;
  readonly kp: KeyPair;
  readonly events: ReadonlyMap<string, Ev>;
  /** Published here but not yet delivered to anyone. */
  readonly queued: ReadonlySet<string>;
  /** Handshaked WebRTC peers (peerId → identity), for links that route over the room. */
  readonly peers: ReadonlyMap<string, { pub: string }>;
  visibleFor(pub: string): Ev[];
  /** Banned in the current state: links ignore their presence and send them nothing. */
  isBanned(pub: string): boolean;
  /** Untrusted input: the host validates every event before accepting it. */
  receive(evs: unknown): void;
  /** These events reached someone else and no longer need "sends when you reconnect". */
  delivered(ids: readonly string[]): void;
  /** Presence or link connectivity changed. */
  changed(): void;
  error(msg: string): void;
}

/**
 * Carries events and presence for a workspace. Trystero sends them peer to peer over its WebRTC
 * room, which also carries files and huddles. Nostr stores them encrypted on relays, with files
 * on Blossom; a Nostr workspace uses WebRTC only for opted-in voice and video.
 */
/** Every workspace key a member holds (epoch null = not yet known), and the one new events use. */
export interface LinkKeys { readonly all: readonly { key: string; epoch: number | null }[]; readonly write: string }

export interface DataLink {
  /** Who is online, keyed by a link-specific id. Every entry's `pub` is authenticated. */
  readonly presence: ReadonlyMap<string, Presence>;
  /** Whether the link can currently deliver anything (a peer or a relay is reachable). */
  readonly connected: boolean;
  send(evs: readonly Ev[]): void;
  setPresence(p: Presence): void;
  /** Relay links: each configured relay → connected. */
  relayStatus?(): ReadonlyMap<string, boolean>;
  /** Relay links: the workspace keys changed (a rotation). Read with all of them, write with `write`. */
  setKeys?(keys: LinkKeys): void;
  onPeerJoin?(peerId: string, pub: string): void;
  onPeerLeave?(peerId: string): void;
  leave(): void;
}

import type { Ev } from './types';
import type { KeyPair } from './crypto';

export interface Presence {
  pub: string;
  st: 'online' | 'away';
  typing?: string | null;                              // channel id
  agents?: Record<string, { working?: string | null }>; // agentId → channel it's working in
  bridge?: boolean;
  /** Relay workspaces: this member needs the WebRTC room now (huddle or file fetch), so others should join it. */
  rtc?: boolean;
}

/** What a data link may see and do in its workspace. Implemented by WorkspacePeer. */
export interface LinkHost {
  readonly code: string;
  readonly kp: KeyPair;
  readonly events: ReadonlyMap<string, Ev>;
  /** Handshaked WebRTC peers (peerId → identity), for links that route over the room. */
  readonly peers: ReadonlyMap<string, { pub: string }>;
  visibleFor(pub: string): Ev[];
  /** Untrusted input: the host validates every event before accepting it. */
  receive(evs: unknown): void;
  /** These events (or all queued ones) reached someone else and no longer need "sends when you reconnect". */
  delivered(ids: readonly string[] | 'all'): void;
  /** Presence or link connectivity changed. */
  changed(): void;
  error(msg: string): void;
}

/**
 * Carries events and presence for a workspace. Trystero sends them peer to peer over the room;
 * Nostr stores them encrypted on relays. Huddles and files always stay on the WebRTC room.
 */
export interface DataLink {
  /** Who is online, keyed by a link-specific id. Every entry's `pub` is authenticated. */
  readonly presence: ReadonlyMap<string, Presence>;
  /** Whether the link can currently deliver anything (a peer or a relay is reachable). */
  readonly connected: boolean;
  send(evs: readonly Ev[]): void;
  setPresence(p: Presence): void;
  onPeerJoin?(peerId: string, pub: string): void;
  onPeerLeave?(peerId: string): void;
  leave(): void;
}

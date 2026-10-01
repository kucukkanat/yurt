import type { BlobRef } from './blossom';
export type EvType =
  | 'ws.create' | 'profile' | 'ch.create' | 'ch.update'
  | 'msg' | 'edit' | 'del' | 'react' | 'pin'
  | 'role' | 'ban' | 'agent' | 'approve' | 'rekey';

/** A signed, immutable workspace event. Everything in a workspace is a log of these. */
export interface Ev<B = any> {
  id: string;      // sha256(canonical(unsigned fields)) hex, 32 chars
  ws: string;      // workspace code, normalized (8 chars, no dash)
  t: EvType;
  a: string;       // author public key (ed25519, hex)
  ag?: string;     // agent id when an agent authored it (signed by its owner key)
  ts: number;      // ms since epoch, author clock (integer); authors choose it, so it proves nothing
  ch?: string;     // channel id, "dm:<pubA>:<pubB>" or "adm:<owner>:<agentId>"
  to?: string;     // private recipient pubkey (DMs); only author + recipient ever hold it
  b: B;
  sig: string;     // ed25519 signature over id, hex
}

export type UnsignedEv<B = any> = Omit<Ev<B>, 'id' | 'sig'>;

export interface FileRef {
  id: string; name: string; size: number; type: string;
  /** Relay workspaces: the file sealed on Blossom. Absent on Trystero, where peers serve files over WebRTC. */
  blob?: BlobRef;
}

export interface TraceStep {
  title: string;
  tool?: string;
  status: 'done' | 'error' | 'running' | 'waiting' | 'skipped';
  ms?: number;
  detail?: string;
}

export interface ApprovalReq {
  req: string;
  title: string;
  kind?: string;
  options: { id: string; name: string; kind: string }[];
}

export interface MsgBody {
  text: string;
  parent?: string;
  files?: FileRef[];
  trace?: TraceStep[];
  meta?: string;          // "Read 6 files · 8.3s"
  approval?: ApprovalReq;
  /** A thread reply that also shows in the channel (an agent posting "in a thread + in the channel"). */
  alsoInChannel?: true;
}

export interface AgentBody {
  id: string;
  name: string;
  handle: string;
  runtime: string;
  model?: string;
  /** Kept for peers that predate `postIn`/`respondTo`: 'thread' when postIn.thread, else 'channel'. */
  replyIn: 'thread' | 'channel';
  /** What makes it answer: @mentions, and/or replies in threads it takes part in (no @ needed). */
  respondTo?: AgentTriggers;
  /** Where it answers: in a thread, in the channel, or both (a thread reply also shown in the channel). */
  postIn?: AgentPlacement;
  /** Other members may find it and message it directly (their chats are visible to its owner). */
  discoverable?: boolean;
  removed?: boolean;
}
export interface AgentTriggers { mentions: boolean; replies: boolean }
export interface AgentPlacement { thread: boolean; channel: boolean }

export interface ProfileBody { name: string; handle: string }
export interface ChannelBody { id: string; name: string; topic?: string }
export interface RoleBody { target: string; admin: boolean }
export interface BanBody { target: string; on: boolean }
/**
 * Relay workspaces: an admin replaces the workspace key (after a ban). `keys` maps each remaining
 * member's pubkey to the new key sealed with the admin↔member pair key; `history` seals every earlier
 * key under the new one, so whoever holds the new key can still read the whole history.
 */
export interface RekeyBody { epoch: number; keys: Record<string, string>; history: string }
export interface ReactBody { target: string; icon: string; on: boolean }
export interface PinBody { target: string; on: boolean }
export interface EditBody { target: string; text: string }
export interface DelBody { target: string }
export interface ApproveBody { req: string; option: string }

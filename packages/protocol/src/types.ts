import type { BlobRef } from './blossom';
import type { EventType } from './schemas';

export type EvType = EventType;

// Optional body fields also accept `undefined`: bodies are built by spreading optional values, and the
// wire form (canonical JSON) drops undefined fields anyway. Received bodies are parsed by schemas.ts.

/** A signed, immutable workspace event. Everything in a workspace is a log of these. */
export interface Ev<B = unknown> {
  id: string; // sha256(canonical(unsigned fields)) hex, 32 chars
  ws: string; // workspace code, normalized (8 chars, no dash)
  t: EvType;
  a: string; // author public key (ed25519, hex)
  ag?: string | undefined; // agent id when an agent authored it (signed by its owner key)
  ts: number; // ms since epoch, author clock (integer); authors choose it, so it proves nothing
  ch?: string | undefined; // channel id, "dm:<pubA>:<pubB>" or "adm:<owner>:<agentId>"
  to?: string | undefined; // private recipient pubkey (DMs); only author + recipient ever hold it
  b: B;
  sig: string; // ed25519 signature over id, hex
}

export type UnsignedEv<B = unknown> = Omit<Ev<B>, 'id' | 'sig'>;

export interface FileRef {
  id: string;
  name: string;
  size: number;
  type: string;
  /** The file sealed on Blossom. Absent or malformed: nobody can download it. */
  blob?: BlobRef | undefined;
}

export interface TraceStep {
  title: string;
  tool?: string | undefined;
  status: 'done' | 'error' | 'running' | 'waiting' | 'skipped';
  ms?: number | undefined;
  detail?: string | undefined;
}

export interface ApprovalReq {
  req: string;
  title: string;
  kind?: string | undefined;
  options: { id: string; name: string; kind: string }[];
}

export interface MsgBody {
  /** Missing means empty (a message with only files). */
  text?: string | undefined;
  parent?: string | undefined;
  files?: FileRef[] | undefined;
  trace?: TraceStep[] | undefined;
  meta?: string | undefined; // "Read 6 files · 8.3s"
  approval?: ApprovalReq | undefined;
  poll?: PollSpec | undefined;
  meet?: MeetSpec | undefined;
  /** A thread reply that also shows in the channel (an agent posting "in a thread + in the channel"). */
  alsoInChannel?: true | undefined;
}

export interface AgentBody {
  id: string;
  name: string;
  handle: string;
  runtime: string;
  model?: string | undefined;
  /** Kept for peers that predate `postIn`/`respondTo`: 'thread' when postIn.thread, else 'channel'. */
  replyIn: 'thread' | 'channel';
  /** What makes it answer: @mentions, and/or replies in threads it takes part in (no @ needed). */
  respondTo?: AgentTriggers | undefined;
  /** Where it answers: in a thread, in the channel, or both (a thread reply also shown in the channel). */
  postIn?: AgentPlacement | undefined;
  /** Other members may find it and message it directly (their chats are visible to its owner). */
  discoverable?: boolean | undefined;
  removed?: boolean | undefined;
}
export interface AgentTriggers {
  mentions: boolean;
  replies: boolean;
}
export interface AgentPlacement {
  thread: boolean;
  channel: boolean;
}

export interface ProfileBody {
  name: string;
  /** Missing means none yet. */
  handle?: string | undefined;
}
export interface ChannelBody {
  id: string;
  name: string;
  topic?: string | undefined;
}
export interface RoleBody {
  target: string;
  admin: boolean;
}
export interface BanBody {
  target: string;
  on: boolean;
}
/**
 * An admin replaces the workspace key (after a ban). `keys` maps each remaining
 * member's pubkey to the new key sealed with the admin↔member pair key; `history` seals every earlier
 * key under the new one, so whoever holds the new key can still read the whole history.
 */
export interface RekeyBody {
  epoch: number;
  keys: Record<string, string>;
  history: string;
}
/**
 * An invite link's join key (`jk`): a link carries it instead of the workspace key, so holding a link only lets
 * someone ask to join. Any member can make one (`on: true`); its maker or an admin revokes it (`on: false`).
 * `exp` (ms): requests after it are ignored.
 */
export interface InviteBody {
  jk: string;
  on: boolean;
  exp?: number | undefined;
}
/** An admin lets `target` in (`on: true`, and hands them the key) or turns them away, answering a request through invite `jk`. */
export interface AdmitBody {
  target: string;
  jk?: string | undefined;
  on: boolean;
}
export interface ReactBody {
  target: string;
  icon: string;
  on: boolean;
}
export interface PinBody {
  target: string;
  on: boolean;
}
export interface EditBody {
  target: string;
  text: string;
}
export interface DelBody {
  target: string;
}
export interface ApproveBody {
  req: string;
  option: string;
}

/* ---------- collaboration ---------- */

/** Who something is assigned to, who voted or answered: a member (`pub`) or one of their agents (`pub/agentId`). */
export type Actor = string;

/** A poll carried by a `msg`: the message is the poll, so it lives in the timeline, threads and agent context. */
export interface PollSpec {
  q: string;
  options: string[];
  multi?: true | undefined;
  /** No votes count from this time on (ms). Readers decide, so nobody has to be online to close it. */
  closes?: number | undefined;
}
/** A meeting carried by a `msg`; members and agents answer with `rsvp`. */
export interface MeetSpec {
  title: string;
  at: number;
  /** Minutes. */
  dur?: number | undefined;
}
export type TaskStatus = 'open' | 'doing' | 'blocked' | 'done';
export interface TaskBody {
  id: string;
  title: string;
  ch: string;
  /** The message it was made from. */
  src?: string | undefined;
  assignee?: Actor | undefined;
  due?: number | undefined;
}
export interface TaskSetBody {
  id: string;
  title?: string | undefined;
  /** null unassigns. */
  assignee?: Actor | null | undefined;
  due?: number | null | undefined;
  status?: TaskStatus | undefined;
  /** A progress note or a handoff summary, kept in the task's activity. */
  note?: string | undefined;
}
export interface VoteBody {
  target: string;
  choices: number[];
}
export interface RsvpBody {
  target: string;
  going: 'yes' | 'no' | 'maybe';
}
export interface DecideBody {
  target: string;
  text: string;
  on: boolean;
}
export type DocKind = 'text' | 'board';
export interface DocBody {
  id: string;
  title: string;
  ch: string;
  kind: DocKind;
}
export interface DocSetBody {
  id: string;
  title?: string | undefined;
  archived?: boolean | undefined;
}
/** A CRDT (Yjs) update to a doc, base64url. */
export interface DocOpBody {
  doc: string;
  u: string;
}
/** A proposed text change: replace the first `find` with `replace` (empty `find` appends). */
export interface SuggestBody {
  doc: string;
  find: string;
  replace: string;
  note?: string | undefined;
}
export interface SuggestResBody {
  target: string;
  accept: boolean;
}
/** Private to the author's own devices (`to` = author). */
export interface SaveBody {
  target: string;
  on: boolean;
}
/** Private to the author's own devices: read up to `ts` in `ch`. */
export interface ReadBody {
  ch: string;
  ts: number;
}

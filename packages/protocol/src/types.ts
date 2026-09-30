export type EvType =
  | 'ws.create' | 'profile' | 'ch.create' | 'ch.update'
  | 'msg' | 'edit' | 'del' | 'react' | 'pin'
  | 'role' | 'ban' | 'agent' | 'approve';

/** A signed, immutable workspace event. Everything in a workspace is a log of these. */
export interface Ev<B = any> {
  id: string;      // sha256(canonical(unsigned fields)) hex, 32 chars
  ws: string;      // workspace code, normalized (8 chars, no dash)
  t: EvType;
  a: string;       // author public key (ed25519, hex)
  ag?: string;     // agent id when an agent authored it (signed by its owner key)
  ts: number;      // ms since epoch, author clock
  ch?: string;     // channel id, "dm:<pubA>:<pubB>" or "adm:<owner>:<agentId>"
  to?: string;     // private recipient pubkey (DMs); only author + recipient ever hold it
  b: B;
  sig: string;     // ed25519 signature over id, hex
}

export type UnsignedEv<B = any> = Omit<Ev<B>, 'id' | 'sig'>;

export interface FileRef { id: string; name: string; size: number; type: string }

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
}

export interface AgentBody {
  id: string;
  name: string;
  handle: string;
  runtime: string;
  model?: string;
  replyIn: 'thread' | 'channel';
  removed?: boolean;
}

export interface ProfileBody { name: string; handle: string }
export interface ChannelBody { id: string; name: string; topic?: string }
export interface RoleBody { target: string; admin: boolean }
export interface BanBody { target: string; on: boolean }
export interface ReactBody { target: string; icon: string; on: boolean }
export interface PinBody { target: string; on: boolean }
export interface EditBody { target: string; text: string }
export interface DelBody { target: string }
export interface ApproveBody { req: string; option: string }

import type { AgentTriggers, AgentPlacement } from './types';
import type { WsTransport } from './invite';
/** Messages between the Yurt web app / bridge UI and the local bridge over ws://127.0.0.1:7717/ws. */

export const BRIDGE_PORT = 7717;
export const BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}/ws`;

export type RuntimeId = 'copilot' | 'opencode' | 'codex' | 'claude' | 'pi';
export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other';
export const TOOL_KINDS: ToolKind[] = ['read', 'search', 'think', 'fetch', 'edit', 'move', 'delete', 'execute', 'other'];

export interface RuntimeStatus {
  id: RuntimeId;
  name: string;
  installed: boolean;
  version?: string;
  auth: 'unknown' | 'signed-in' | 'signed-out';
  busy?: 'installing' | 'checking' | 'signing-in';
  loginHint?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  handle: string;
  runtime: RuntimeId;
  model?: string;
  workdir: string;
  instructions: string;
  autoApprove: ToolKind[];
  contextSize: number; // last N messages sent as context
  /** What makes it answer in rooms: @mentions and/or replies in threads it takes part in. */
  respondTo: AgentTriggers;
  /** Where it answers: a thread, the channel, or both (thread reply also shown in the channel). At least one. */
  postIn: AgentPlacement;
  /** Others in the workspace may find it and message it directly; its owner can read those chats. */
  discoverable: boolean;
  /** Off: the agent is hidden from workspace presence and answers nothing until switched back on. */
  online: boolean;
}

export interface BridgeWorkspace {
  code: string;
  name: string;
  agents: string[];
  peers?: number;
}

export interface BridgeState {
  version: string;
  identity: { pub: string; name: string; handle: string } | null;
  agents: (AgentConfig & { status: 'idle' | 'working' | 'waiting' | 'error' })[];
  workspaces: BridgeWorkspace[];
  runtimes: RuntimeStatus[];
  startOnLogin: boolean;
  allowedOrigins: string[];
  pairingCode?: string; // only sent to the local bridge UI
  home?: string; // only sent to the local bridge UI
}

export type ToBridge =
  | { t: 'hello'; token?: string }
  | { t: 'pair'; code: string }
  | { t: 'identity'; phrase: string; name: string; handle: string }
  // `transport` is optional so an older web app's joins still work; absent means Trystero.
  | { t: 'ws.join'; code: string; name: string; transport?: WsTransport; creator?: string | null; agents: string[] }
  | { t: 'ws.leave'; code: string }
  | { t: 'ws.agents'; code: string; agents: string[] }
  // bridge UI only (local admin token)
  | { t: 'agent.save'; agent: AgentConfig }
  | { t: 'agent.remove'; id: string }
  | { t: 'runtime.install'; id: RuntimeId }
  | { t: 'runtime.check'; id: RuntimeId }
  | { t: 'runtime.login'; id: RuntimeId }
  | { t: 'startOnLogin'; on: boolean }
  | { t: 'pair.rotate' }
  | { t: 'origins'; list: string[] };

export type FromBridge =
  | { t: 'hello'; ok: boolean; paired: boolean; admin: boolean; version: string }
  | { t: 'paired'; token: string }
  | { t: 'error'; msg: string }
  | { t: 'state'; state: BridgeState }
  | { t: 'log'; at: number; level: 'info' | 'warn' | 'error' | 'acp'; src: string; msg: string };

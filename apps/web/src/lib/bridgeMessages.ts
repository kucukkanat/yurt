import * as v from 'valibot';
import { TOOL_KINDS, isRecord, parseOr, type BridgeState, type FromBridge, type RuntimeId, type RuntimeStatus } from '@yurt/protocol';

/**
 * Messages from the local yurt-bridge. It's the user's own program, but possibly a newer or older version,
 * so its messages are parsed: an unknown message is ignored, and a malformed part of the state (one agent,
 * one workspace) is dropped or defaulted instead of breaking the Agents screens.
 */

const RUNTIME_IDS = ['copilot', 'opencode', 'codex', 'claude', 'pi'] as const satisfies readonly RuntimeId[];
// Fails to compile when protocol adds a runtime this list doesn't know.
const allRuntimes: Record<Exclude<RuntimeId, (typeof RUNTIME_IDS)[number]>, never> = {};
void allRuntimes;

const text = v.string();
const flag = (fallback: boolean) => v.fallback(v.boolean(), fallback);
const optional = <S extends v.GenericSchema>(s: S) => v.fallback(v.optional(s), undefined);
/** The entries of a list that parse; anything else is an empty list. */
const listOf = <T>(s: v.GenericSchema<unknown, T>) =>
  v.pipe(
    v.optional(v.unknown(), null), // a missing key is an empty value (via the transform), not an invalid record
    v.transform((x): T[] => (Array.isArray(x) ? x.flatMap((e) => (v.is(s, e) ? [v.parse(s, e)] : [])) : [])),
  );

type BridgeAgent = BridgeState['agents'][number];
const AgentSchema: v.GenericSchema<unknown, BridgeAgent> = v.pipe(
  v.object({
    id: text,
    name: text,
    handle: text,
    runtime: v.picklist(RUNTIME_IDS),
    model: optional(text),
    workdir: v.fallback(text, ''),
    instructions: v.fallback(text, ''),
    autoApprove: listOf(v.picklist(TOOL_KINDS)),
    contextSize: v.fallback(v.pipe(v.number(), v.integer(), v.minValue(1)), 20),
    // Bridges from before triggers/placement sent only `replyIn`.
    replyIn: v.fallback(v.picklist(['thread', 'channel']), 'thread'),
    respondTo: optional(v.object({ mentions: v.boolean(), replies: v.boolean() })),
    postIn: optional(v.object({ thread: v.boolean(), channel: v.boolean() })),
    discoverable: flag(false),
    status: v.fallback(v.picklist(['idle', 'working', 'waiting', 'error']), 'idle'),
  }),
  v.transform(
    ({ replyIn, respondTo, postIn, model, ...a }): BridgeAgent => ({
      ...a,
      ...(model === undefined ? {} : { model }),
      respondTo: respondTo ?? { mentions: true, replies: false },
      postIn: postIn && (postIn.thread || postIn.channel) ? postIn : { thread: replyIn === 'thread', channel: replyIn === 'channel' },
    }),
  ),
);

const RuntimeSchema: v.GenericSchema<unknown, RuntimeStatus> = v.pipe(
  v.object({
    id: v.picklist(RUNTIME_IDS),
    name: text,
    installed: flag(false),
    version: optional(text),
    auth: v.fallback(v.picklist(['unknown', 'signed-in', 'signed-out']), 'unknown'),
    busy: optional(v.picklist(['installing', 'checking', 'signing-in'])),
    loginHint: optional(text),
  }),
  v.transform(
    ({ version, busy, loginHint, ...r }): RuntimeStatus => ({
      ...r,
      ...(version === undefined ? {} : { version }),
      ...(busy === undefined ? {} : { busy }),
      ...(loginHint === undefined ? {} : { loginHint }),
    }),
  ),
);

const StateSchema: v.GenericSchema<unknown, BridgeState> = v.pipe(
  v.custom<Record<string, unknown>>(isRecord),
  v.object({
    version: v.fallback(text, ''),
    identity: v.fallback(v.nullable(v.object({ pub: text, name: text, handle: text })), null),
    agents: listOf(AgentSchema),
    workspaces: listOf(
      v.pipe(
        v.object({ code: text, name: v.fallback(text, ''), agents: listOf(text), peers: optional(v.pipe(v.number(), v.integer(), v.minValue(0))) }),
        v.transform(({ peers, ...w }) => ({ ...w, ...(peers === undefined ? {} : { peers }) })),
      ),
    ),
    runtimes: listOf(RuntimeSchema),
    startOnLogin: flag(false),
    allowedOrigins: listOf(text),
    pairingCode: optional(text),
    home: optional(text),
  }),
  v.transform(({ pairingCode, home, ...s }): BridgeState => ({ ...s, ...(pairingCode === undefined ? {} : { pairingCode }), ...(home === undefined ? {} : { home }) })),
);

const MessageSchema: v.GenericSchema<unknown, FromBridge> = v.variant('t', [
  v.object({ t: v.literal('hello'), ok: flag(true), paired: flag(false), admin: flag(false), version: v.fallback(text, '') }),
  v.object({ t: v.literal('paired'), token: v.pipe(text, v.nonEmpty()) }),
  v.object({ t: v.literal('error'), msg: v.fallback(text, '') }),
  v.object({ t: v.literal('state'), state: StateSchema }),
  v.object({
    t: v.literal('log'),
    at: v.fallback(v.number(), 0),
    level: v.fallback(v.picklist(['info', 'warn', 'error', 'acp']), 'info'),
    src: v.fallback(text, ''),
    msg: v.fallback(text, ''),
  }),
]);

/** A WebSocket frame from the bridge as a typed message, or null for anything else (bad JSON, unknown type). */
export function parseBridgeMessage(data: unknown): FromBridge | null {
  if (typeof data !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null; // not JSON: not a message
  }
  return parseOr(MessageSchema, json);
}

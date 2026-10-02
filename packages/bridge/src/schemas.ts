import * as v from 'valibot';
import { isEventShape, isRecord, isWorkspaceKey, parseOr, TOOL_KINDS, type Ev, type RuntimeId } from '@yurt/protocol';

/**
 * Schemas for everything the bridge reads from outside its own code: agent processes (ACP JSON-RPC on stdout),
 * browsers (the local WebSocket), and files on disk (config, identity, workspace logs). Each is checked once
 * here; the rest of the bridge works with typed values.
 *
 * Fields that older or sloppier writers get wrong are `lenient` (a wrong type is dropped, not fatal), so a
 * hand-edited config or a chatty agent degrades instead of breaking the bridge.
 */

const record = v.custom<Record<string, unknown>>(isRecord);
/** v.object accepts arrays that happen to carry the keys; messages must be plain objects. */
const obj = <E extends v.ObjectEntries>(entries: E) => v.pipe(record, v.object(entries));
/** A field whose wrong type is dropped (undefined) instead of rejecting the whole value. */
const lenient = <S extends v.GenericSchema>(s: S) => v.fallback(v.optional(s), undefined);
/** The entries of a list that match `s`; anything that isn't a list is an empty one. */
const listOf = <S extends v.GenericSchema>(s: S) =>
  v.fallback(
    v.pipe(
      v.array(v.unknown()),
      v.transform((xs): v.InferOutput<S>[] =>
        xs.flatMap((item) => {
          const r = v.safeParse(s, item);
          return r.success ? [r.output] : [];
        }),
      ),
    ),
    [],
  );
const flags = <K extends string>(...keys: K[]) => obj(Object.fromEntries(keys.map((k) => [k, v.boolean()])) as Record<K, v.BooleanSchema<undefined>>);

export const RUNTIME_ID_LIST = ['copilot', 'opencode', 'codex', 'claude', 'pi'] as const satisfies readonly RuntimeId[];
const RuntimeIdSchema = v.picklist(RUNTIME_ID_LIST);

/* ---------- ACP (agent processes) ---------- */

const RpcIdSchema = v.union([v.number(), v.string()]);

/** One JSON-RPC message from an agent. Routing needs only `id` and `method`; payloads are parsed per method below. */
export const RpcMessageSchema = obj({
  id: v.optional(v.nullable(RpcIdSchema)),
  method: v.optional(v.string()),
  params: v.optional(v.unknown()),
  result: v.optional(v.unknown()),
  error: v.optional(v.unknown()),
});
export type RpcMessage = v.InferOutput<typeof RpcMessageSchema>;

/** A JSON-RPC error object; anything missing or mistyped falls back so the caller still gets an error. */
export const RpcErrorSchema = v.fallback(obj({ code: lenient(v.number()), message: lenient(v.string()), data: v.optional(v.unknown()) }), {});

const AcpUpdateSchema = obj({
  sessionUpdate: v.pipe(v.string(), v.nonEmpty()),
  content: lenient(obj({ type: v.fallback(v.string(), ''), text: lenient(v.string()) })),
  toolCallId: lenient(v.string()),
  title: lenient(v.string()),
  kind: lenient(v.string()),
  status: lenient(v.string()),
});
export type AcpUpdate = v.InferOutput<typeof AcpUpdateSchema>;

/** `session/update` params: what the agent is doing (message text, tool calls). */
export const SessionUpdateSchema = obj({ sessionId: v.fallback(v.string(), ''), update: AcpUpdateSchema });

const PermissionOptionSchema = v.pipe(
  obj({ optionId: v.string(), name: lenient(v.string()), kind: v.fallback(v.string(), '') }),
  v.transform((o) => ({ optionId: o.optionId, name: o.name ?? o.optionId, kind: o.kind })),
);
const nonEmptyOr = (fallback: string) => v.fallback(v.pipe(v.string(), v.nonEmpty()), fallback);
// A kind outside TOOL_KINDS (ACP's `switch_mode`, or anything a CLI invents) counts as 'other', so the owner can still
// auto-approve it: with every box checked, nothing asks.
const ToolCallSchema = v.fallback(obj({ kind: v.fallback(v.picklist(TOOL_KINDS), 'other'), title: nonEmptyOr('use a tool') }), {
  kind: 'other',
  title: 'use a tool',
});

/** `session/request_permission` params: the tool the agent wants to use and the answers it offers. */
export const PermissionRequestSchema = v.fallback(
  v.pipe(
    obj({ toolCall: ToolCallSchema, options: listOf(PermissionOptionSchema) }),
    v.transform((p) => ({ kind: p.toolCall.kind, title: p.toolCall.title, options: p.options })),
  ),
  { kind: 'other', title: 'use a tool', options: [] },
);

/** `initialize` result: only the sign-in methods are used. */
export const InitializeResultSchema = v.fallback(obj({ authMethods: listOf(obj({ id: v.string() })) }), { authMethods: [] });
/** `session/new` result. */
export const NewSessionResultSchema = obj({ sessionId: v.pipe(v.string(), v.nonEmpty()) });

/* ---------- agents (bridge UI and config.json) ---------- */

/**
 * An agent as the bridge UI sends it or config.json stores it, before `sanitize` turns it into an AgentConfig.
 * Everything is lenient: sanitize explains what's missing in words the UI can show.
 */
export const AgentDraftSchema = obj({
  id: v.fallback(v.string(), ''),
  name: v.fallback(v.string(), ''),
  handle: v.fallback(v.string(), ''),
  runtime: v.fallback(v.string(), ''),
  model: lenient(v.string()),
  workdir: v.fallback(v.string(), ''),
  instructions: v.fallback(v.string(), ''),
  autoApprove: listOf(v.picklist(TOOL_KINDS)),
  // A number, or a numeric string from a form field; anything else is the default (Number() on an object can throw).
  contextSize: lenient(v.union([v.number(), v.string()])),
  replyIn: lenient(v.picklist(['thread', 'channel'])),
  respondTo: lenient(flags('mentions', 'replies')),
  postIn: lenient(flags('thread', 'channel')),
  discoverable: lenient(v.boolean()),
  online: lenient(v.boolean()),
});
export type AgentDraft = v.InferOutput<typeof AgentDraftSchema>;

/* ---------- transports ---------- */

/** A workspace's key and relays (see WsTransport in @yurt/protocol). */
export const TransportSchema = v.object({ key: v.pipe(v.string(), v.check(isWorkspaceKey)), relays: v.array(v.string()) });

/* ---------- browser ↔ bridge ---------- */

const codeField = v.pipe(v.string(), v.nonEmpty());
/** Every message a browser may send. Anything else is answered with an error and ignored. */
export const ToBridgeSchema = v.variant('t', [
  v.object({ t: v.literal('hello'), token: v.optional(v.string()) }),
  v.object({ t: v.literal('pair'), code: v.string() }),
  v.object({ t: v.literal('identity'), phrase: v.string(), name: v.string(), handle: v.string() }),
  v.object({
    t: v.literal('ws.join'),
    code: codeField,
    name: v.string(),
    transport: TransportSchema,
    creator: v.optional(v.nullable(v.string())),
    agents: v.array(v.string()),
  }),
  v.object({ t: v.literal('ws.leave'), code: codeField }),
  v.object({ t: v.literal('ws.agents'), code: codeField, agents: v.array(v.string()) }),
  v.object({ t: v.literal('agent.save'), agent: AgentDraftSchema }),
  v.object({ t: v.literal('agent.remove'), id: v.string() }),
  v.object({ t: v.literal('runtime.install'), id: RuntimeIdSchema }),
  v.object({ t: v.literal('runtime.check'), id: RuntimeIdSchema }),
  v.object({ t: v.literal('runtime.login'), id: RuntimeIdSchema }),
  v.object({ t: v.literal('startOnLogin'), on: v.boolean() }),
  v.object({ t: v.literal('pair.rotate') }),
  v.object({ t: v.literal('origins'), list: v.array(v.string()) }),
]);
export type ToBridgeMsg = v.InferOutput<typeof ToBridgeSchema>;

/* ---------- bridge → its own setup page ---------- */

const AgentStatusSchema = v.picklist(['idle', 'working', 'waiting', 'error']);
const RuntimeStatusSchema = v.object({
  id: RuntimeIdSchema,
  name: v.string(),
  installed: v.boolean(),
  version: v.exactOptional(v.string()),
  auth: v.picklist(['unknown', 'signed-in', 'signed-out']),
  busy: v.exactOptional(v.picklist(['installing', 'checking', 'signing-in'])),
  loginHint: v.exactOptional(v.string()),
});
const AgentConfigSchema = v.object({
  id: v.string(),
  name: v.string(),
  handle: v.string(),
  runtime: RuntimeIdSchema,
  model: v.exactOptional(v.string()),
  workdir: v.string(),
  instructions: v.string(),
  autoApprove: v.array(v.picklist(TOOL_KINDS)),
  contextSize: v.number(),
  respondTo: v.object({ mentions: v.boolean(), replies: v.boolean() }),
  postIn: v.object({ thread: v.boolean(), channel: v.boolean() }),
  discoverable: v.boolean(),
  online: v.boolean(),
  status: AgentStatusSchema,
});
/** The bridge's state as its own page uses it: the page always gets its pairing code and home folder. */
const PageStateSchema = v.object({
  version: v.string(),
  identity: v.nullable(v.object({ pub: v.string(), name: v.string(), handle: v.string() })),
  agents: v.array(AgentConfigSchema),
  workspaces: v.array(v.object({ code: v.string(), name: v.string(), agents: v.array(v.string()), peers: v.exactOptional(v.number()) })),
  runtimes: v.array(RuntimeStatusSchema),
  startOnLogin: v.boolean(),
  allowedOrigins: v.array(v.string()),
  pairingCode: v.fallback(v.string(), '------'),
  home: v.fallback(v.string(), '~'),
});
export type PageState = v.InferOutput<typeof PageStateSchema>;
const LogSchema = v.object({ t: v.literal('log'), at: v.number(), level: v.picklist(['info', 'warn', 'error', 'acp']), src: v.string(), msg: v.string() });
export type PageLog = v.InferOutput<typeof LogSchema>;
const FromBridgeSchema = v.variant('t', [
  v.object({ t: v.literal('hello'), ok: v.boolean(), paired: v.boolean(), admin: v.boolean(), version: v.string() }),
  v.object({ t: v.literal('paired'), token: v.string() }),
  v.object({ t: v.literal('error'), msg: v.string() }),
  v.object({ t: v.literal('state'), state: PageStateSchema }),
  LogSchema,
]);

/** A message from the bridge, or null for anything that isn't one (the page ignores it). */
export function parseFromBridge(text: string) {
  try {
    return parseOr(FromBridgeSchema, JSON.parse(text));
  } catch {
    return null;
  }
}

/* ---------- files on disk ---------- */

const WorkspaceRecordSchema = obj({
  code: codeField,
  name: v.fallback(v.string(), ''),
  agents: listOf(v.string()),
  creator: lenient(v.nullable(v.string())),
  transport: TransportSchema,
});

/** config.json, possibly hand-edited or from an older bridge. Agents are checked by sanitize after this. */
export const ConfigFileSchema = v.fallback(
  obj({
    adminToken: lenient(v.pipe(v.string(), v.nonEmpty())),
    tokens: listOf(v.string()),
    startOnLogin: v.fallback(v.boolean(), false),
    // Absent means "the defaults"; [] is a deliberate "no web apps".
    allowedOrigins: lenient(v.array(v.string())),
    agents: listOf(record),
    workspaces: listOf(WorkspaceRecordSchema),
  }),
  { tokens: [], startOnLogin: false, agents: [], workspaces: [] },
);

/** identity.json: the owner's recovery phrase and profile. */
export const IdentityFileSchema = obj({ phrase: v.string(), name: v.string(), handle: v.string() });
export type StoredIdentity = v.InferOutput<typeof IdentityFileSchema>;

/** One line of a workspace's event log; the peer still verifies the signature before using it. */
export const parseStoredEvent = (line: string): Ev | null => {
  try {
    const e: unknown = JSON.parse(line);
    return isEventShape(e) ? e : null;
  } catch {
    return null; // a torn last line after a crash: skip it, keep the rest
  }
};

import * as v from 'valibot';
import { isWorkspaceKey } from './seal';

/**
 * Schemas for everything that arrives from someone else: signed events and their bodies, presence,
 * huddle state, handshakes, relay envelopes, file refs. Peers are untrusted, so input is
 * checked here once and the rest of the code works with typed values.
 *
 * The reducer is lenient per field ("a malformed field is ignored, and no single event can abort the
 * reduction"), so many fields here use `lenient` (wrong type → dropped) rather than failing the whole
 * value. Required fields with a wrong type still reject it.
 */

/** A plain object: not null, not an array. Wire messages and bodies must be one. */
export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const record = v.custom<Record<string, unknown>>(isRecord);
/** v.object accepts arrays that happen to carry the keys; wire objects must be plain objects. */
const obj = <E extends v.ObjectEntries>(entries: E) => v.pipe(record, v.object(entries));
/** A field whose wrong type is dropped (undefined) instead of rejecting the whole value. */
const lenient = <S extends v.GenericSchema>(s: S) => v.fallback(v.optional(s), undefined);
const finite = v.pipe(v.number(), v.finite());
const nonEmpty = v.pipe(v.string(), v.nonEmpty());
const HEX64 = /^[0-9a-f]{64}$/;

/** The values of `xs` that match `s`: a list with one bad entry keeps the rest. */
const keep = <S extends v.GenericSchema>(s: S) =>
  v.transform((xs: unknown[]): v.InferOutput<S>[] =>
    xs.flatMap((x) => {
      const r = v.safeParse(s, x);
      return r.success ? [r.output] : [];
    }),
  );
/** Like `keep`, and anything that isn't an array is an empty list. */
const listOf = <S extends v.GenericSchema>(s: S) =>
  v.pipe(
    v.unknown(),
    v.transform((x): unknown[] => (Array.isArray(x) ? x : [])),
    keep(s),
  );
/** An object's string entries, in a null-prototype record so no key ("__proto__" included) is special. */
const stringsOf = (o: Record<string, unknown>, ok: (k: string, val: string) => boolean): Record<string, string> => {
  const out: Record<string, string> = Object.create(null);
  for (const [k, val] of Object.entries(o)) if (typeof val === 'string' && ok(k, val)) out[k] = val;
  return out;
};

/* ---------- events ---------- */

export const EV_TYPES = [
  'ws.create',
  'profile',
  'ch.create',
  'ch.update',
  'msg',
  'edit',
  'del',
  'react',
  'pin',
  'role',
  'ban',
  'agent',
  'approve',
  'rekey',
  // Collaboration (see collab.ts). Peers that predate them reject the type, so they just never see these.
  'task',
  'task.set',
  'vote',
  'rsvp',
  'decide',
  'doc',
  'doc.set',
  'doc.op',
  'suggest',
  'suggest.res',
  'save',
  'read',
] as const;

/** The signed envelope. The body is checked per type (BODY_SCHEMAS); the signature by verifyEvent. */
export const EventSchema = obj({
  id: v.string(),
  ws: v.string(),
  t: v.picklist(EV_TYPES),
  a: v.string(),
  sig: v.string(),
  ts: v.pipe(v.number(), v.safeInteger()),
  ch: v.optional(v.string()),
  to: v.optional(v.string()),
  ag: v.optional(v.string()),
  b: v.optional(v.unknown()),
});

export const BlobRefSchema = obj({ key: v.string(), hash: v.string(), servers: v.array(v.string()) });
/** A BlobRef that can actually be fetched and opened: a 32-byte key and a sha256 content address. */
export const FetchableBlobRefSchema = obj({
  key: v.pipe(v.string(), v.check(isWorkspaceKey)),
  hash: v.pipe(v.string(), v.regex(HEX64)),
  servers: v.array(v.string()),
});
export const FileRefSchema = obj({ id: v.string(), name: v.string(), size: finite, type: v.string(), blob: v.optional(BlobRefSchema) });
export const TraceStepSchema = obj({
  title: v.string(),
  status: v.picklist(['done', 'error', 'running', 'waiting', 'skipped']),
  tool: v.optional(v.string()),
  ms: v.optional(finite),
  detail: v.optional(v.string()),
});
export const ApprovalReqSchema = obj({
  req: v.string(),
  title: v.string(),
  kind: v.optional(v.string()),
  options: v.pipe(v.array(v.unknown()), keep(obj({ id: v.string(), name: v.string(), kind: v.string() }))),
});

const int = v.pipe(v.number(), v.safeInteger());
const shortText = (max: number) => v.pipe(v.string(), v.nonEmpty(), v.maxLength(max));
/** A member (`pub`) or one of their agents (`pub/agentId`). */
export const ActorSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}(\/[^/\s]{1,64})?$/));
export const TASK_STATUSES = ['open', 'doing', 'blocked', 'done'] as const;
export const PollSpecSchema = obj({
  q: shortText(300),
  options: v.pipe(listOf(shortText(100)), v.minLength(2), v.maxLength(10)),
  multi: lenient(v.literal(true)),
  closes: lenient(int),
});
export const MeetSpecSchema = obj({ title: shortText(200), at: int, dur: lenient(v.pipe(int, v.minValue(1), v.maxValue(24 * 60))) });
/** Largest doc op accepted (base64url chars): a big paste, well under the 64 KiB relay padding steps. */
export const MAX_DOC_OP = 256 * 1024;

const flags = <K extends string>(...keys: K[]) => obj(Object.fromEntries(keys.map((k) => [k, v.boolean()])) as Record<K, v.BooleanSchema<undefined>>);

/** Each event type's body. Authority and context (who may write what, where) are the reducer's job. */
export const BODY_SCHEMAS = {
  'ws.create': obj({ name: lenient(v.string()) }),
  profile: obj({ name: nonEmpty, handle: v.optional(v.string()) }),
  'ch.create': obj({ id: nonEmpty, name: nonEmpty, topic: v.optional(v.string()) }),
  'ch.update': obj({ id: v.string(), name: lenient(v.string()), topic: lenient(v.string()) }),
  msg: obj({
    text: v.optional(v.string()),
    parent: v.optional(v.string()),
    meta: v.optional(v.string()),
    files: v.optional(listOf(FileRefSchema), []),
    trace: v.optional(listOf(TraceStepSchema)),
    approval: lenient(ApprovalReqSchema),
    alsoInChannel: lenient(v.literal(true)),
    poll: lenient(PollSpecSchema),
    meet: lenient(MeetSpecSchema),
  }),
  edit: obj({ target: v.string(), text: v.string() }),
  del: obj({ target: v.string() }),
  react: obj({ target: v.string(), icon: v.pipe(v.string(), v.nonEmpty(), v.maxLength(64)), on: v.boolean() }),
  pin: obj({ target: v.string(), on: v.boolean() }),
  role: obj({ target: nonEmpty, admin: v.boolean() }),
  ban: obj({ target: nonEmpty, on: v.boolean() }),
  agent: obj({
    id: nonEmpty,
    name: v.string(),
    handle: nonEmpty,
    runtime: v.string(),
    model: v.optional(v.string()),
    replyIn: v.picklist(['thread', 'channel']),
    removed: v.optional(v.boolean()),
    // Newer fields: older bridges don't send them, and wrong types are ignored, never coerced.
    respondTo: lenient(flags('mentions', 'replies')),
    postIn: lenient(flags('thread', 'channel')),
    discoverable: lenient(v.literal(true)),
  }),
  approve: obj({ req: nonEmpty, option: v.string() }),
  rekey: obj({
    epoch: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    keys: v.pipe(
      record,
      v.transform((o) => stringsOf(o, (pub) => HEX64.test(pub))),
    ),
    history: v.string(),
  }),
  task: obj({ id: nonEmpty, title: shortText(300), ch: nonEmpty, src: lenient(v.string()), assignee: lenient(ActorSchema), due: lenient(int) }),
  'task.set': obj({
    id: nonEmpty,
    title: lenient(shortText(300)),
    assignee: lenient(v.nullable(ActorSchema)),
    due: lenient(v.nullable(int)),
    status: lenient(v.picklist(TASK_STATUSES)),
    note: lenient(v.pipe(v.string(), v.maxLength(4000))),
  }),
  vote: obj({ target: nonEmpty, choices: listOf(v.pipe(int, v.minValue(0))) }),
  rsvp: obj({ target: nonEmpty, going: v.picklist(['yes', 'no', 'maybe']) }),
  decide: obj({ target: nonEmpty, text: v.pipe(v.string(), v.maxLength(2000)), on: v.boolean() }),
  doc: obj({ id: nonEmpty, title: shortText(200), ch: nonEmpty, kind: v.fallback(v.picklist(['text', 'board']), 'text') }),
  'doc.set': obj({ id: nonEmpty, title: lenient(shortText(200)), archived: lenient(v.boolean()) }),
  'doc.op': obj({ doc: nonEmpty, u: v.pipe(v.string(), v.nonEmpty(), v.maxLength(MAX_DOC_OP), v.regex(/^[A-Za-z0-9_-]+$/)) }),
  suggest: obj({
    doc: nonEmpty,
    find: v.pipe(v.string(), v.maxLength(20_000)),
    replace: v.pipe(v.string(), v.maxLength(20_000)),
    note: lenient(v.pipe(v.string(), v.maxLength(2000))),
  }),
  'suggest.res': obj({ target: nonEmpty, accept: v.boolean() }),
  save: obj({ target: nonEmpty, on: v.boolean() }),
  read: obj({ ch: nonEmpty, ts: int }),
} as const;

export type EventType = (typeof EV_TYPES)[number];
export type ParsedBody<T extends EventType> = v.InferOutput<(typeof BODY_SCHEMAS)[T]>;

/** An event body checked against its type's schema; null when it doesn't fit. Never throws. */
export function parseBody<T extends EventType>(t: T, b: unknown): ParsedBody<T> | null {
  const r = v.safeParse(BODY_SCHEMAS[t], b);
  return r.success ? (r.output as ParsedBody<T>) : null;
}

/* ---------- live (ephemeral) messages ---------- */

const nullableText = lenient(v.nullable(v.string()));
export const PresenceSchema = obj({
  pub: v.string(),
  st: v.fallback(v.picklist(['online', 'away']), 'online'),
  typing: nullableText, // channel id
  // agentId → channel it's working in, and what on (`task:<id>`, `doc:<id>`) when it's more than a reply
  agents: lenient(v.record(v.string(), obj({ working: nullableText, on: nullableText }))),
  /** What the member is looking at: a channel id, `thread:<msgId>`, `doc:<id>` or `task:<id>`. */
  view: nullableText,
  /** Focus mode: don't expect a quick answer. */
  focus: lenient(v.boolean()),
  /** In a text doc: the line the caret is on. */
  cur: lenient(obj({ doc: v.string(), line: v.pipe(int, v.minValue(0)) })),
  bridge: lenient(v.boolean()),
  /** This member is in a huddle and needs the WebRTC room, so opted-in members should join it. */
  rtc: lenient(v.boolean()),
});
export type Presence = v.InferOutput<typeof PresenceSchema>;

export const HuddleStateSchema = obj({
  ch: v.fallback(v.nullable(v.string()), null),
  mic: v.fallback(v.boolean(), false),
  cam: v.fallback(v.boolean(), false),
  screen: v.fallback(v.boolean(), false),
});
export type HuddleState = v.InferOutput<typeof HuddleStateSchema>;

/** A peer's WebRTC identity proof: its key and a signature over the handshake message. */
export const HandshakeSchema = obj({ pub: v.string(), sig: v.string() });

/** Nostr: a private event's outer layer names its pair, so the recipient knows which key opens `c`. */
export const PrivateWrapperSchema = obj({ a: v.string(), to: v.string(), c: v.string() });
/** Nostr presence: the presence JSON, when it was signed, and the signature. */
export const PresenceEnvelopeSchema = obj({ j: v.string(), t: finite, s: v.string() });
/** A rekey's history: every earlier key and its epoch (null = unknown). Bad entries are skipped. */
export const KeyHistorySchema = listOf(obj({ key: v.pipe(v.string(), v.check(isWorkspaceKey)), epoch: v.fallback(v.nullable(v.pipe(v.number(), v.safeInteger())), null) }));

/** `x` parsed by `schema`, or null. For callers that only need "valid or not". Never throws. */
export function parseOr<S extends v.GenericSchema>(schema: S, x: unknown): v.InferOutput<S> | null {
  const r = v.safeParse(schema, x);
  return r.success ? r.output : null;
}

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import * as v from 'valibot';
import { keyFromPhrase, makeEvent, newRecoveryPhrase, reduce, slug, TOOL_KINDS, type AgentConfig, type Msg } from '@yurt/protocol';
import {
  AgentDraftSchema,
  ConfigFileSchema,
  IdentityFileSchema,
  InitializeResultSchema,
  NewSessionResultSchema,
  PermissionRequestSchema,
  RpcErrorSchema,
  RpcMessageSchema,
  RUNTIME_ID_LIST,
  SessionUpdateSchema,
  ToBridgeSchema,
  TransportSchema,
  parseStoredEvent,
  parseFromBridge,
} from '../src/schemas';
import { mentionedAgents, placement, repliedAgents } from '../src/agents';
import { saveAttachment } from '../src/files';
import { compact } from '../src/compact';
import { autoHandle, canSave, isSaved } from '../ui/src/agentForm';
import { tempDir } from './helpers';

// Property tests over hostile and arbitrary input. The seed is fixed, so every run checks the same cases and a
// failure reproduces exactly; fast-check prints the shrunk counterexample.
fc.configureGlobal({ seed: 0x5eed_b41d, numRuns: 300 });

const home = tempDir('yurt-fuzz-');
let config: typeof import('../src/config');
beforeAll(async () => {
  process.env.YURT_HOME = home;
  config = await import('../src/config');
});

/** Anything JSON can carry, plus the keys that have bitten JS code before. */
const hostile = fc.oneof(
  fc.jsonValue(),
  fc.anything(),
  fc.dictionary(fc.constantFrom('__proto__', 'constructor', 'prototype', 'toString', 't', 'id', 'method', 'agent'), fc.jsonValue()),
);
/** A valid value with one field replaced by something arbitrary. */
const corrupt = (valid: Record<string, unknown>) => fc.tuple(fc.constantFrom(...Object.keys(valid)), hostile).map(([k, x]) => ({ ...valid, [k]: x }));

const SCHEMAS = {
  RpcMessageSchema,
  RpcErrorSchema,
  SessionUpdateSchema,
  PermissionRequestSchema,
  InitializeResultSchema,
  NewSessionResultSchema,
  AgentDraftSchema,
  TransportSchema,
  ToBridgeSchema,
  ConfigFileSchema,
  IdentityFileSchema,
};

describe('parsers', () => {
  it('never throw, whatever arrives', () => {
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      fc.assert(
        fc.property(hostile, (x) => {
          expect(() => v.safeParse(schema, x), name).not.toThrow();
        }),
      );
    }
    fc.assert(
      fc.property(fc.string(), (line) => {
        expect(() => parseStoredEvent(line)).not.toThrow();
        expect(() => parseFromBridge(line)).not.toThrow();
      }),
    );
    fc.assert(
      fc.property(hostile, (x) => {
        expect(parseFromBridge(JSON.stringify(x) ?? 'undefined')?.t ?? 'none').not.toBe('');
      }),
    );
  });

  it('only let well-formed browser messages through, even one field away from valid', () => {
    const valid = [
      { t: 'hello', token: 'x' },
      { t: 'pair', code: '123456' },
      { t: 'identity', phrase: 'p', name: 'n', handle: 'h' },
      { t: 'ws.join', code: 'AAAABBBB', name: 'W', agents: ['a'], creator: null },
      { t: 'ws.agents', code: 'AAAABBBB', agents: [] },
      { t: 'runtime.install', id: 'copilot' },
      { t: 'startOnLogin', on: true },
      { t: 'origins', list: ['https://x'] },
    ];
    for (const m of valid) {
      expect(v.is(ToBridgeSchema, m)).toBe(true);
      fc.assert(
        fc.property(corrupt(m), (x) => {
          const r = v.safeParse(ToBridgeSchema, x);
          if (!r.success) return;
          const out = r.output;
          // Whatever passes is fully typed: known kind, and every field the dispatcher reads has its type.
          expect(['hello', 'pair', 'identity', 'ws.join', 'ws.agents', 'runtime.install', 'startOnLogin', 'origins']).toContain(out.t);
          if (out.t === 'ws.join' || out.t === 'ws.agents') expect(out.agents.every((a) => typeof a === 'string')).toBe(true);
          if (out.t === 'runtime.install') expect(RUNTIME_ID_LIST).toContain(out.id);
          if (out.t === 'origins') expect(out.list.every((o) => typeof o === 'string')).toBe(true);
        }),
      );
    }
  });

  it('read permission requests into usable options, never inventing an id', () => {
    const option = fc.record({ optionId: fc.oneof(fc.string(), hostile), name: fc.oneof(fc.string(), hostile), kind: fc.oneof(fc.string(), hostile) }, { requiredKeys: [] });
    fc.assert(
      fc.property(fc.record({ toolCall: fc.oneof(hostile, fc.record({ kind: hostile, title: hostile })), options: fc.oneof(hostile, fc.array(option)) }), (p) => {
        const r = v.parse(PermissionRequestSchema, p);
        expect(TOOL_KINDS).toContain(r.kind);
        expect(r.title.length).toBeGreaterThan(0);
        for (const o of r.options) expect([typeof o.optionId, typeof o.name, typeof o.kind]).toEqual(['string', 'string', 'string']);
        const raw = Array.isArray(p.options) ? p.options : [];
        expect(r.options.length).toBe(raw.filter((o: unknown) => typeof o === 'object' && o !== null && typeof (o as { optionId?: unknown }).optionId === 'string').length);
      }),
    );
  });

  it('count tool kinds outside the known list as other, so auto-approving other covers them', () => {
    const kind = (k: unknown) => v.parse(PermissionRequestSchema, { toolCall: { kind: k, title: 't' }, options: [] }).kind;
    expect([kind('switch_mode'), kind('execute')]).toEqual(['other', 'execute']);
  });

  it('keep stored workspace logs to well-formed events', () => {
    const kp = keyFromPhrase(newRecoveryPhrase());
    const good = makeEvent(kp, { ws: 'AAAABBBB', t: 'msg', ch: 'general', b: { text: 'hi' }, ts: 1 });
    fc.assert(
      fc.property(corrupt(good as unknown as Record<string, unknown>), (x) => {
        const e = parseStoredEvent(JSON.stringify(x));
        if (e) expect([typeof e.id, typeof e.ws, typeof e.a, typeof e.sig, Number.isSafeInteger(e.ts)]).toEqual(['string', 'string', 'string', 'string', true]);
      }),
    );
  });
});

/** An AgentConfig the bridge can run, as every check in sanitize promises. */
function expectRunnable(a: AgentConfig) {
  expect(a.name.length).toBeGreaterThan(0);
  expect(a.name.length).toBeLessThanOrEqual(40);
  expect(a.handle).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  expect(a.handle.length).toBeLessThanOrEqual(24);
  expect(a.id.length).toBeGreaterThan(0);
  expect(RUNTIME_ID_LIST).toContain(a.runtime);
  expect(path.isAbsolute(a.workdir)).toBe(true);
  expect(Number.isInteger(a.contextSize) && a.contextSize >= 1 && a.contextSize <= 200).toBe(true);
  expect(a.autoApprove.every((k) => TOOL_KINDS.includes(k))).toBe(true);
  expect(a.instructions.length).toBeLessThanOrEqual(8000);
  expect(a.postIn.thread || a.postIn.channel).toBe(true);
  expect([typeof a.respondTo.mentions, typeof a.respondTo.replies, typeof a.discoverable, typeof a.online]).toEqual(['boolean', 'boolean', 'boolean', 'boolean']);
  expect(a.model === undefined || a.model.length > 0).toBe(true);
}

const draft = fc.record(
  {
    id: fc.oneof(fc.string(), hostile),
    name: fc.oneof(fc.string(), fc.constant('Scout'), hostile),
    handle: fc.oneof(fc.string(), hostile),
    runtime: fc.oneof(fc.constantFrom(...RUNTIME_ID_LIST), hostile),
    model: fc.oneof(fc.string(), hostile),
    workdir: fc.oneof(fc.constant('/tmp/agent'), fc.string(), hostile),
    instructions: fc.oneof(fc.string({ maxLength: 9000 }), hostile),
    autoApprove: fc.oneof(fc.array(fc.oneof(fc.constantFrom(...TOOL_KINDS), fc.string())), hostile),
    contextSize: hostile,
    replyIn: fc.oneof(fc.constantFrom('thread', 'channel'), hostile),
    respondTo: fc.oneof(fc.record({ mentions: fc.boolean(), replies: fc.boolean() }), hostile),
    postIn: fc.oneof(fc.record({ thread: fc.boolean(), channel: fc.boolean() }), hostile),
    discoverable: fc.oneof(fc.boolean(), hostile),
    online: fc.oneof(fc.boolean(), hostile),
  },
  { requiredKeys: [] },
);

describe('agents from the UI or config.json', () => {
  it('sanitize returns a runnable agent or explains what is wrong', () => {
    const reasons =
      /^(Invalid agent|Unknown runtime|Give the agent a name|Give the agent a handle|Pick a folder with a full path|Pick where the agent posts: in a thread, in the channel, or both)$/;
    fc.assert(
      fc.property(draft, (d) => {
        let a: AgentConfig;
        try {
          a = config.sanitize(d);
        } catch (e) {
          expect((e as Error).message).toMatch(reasons);
          return;
        }
        expectRunnable(a);
        expect(a.handle).toBe(slug(typeof d.handle === 'string' && d.handle ? d.handle : a.name).slice(0, 24));
      }),
    );
  });

  it('loadConfig turns any file into a config the bridge can use', () => {
    fc.assert(
      fc.property(fc.oneof(hostile, fc.record({ agents: fc.array(draft), workspaces: fc.array(hostile), tokens: hostile, allowedOrigins: hostile })), (file) => {
        fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(file) ?? 'null');
        const c = config.loadConfig();
        for (const a of c.agents) expectRunnable(a);
        for (const w of c.workspaces) {
          expect(w.code.length).toBeGreaterThan(0);
          expect(['trystero', 'nostr']).toContain(w.transport.kind);
        }
        expect(c.tokens.every((t) => typeof t === 'string')).toBe(true);
        expect(c.adminToken.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('the bridge page editor and the bridge agree', () => {
  // The editor waits for a state holding the agent as saved (isSaved); if it disagreed with sanitize, it would spin
  // on "saving" forever. Any agent the editor lets through, the bridge accepts (on this OS's paths), and recognizes.
  const form = fc.record({
    id: fc.oneof(fc.constant(''), fc.string({ minLength: 1 })),
    name: fc.string(),
    handle: fc.oneof(
      fc.string(),
      fc.string().map((x) => x.toLowerCase()),
    ),
    runtime: fc.constantFrom(...RUNTIME_ID_LIST),
    model: fc.option(fc.string(), { nil: undefined }),
    workdir: fc.oneof(
      fc.constant('/tmp/agents/x'),
      fc.string().map((x) => '/' + x),
      fc.string(),
      fc.string().map((x) => 'C:\\' + x),
    ),
    instructions: fc.string({ maxLength: 9000 }),
    autoApprove: fc.subarray([...TOOL_KINDS]),
    contextSize: fc.integer({ min: -5, max: 500 }),
    respondTo: fc.record({ mentions: fc.boolean(), replies: fc.boolean() }),
    postIn: fc.record({ thread: fc.boolean(), channel: fc.boolean() }),
    discoverable: fc.boolean(),
    online: fc.boolean(),
  });

  it('every agent the editor submits is accepted and recognized as saved', () => {
    fc.assert(
      fc.property(form, (raw) => {
        const a: AgentConfig = compact(raw);
        if (!canSave(a)) return;
        // The page can't know the bridge's OS: a Windows path on macOS/Linux is refused with a clear message.
        if (!path.isAbsolute(a.workdir)) {
          expect(() => config.sanitize(a)).toThrow('Pick a folder with a full path');
          return;
        }
        expect(isSaved(a, config.sanitize(a), ['some-other-id'])).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('the handle the editor builds while typing is one the bridge keeps as is', () => {
    fc.assert(
      fc.property(fc.string(), (typed) => {
        const h = autoHandle(typed);
        if (h) expect(slug(h).slice(0, 24)).toBe(h);
      }),
    );
  });
});

describe('who answers, and where', () => {
  const kinds = fc.constantFrom('mention', 'reply', 'dm', 'guest') as fc.Arbitrary<'mention' | 'reply' | 'dm' | 'guest'>;
  const id = fc.string({ minLength: 1, maxLength: 8 });

  it('placement: DMs stay flat, a thread reply stays in its thread, "also in channel" only on thread replies', () => {
    fc.assert(
      fc.property(fc.record({ thread: fc.boolean(), channel: fc.boolean() }), id, fc.option(id, { nil: undefined }), kinds, (postIn, mid, parent, kind) => {
        const p = placement({ postIn }, compact({ id: mid, parent }), kind);
        if (kind === 'dm' || kind === 'guest') {
          expect(p).toEqual({});
          return;
        }
        if (p.alsoInChannel) expect(p.parent).toBeDefined();
        if (parent)
          expect(p.parent).toBe(parent); // never leaves the thread it was asked in
        else if (postIn.thread) expect(p.parent).toBe(mid);
        else expect(p.parent).toBeUndefined();
      }),
    );
  });

  const agent = (i: number, replies: boolean): AgentConfig => ({
    id: 'a' + i,
    name: 'A' + i,
    handle: 'agent' + i,
    runtime: 'copilot',
    workdir: '/w',
    instructions: '',
    autoApprove: [],
    contextSize: 20,
    respondTo: { mentions: true, replies },
    postIn: { thread: true, channel: false },
    discoverable: false,
    online: true,
  });
  const team = fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }).map((rs) => rs.map((r, i) => agent(i, r)));

  it('mentionedAgents: only mentioned agents of this workspace, never the author', () => {
    fc.assert(
      fc.property(team, fc.subarray([0, 1, 2, 3, 4]), fc.subarray([0, 1, 2, 3, 4]), fc.option(fc.nat(4), { nil: undefined }), fc.string(), (agents, inWs, said, from, noise) => {
        const ws = inWs.map((i) => 'a' + i);
        const text = noise + ' ' + said.map((i) => '@agent' + i).join(' ');
        const out = mentionedAgents(agents, ws, text, from === undefined ? undefined : 'a' + from);
        for (const x of out) {
          expect(ws).toContain(x);
          expect(x).not.toBe(from === undefined ? undefined : 'a' + from);
          expect(agents.some((a) => a.id === x)).toBe(true);
        }
        for (const i of said) if (ws.includes('a' + i) && i !== from && agents.some((a) => a.id === 'a' + i)) expect(out).toContain('a' + i);
      }),
    );
  });

  it("repliedAgents: only agents with replies on that took part in the message's thread, never the author", () => {
    const owner = keyFromPhrase(newRecoveryPhrase());
    const member = keyFromPhrase(newRecoveryPhrase());
    fc.assert(
      fc.property(team, fc.subarray([0, 1, 2, 3, 4]), fc.subarray([0, 1, 2, 3, 4]), fc.option(fc.nat(4), { nil: undefined }), (agents, inWs, answered, from) => {
        let ts = 1;
        const ev = (kp: typeof owner, t: Parameters<typeof makeEvent>[1]['t'], b: unknown, extra: { ch?: string; ag?: string } = {}) =>
          makeEvent(kp, { ws: 'AAAABBBB', t, b, ts: ts++, ...extra });
        const setup = [ev(owner, 'ws.create', { name: 'W' }), ev(owner, 'ch.create', { id: 'general', name: 'general' })]; // first: events apply in time order
        const root = ev(member, 'msg', { text: 'q' }, { ch: 'general' });
        const replies = answered.map((i) => ev(owner, 'msg', { text: 'a', parent: root.id }, { ch: 'general', ag: 'a' + i }));
        const follow = ev(member, 'msg', { text: 'more', parent: root.id }, { ch: 'general' });
        const s = reduce('AAAABBBB', [...setup, root, ...replies, follow], { creator: owner.pub });
        const m = s.msgs.get(follow.id) as Msg;
        const author = from === undefined ? undefined : 'a' + from;
        const out = repliedAgents(
          agents,
          inWs.map((i) => 'a' + i),
          s,
          m,
          owner.pub,
          author,
        );
        for (const x of out) {
          expect(x).not.toBe(author);
          expect(inWs.map((i) => 'a' + i)).toContain(x);
          expect(agents.find((a) => a.id === x)?.respondTo.replies).toBe(true);
          expect(answered.map((i) => 'a' + i)).toContain(x);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('attachments', () => {
  it('never land outside the agent folder, whatever the names', () => {
    const dir = tempDir('yurt-fuzz-files-');
    const root = path.resolve(dir, '.yurt', 'files');
    fc.assert(
      fc.property(fc.string(), fc.string(), (msgId, name) => {
        const rel = saveAttachment(dir, msgId, name, new ArrayBuffer(0));
        const abs = path.resolve(dir, rel);
        expect(abs.startsWith(root + path.sep)).toBe(true);
        expect(path.dirname(path.dirname(abs))).toBe(root);
      }),
      { numRuns: 200 },
    );
  });
});

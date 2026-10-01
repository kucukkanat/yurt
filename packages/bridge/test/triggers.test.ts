import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  WorkspacePeer, keyFromPhrase, newRecoveryPhrase, newNostrTransport, guestDmChannel, reduce, makeEvent, agentPrefs,
  type AgentConfig, type Ev, type KeyPair, type KeyedTransport, type Msg, type PeerStore,
} from '@yurt/protocol';
import { startRelay, type TestRelay } from '../../protocol/test/relay';
import type { Config } from '../src/config';
import type { Workspaces } from '../src/workspaces';
import { placement, repliedAgents } from '../src/agents';
import { fakeCopilotOnPath, tempDir, until } from './helpers';

const CODE = 'TRIG2RSX';
const agentCfg = (p: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 'scout-1', name: 'Scout', handle: 'scout', runtime: 'copilot', workdir: '/w', instructions: '', autoApprove: [], contextSize: 20,
  respondTo: { mentions: true, replies: false }, postIn: { thread: true, channel: false }, discoverable: false, ...p,
});

describe('placement', () => {
  const top = { id: 'm1' };
  const inThread = { id: 'm2', parent: 'm1' };
  const at = (thread: boolean, channel: boolean) => agentCfg({ postIn: { thread, channel } });

  it('answers in a thread, at the top, or both', () => {
    expect(placement(at(true, false), top, 'mention')).toEqual({ parent: 'm1' });
    expect(placement(at(false, true), top, 'mention')).toEqual({ parent: undefined });
    expect(placement(at(true, true), top, 'mention')).toEqual({ parent: 'm1', alsoInChannel: true });
  });

  it('stays in the thread a trigger is already in, and keeps DMs flat', () => {
    expect(placement(at(false, true), inThread, 'reply')).toEqual({ parent: 'm1' });
    expect(placement(at(true, true), inThread, 'reply')).toEqual({ parent: 'm1', alsoInChannel: true });
    expect(placement(at(true, true), top, 'dm')).toEqual({});
    expect(placement(at(true, true), top, 'guest')).toEqual({});
  });
});

describe('repliedAgents', () => {
  const OWNER = keyFromPhrase(newRecoveryPhrase());
  const MEMBER = keyFromPhrase(newRecoveryPhrase());
  let ts = 1_700_000_000_000;
  const ev = (kp: KeyPair, b: unknown, extra: { ch?: string; ag?: string } = {}) => makeEvent(kp, { ws: CODE, t: 'msg', b, ts: (ts += 1000), ch: 'general', ...extra });
  const setup = [makeEvent(OWNER, { ws: CODE, t: 'ws.create', b: { name: 'W' }, ts: (ts += 1000) }), makeEvent(OWNER, { ws: CODE, t: 'ch.create', b: { id: 'general', name: 'general' }, ts: (ts += 1000) })];
  const root = ev(MEMBER, { text: 'question for @scout' });
  const answer = ev(OWNER, { text: 'answer', parent: root.id }, { ag: 'scout-1' });
  const follow = ev(MEMBER, { text: 'and then?', parent: root.id });
  const elsewhere = ev(MEMBER, { text: 'unrelated thread', parent: ev(MEMBER, { text: 'x' }).id });
  const s = reduce(CODE, [...setup, root, answer, follow], { creator: OWNER.pub });
  const msg = (e: Ev) => s.msgs.get(e.id) as Msg;
  const on = [agentCfg({ respondTo: { mentions: true, replies: true } })];

  it('finds agents taking part in the thread when replies are on', () => {
    expect(repliedAgents(on, ['scout-1'], s, msg(follow), OWNER.pub)).toEqual(['scout-1']);
  });

  it('ignores replies turned off, other threads, top-level messages, other workspaces and the agent itself', () => {
    expect(repliedAgents([agentCfg()], ['scout-1'], s, msg(follow), OWNER.pub)).toEqual([]);
    expect(repliedAgents(on, ['scout-1'], s, { ...msg(follow), parent: elsewhere.id }, OWNER.pub)).toEqual([]);
    expect(repliedAgents(on, ['scout-1'], s, msg(root), OWNER.pub)).toEqual([]);
    expect(repliedAgents(on, [], s, msg(follow), OWNER.pub)).toEqual([]);
    expect(repliedAgents(on, ['scout-1'], s, msg(answer), OWNER.pub, 'scout-1')).toEqual([]);
    expect(repliedAgents(on, ['scout-1'], s, msg(follow), MEMBER.pub)).toEqual([]); // someone else's agent of the same id
  });
});

/** In-memory PeerStore: a real implementation of the interface, one per simulated member device. */
const memStore = (): PeerStore => {
  const evs = new Map<string, Ev>();
  const blobs = new Map<string, ArrayBuffer>();
  let mark = 0;
  return {
    getBlob: async (id) => blobs.get(id) ?? null, putBlob: async (id, b) => { blobs.set(id, b); },
    load: async () => [...evs.values()], save: async (xs) => { xs.forEach((e) => evs.set(e.id, e)); },
    loadMark: async () => mark, saveMark: async (_ws, m) => { mark = m; },
  };
};

// End to end: the real bridge Workspaces + AgentHost running an echoing fake ACP agent, and members on real
// WorkspacePeers, all over a local Nostr relay. The echo carries the agent's pid (which session ran) and its
// "Reply to the last message…" line (which trigger it saw).
describe('agent triggers, end to end', () => {
  const home = tempDir('yurt-trig-');
  const workdir = tempDir('yurt-trig-agent-');
  fs.writeFileSync(path.join(workdir, '.fake-mode'), 'echo');
  const B = keyFromPhrase(newRecoveryPhrase());
  const C = keyFromPhrase(newRecoveryPhrase());
  let relay: TestRelay;
  let transport: KeyedTransport;
  let cfg: Config;
  let ws: Workspaces;
  let b: WorkspacePeer;
  let c: WorkspacePeer;
  let restorePath: () => void;
  let owner = '';

  const member = async (kp: KeyPair) => {
    const p = new WorkspacePeer({ code: CODE, kp, selfId: kp.pub.slice(0, 20), transport, store: memStore(), onError: (m) => { throw new Error(m); } });
    await p.start();
    await until(() => p.connected, 8000);
    return p;
  };
  const set = (p: Partial<AgentConfig>) => { cfg.agents[0] = { ...cfg.agents[0], ...p }; };
  const answers = (p: WorkspacePeer, ch: string) => [...p.state.msgs.values()].filter((m) => m.ag === 'scout-1' && m.ch === ch);
  /** Sends `text` and waits for the agent's answer to it (answers are queued, so earlier triggers answer first). */
  const ask = async (p: WorkspacePeer, ch: string, text: string, extra: { parent?: string; to?: string } = {}) => {
    const before = answers(p, ch).length;
    const e = p.publish({ t: 'msg', ch, to: extra.to, b: { text, parent: extra.parent } });
    await until(() => answers(p, ch).length > before, 15_000);
    return { trigger: e, answers: answers(p, ch).slice(before) };
  };
  const pidOf = (m: Msg) => /pid=(\d+)/.exec(m.text)?.[1];

  beforeAll(async () => {
    restorePath = fakeCopilotOnPath();
    relay = await startRelay();
    transport = newNostrTransport([relay.url]);
    process.env.YURT_HOME = home;
    const [{ loadConfig }, { Workspaces }, { AgentHost }] = await Promise.all([import('../src/config'), import('../src/workspaces'), import('../src/agents')]);
    cfg = loadConfig();
    cfg.agents.push(agentCfg({ workdir }));
    b = await member(B);
    b.publish({ t: 'ws.create', b: { name: 'Triggers' } });
    b.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    b.publish({ t: 'profile', b: { name: 'Bea', handle: 'bea' } });
    c = await member(C);
    c.publish({ t: 'profile', b: { name: 'Cy', handle: 'cy' } });
    ws = new Workspaces(cfg, () => {});
    ws.host = new AgentHost(cfg, () => ws.me, () => {}, () => {});
    ws.setIdentity(newRecoveryPhrase());
    owner = ws.me ?? '';
    ws.join(CODE, 'Triggers', B.pub, ['scout-1'], transport);
    await until(() => !!b.state.agents.size && !!c.state.agents.size, 10_000);
  }, 30_000);

  afterAll(async () => {
    ws.host.drop('scout-1');
    for (const p of [...ws.peers.values(), b, c]) p.leave();
    await relay.close();
    restorePath();
    for (const d of [home, workdir]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('announces its settings, and answers a mention in a thread by default', async () => {
    const announced = [...b.state.agents.values()][0];
    expect([announced.replyIn, agentPrefs(announced)]).toEqual(['thread', { respondTo: { mentions: true, replies: false }, postIn: { thread: true, channel: false }, discoverable: false }]);
    const { trigger, answers: [a] } = await ask(b, 'general', 'hey @scout');
    expect(a.parent).toBe(trigger.id);
    expect(a.alsoInChannel).toBeUndefined();
    expect(a.text).toContain('which mentions you');
  }, 20_000);

  it('posts at the top for "channel", and in both places for "thread + channel"', async () => {
    set({ postIn: { thread: false, channel: true } });
    expect((await ask(b, 'general', '@scout top please')).answers[0].parent).toBeUndefined();
    set({ postIn: { thread: true, channel: true } });
    const { trigger, answers: [a] } = await ask(b, 'general', '@scout both please');
    expect([a.parent, a.alsoInChannel]).toEqual([trigger.id, true]);
    expect(b.state.channelMsgs.get('general')).toContain(a.id);
    set({ postIn: { thread: true, channel: false } });
  }, 40_000);

  it('ignores mentions when turned off, and answers follow-ups in its threads when replies are on', async () => {
    set({ respondTo: { mentions: true, replies: false } });
    const { trigger: root } = await ask(b, 'general', '@scout start a thread');
    set({ respondTo: { mentions: false, replies: true } });
    const ignored = b.publish({ t: 'msg', ch: 'general', b: { text: '@scout are you there?' } });
    const { answers: got } = await ask(b, 'general', 'a follow-up without any mention', { parent: root.id });
    // Queued in order, so had the mention been answered, that answer would have come first.
    expect(got.map((m) => m.parent)).toEqual([root.id]);
    expect(got[0].text).toContain('a follow-up in a thread you take part in');
    expect(answers(b, 'general').some((m) => m.parent === ignored.id)).toBe(false);
    set({ respondTo: { mentions: true, replies: false } });
  }, 40_000);

  it('answers DMs from other members only while discoverable, each member in their own session', async () => {
    const chB = guestDmChannel(B.pub, owner, 'scout-1');
    const chC = guestDmChannel(C.pub, owner, 'scout-1');
    const unanswered = b.publish({ t: 'msg', ch: chB, to: owner, b: { text: 'hello?' } });
    // In the bridge's state means its AgentHost already saw (and skipped) it: state and onEvents update together,
    // a moment after the raw event arrives.
    await until(() => !!ws.peers.get(CODE)?.state.msgs.has(unanswered.id));
    set({ discoverable: true });
    const { answers: [toB] } = await ask(b, chB, 'now?', { to: owner });
    expect(answers(b, chB)).toHaveLength(1); // the message sent while not discoverable stays unanswered
    expect(b.state.msgs.get(unanswered.id)).toBeDefined();
    expect([toB.to, toB.parent]).toEqual([B.pub, undefined]);
    expect(toB.text).toContain('from Bea');
    const { answers: [toC] } = await ask(c, chC, 'me too', { to: owner });
    const { answers: [toB2] } = await ask(b, chB, 'again', { to: owner });
    const { answers: [inRoom] } = await ask(b, 'general', '@scout and in the room?');
    expect(pidOf(toB2)).toBe(pidOf(toB)); // B keeps their session
    expect(new Set([pidOf(toB), pidOf(toC), pidOf(inRoom)]).size).toBe(3);
    expect(answers(c, chB)).toEqual([]); // C never sees B's conversation
  }, 60_000);
});

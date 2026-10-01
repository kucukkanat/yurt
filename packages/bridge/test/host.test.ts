import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  type WorkspacePeer,
  agentDmChannel,
  dmChannel,
  guestDmChannel,
  keyFromPhrase,
  makeEvent,
  newNostrTransport,
  newRecoveryPhrase,
  sha256Buf,
  uploadFile,
  type AgentConfig,
  type KeyPair,
  type KeyedTransport,
  type Msg,
} from '@yurt/protocol';
import { startRelay, type TestRelay } from '../../protocol/test/relay';
import { startBlossom, type TestBlossom } from '../../protocol/test/blossom-server';
import type { Config } from '../src/config';
import type { Workspaces } from '../src/workspaces';
import { AgentHost } from '../src/agents';
import { onLog } from '../src/log';
import { FAKE_AGENT, answersOf, askAgent, fakeBins, memberPeer, must, startBridge, tempDir, until } from './helpers';

// The agent host end to end: the real bridge (Workspaces + AgentHost) runs real fake-ACP agent processes, members and
// the owner's own browser are real WorkspacePeers, all over a local Nostr relay and Blossom server. No mocks.
const CODE = 'HOSTTEST';
const OWNER_PHRASE = newRecoveryPhrase();
const OWNER = keyFromPhrase(OWNER_PHRASE);
const B = keyFromPhrase(newRecoveryPhrase()); // a member with a profile
const C = keyFromPhrase(newRecoveryPhrase()); // a member who never published one
const X = keyFromPhrase(newRecoveryPhrase()); // someone else's identity, for events the bridge must ignore
const home = tempDir('yurt-host-');
const agentsDir = tempDir('yurt-host-agents-');

const agentCfg = (id: string, mode: string, p: Partial<AgentConfig> = {}): AgentConfig => {
  const workdir = path.join(agentsDir, id);
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, '.fake-mode'), mode);
  return {
    id,
    name: id[0]?.toUpperCase() + id.slice(1),
    handle: id,
    runtime: 'copilot',
    workdir,
    instructions: '',
    autoApprove: ['edit'],
    contextSize: 20,
    respondTo: { mentions: true, replies: false },
    postIn: { thread: false, channel: true },
    discoverable: false,
    ...p,
  };
};
const AGENTS = [
  agentCfg('echo', 'echo', { discoverable: true }),
  agentCfg('teller', 'prompt', { instructions: 'Be brief.', contextSize: 3, discoverable: true, postIn: { thread: true, channel: false } }),
  agentCfg('gate', 'ok', { autoApprove: [] }),
  agentCfg('tools', 'tools'),
  agentCfg('one', 'one-tool'),
  agentCfg('locked', 'auth-fail'),
  agentCfg('broken', 'fail'),
  agentCfg('empty', 'no-session'),
  agentCfg('picky', 'echo', { model: 'bad-model' }),
  agentCfg('modelled', 'echo', { model: 'gpt-x' }),
  agentCfg('away', 'echo', { discoverable: true }), // in the bridge, not in this workspace
];

let relay: TestRelay;
let blossom: TestBlossom;
let transport: KeyedTransport;
let cfg: Config;
let ws: Workspaces;
let owner: WorkspacePeer; // the owner's browser: same key as the bridge
let b: WorkspacePeer;
let c: WorkspacePeer;
let bins: ReturnType<typeof fakeBins>;
const peers: WorkspacePeer[] = [];

async function member(kp: KeyPair) {
  const p = await memberPeer(kp, CODE, transport, { devFileServers: true });
  peers.push(p);
  return p;
}
const bridgePeer = () => must(ws.peers.get(CODE), 'bridge peer');
const answers = answersOf;
const ask = askAgent;
const logged = () => {
  const lines: string[] = [];
  const off = onLog((e) => lines.push(`${e.level} ${e.src}: ${e.msg}`));
  return { lines, off };
};

beforeAll(async () => {
  bins = fakeBins({ copilot: FAKE_AGENT }, 'all');
  relay = await startRelay();
  blossom = await startBlossom();
  transport = newNostrTransport([relay.url]);
  b = await member(B);
  b.publish({ t: 'ws.create', b: { name: 'Host' } });
  b.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
  b.publish({ t: 'ch.create', b: { id: 'chain', name: 'chain' } });
  b.publish({ t: 'profile', b: { name: 'Bea', handle: 'bea' } });
  c = await member(C);
  owner = await member(OWNER);
  ({ cfg, ws } = await startBridge(home, { phrase: OWNER_PHRASE, devFileServers: true, prepare: (cf) => cf.agents.push(...AGENTS) }));
  ws.join(
    CODE,
    'Host',
    B.pub,
    AGENTS.filter((a) => a.id !== 'away').map((a) => a.id),
    transport,
  );
  await until(() => b.state.agents.size === AGENTS.length - 1, 15_000);
}, 60_000);

afterAll(async () => {
  for (const a of AGENTS) ws.host.drop(a.id);
  for (const p of [...ws.peers.values(), ...peers]) p.leave();
  await relay.close();
  await blossom.close();
  bins.restore();
});

describe("the owner's private chat", () => {
  it('answers its owner flat and privately, and nobody for an unknown agent', async () => {
    const ch = agentDmChannel(OWNER.pub, 'echo');
    owner.publish({ t: 'msg', ch: agentDmChannel(OWNER.pub, 'nobody'), to: OWNER.pub, b: { text: 'hello?' } });
    const { answer } = await ask(owner, 'echo', ch, 'hi there', { to: OWNER.pub });
    expect([answer.to, answer.parent]).toEqual([OWNER.pub, undefined]);
    expect(answer.text).toContain('Reply to the last message from your owner');
    expect(answers(b, 'echo', ch)).toEqual([]); // members never see it
  }, 30_000);
});

describe('what the agent is told', () => {
  it('names people, agents, attachments and the place; skips deleted messages; keeps only the recent ones', async () => {
    const root = b.publish({ t: 'msg', ch: 'general', b: { text: 'thread root' } });
    const gone = b.publish({ t: 'msg', ch: 'general', b: { text: 'regret this', parent: root.id } });
    b.publish({ t: 'del', ch: 'general', b: { target: gone.id } });
    owner.publish({ t: 'msg', ch: 'general', ag: 'ghost', b: { text: 'from an agent nobody announced', parent: root.id } });
    c.publish({ t: 'msg', ch: 'general', b: { text: 'from someone without a profile', parent: root.id } });
    const { answer } = await ask(b, 'teller', 'general', 'and @teller?', { parent: root.id });
    const t = answer.text;
    expect(t).toContain('You are Teller (@teller), an AI agent in the Yurt workspace "Host", speaking in a thread in #general. your owner owns you');
    expect(t).toContain('Your instructions from your owner:\nBe brief.');
    expect(t).not.toContain('thread root'); // contextSize 3: only the last three
    expect(t).not.toContain('regret this');
    expect(t).toContain('ghost (agent): from an agent nobody announced');
    expect(t).toContain('Someone (@?): from someone without a profile');
    expect(t).toContain('Bea (@bea): and @teller?');
    expect(t).toContain('Reply to the last message, which mentions you.');
    expect(answer.parent).toBe(root.id);
  }, 30_000);

  it('saves the triggering attachments into its folder, and says which it could not get', async () => {
    const text = new TextEncoder().encode('quarterly numbers');
    const id = await sha256Buf(text.buffer as ArrayBuffer);
    const blob = await uploadFile([blossom.url], text);
    owner.publish({ t: 'profile', b: { name: 'Olu', handle: 'olu' } });
    const earlier = b.publish({ t: 'msg', ch: 'general', b: { text: 'old file', files: [{ id: '0'.repeat(64), name: 'old.txt', size: 1, type: 'text/plain' }] } });
    expect(earlier.id).toBeTruthy();
    const files = [
      { id, name: 'q3.txt', size: text.length, type: 'text/plain', blob },
      { id: 'f'.repeat(64), name: 'missing.txt', size: 3, type: 'text/plain' },
    ];
    const { trigger, answer } = await ask(b, 'teller', 'general', '@teller read these', { files });
    const saved = path.join('.yurt', 'files', trigger.id, '1-q3.txt');
    expect(fs.readFileSync(path.join(agentsDir, 'teller', saved), 'utf8')).toBe('quarterly numbers');
    expect(answer.text).toContain(`[attached: q3.txt → ${saved}, missing.txt (couldn't download)]`);
    expect(answer.text).toContain('Olu owns you');
    // The same file again comes from the bridge's own blob store.
    const again = await ask(b, 'teller', 'general', '@teller once more', { files: [{ id, name: 'q3.txt', size: text.length, type: 'text/plain', blob }] });
    expect(again.answer.text).toContain(`q3.txt → ${path.join('.yurt', 'files', again.trigger.id, 'q3.txt')}`);
  }, 40_000);

  it('tells it who it talks to in a guest DM, even someone without a profile', async () => {
    const ch = guestDmChannel(C.pub, OWNER.pub, 'teller');
    const { answer } = await ask(c, 'teller', ch, 'hello teller', { to: OWNER.pub });
    expect(answer.text).toContain('a private chat with a member (@?), a member of the workspace. Olu can read this chat too');
    expect(answer.text).toContain('Reply to the last message from them.');
    expect(answer.to).toBe(C.pub);
  }, 30_000);
});

describe('approvals', () => {
  /** Waits for the approval request the bridge sends to the owner's private chat with `agent`. */
  const approvalFor = async (agent: string, n: number) => {
    const ch = agentDmChannel(OWNER.pub, agent);
    const reqs = () => [...owner.state.msgs.values()].filter((m) => m.ch === ch && m.approval);
    await until(() => reqs().length >= n, 20_000);
    return must(reqs()[n - 1]?.approval, 'approval');
  };
  const approve = (agent: string, req: string, option: string, extra: { ag?: string } = {}) =>
    owner.publish({ t: 'approve', ch: agentDmChannel(OWNER.pub, agent), to: OWNER.pub, ...extra, b: { req, option } });

  it('asks the owner, ignores answers from agents or malformed ones, and goes on once the owner allows', async () => {
    const run = ask(b, 'gate', 'general', '@gate edit the notes');
    const req = await approvalFor('gate', 1);
    expect(req.title).toBe('edit notes.md');
    approve('gate', req.req, 'allow', { ag: 'echo' }); // an agent signing with the owner key can't approve
    owner.publish({ t: 'approve', ch: agentDmChannel(OWNER.pub, 'gate'), to: OWNER.pub, b: { req: 5 } });
    await new Promise((r) => setTimeout(r, 300));
    expect(ws.host.status.get('gate')).toBe('waiting');
    approve('gate', req.req, 'allow');
    const { answer } = await run;
    expect(answer.text).toBe('Done.');
    expect(answer.trace?.map((s) => [s.title, s.status])).toEqual([['Approved: edit notes.md', 'done']]);
  }, 40_000);

  it('records a decline', async () => {
    const run = ask(b, 'gate', 'general', '@gate again');
    approve('gate', (await approvalFor('gate', 2)).req, 'reject');
    expect((await run).answer.trace?.map((s) => [s.title, s.status])).toEqual([['Declined: edit notes.md', 'skipped']]);
  }, 40_000);

  it('declines on its own after the approval window, picking the best options the agent offered', async () => {
    const prev = ws.host;
    ws.host = new AgentHost(
      cfg,
      () => ws.me,
      () => {},
      (code) => ws.presence(code),
      { staleMs: 60_000, approvalMs: 300 },
    );
    prev.drop('gate');
    process.env.FAKE_ACP_OPTIONS = JSON.stringify([
      { optionId: 'always', name: 'Always', kind: 'allow_always' },
      { optionId: 'never', name: 'Never', kind: 'reject_always' },
    ]);
    try {
      const declined = await ask(b, 'gate', 'general', '@gate wait for me');
      expect(declined.answer.trace?.[0]?.title).toBe('Declined: edit notes.md');
      ws.host.drop('gate');
      process.env.FAKE_ACP_OPTIONS = JSON.stringify([{ optionId: 'ok', kind: 'allow_always' }, { name: 'no id' }]);
      const cancelled = await ask(b, 'gate', 'general', '@gate and now?'); // no reject option: the run is cancelled
      expect(cancelled.answer.trace?.[0]?.title).toBe('Declined: edit notes.md');
    } finally {
      delete process.env.FAKE_ACP_OPTIONS;
      ws.host.drop('gate');
      ws.host = prev;
    }
  }, 40_000);

  it('cancels the permission of an agent removed mid-run', async () => {
    const holdFile = path.join(agentsDir, 'gate', '.fake-hold');
    fs.writeFileSync(holdFile, '');
    const run = ask(b, 'gate', 'general', '@gate quick one');
    await until(() => ws.host.working.has('gate'), 10_000);
    const i = cfg.agents.findIndex((a) => a.id === 'gate');
    const [gate] = cfg.agents.splice(i, 1);
    fs.rmSync(holdFile); // the prompt goes on and asks permission, for an agent that's gone
    try {
      expect((await run).answer.text).toBe('Done.');
    } finally {
      cfg.agents.splice(i, 0, must(gate, 'gate'));
    }
  }, 40_000);
});

describe('runs', () => {
  it('reports tool calls as a trace, and the reply text', async () => {
    const { answer } = await ask(b, 'tools', 'general', '@tools look around');
    expect(answer.text).toBe('Read it.');
    expect(answer.trace?.map((s) => [s.title, s.status, s.tool])).toEqual([
      ['Read notes.md', 'done', 'read'],
      ['Search the web', 'error', undefined],
      ['Tool call', 'done', undefined], // still running when the prompt ended
    ]);
    expect(answer.meta).toMatch(/^3 tools · \d+\.\ds$/);
    const one = await ask(b, 'one', 'general', '@one just one');
    expect(one.answer.meta).toMatch(/^1 tool · /);
    expect(one.answer.text).toBe('Done.');
  }, 40_000);

  it('explains failures in the room: sign-in, agent errors, a missing session', async () => {
    const locked = await ask(b, 'locked', 'general', '@locked hi');
    expect(locked.answer.text).toBe("I can't run yet: GitHub Copilot CLI isn't signed in on my owner's machine.");
    expect(locked.answer.trace?.[0]).toMatchObject({ title: 'Sign-in needed', status: 'error' });
    expect(ws.host.status.get('locked')).toBe('error');
    const broken = await ask(b, 'broken', 'general', '@broken hi');
    expect(broken.answer.text).toBe('I hit an error and stopped: Internal error: disk full');
    const empty = await ask(b, 'empty', 'general', '@empty hi');
    expect(empty.answer.text).toBe('I hit an error and stopped: the agent opened no session');
  }, 40_000);

  it('picks the configured model, and runs with the default when the CLI refuses it', async () => {
    const log = logged();
    await ask(b, 'modelled', 'general', '@modelled hi');
    await ask(b, 'picky', 'general', '@picky hi');
    log.off();
    expect(log.lines).toContain('warn Picky: model not set: Unknown model');
    expect(log.lines.some((l) => l.startsWith('warn Modelled'))).toBe(false);
  }, 40_000);

  it('reuses its session, and starts a new one when the process died or the setup changed', async () => {
    const pid = (m: Msg) => /pid=(\d+)/.exec(m.text)?.[1];
    const one = await ask(b, 'echo', 'general', '@echo one');
    const two = await ask(b, 'echo', 'general', '@echo two');
    expect(pid(two.answer)).toBe(pid(one.answer));
    process.kill(Number(pid(two.answer)));
    await until(() => !ws.host['sessions'].has('echo'));
    const three = await ask(b, 'echo', 'general', '@echo three');
    expect(pid(three.answer)).not.toBe(pid(two.answer));
    const i = cfg.agents.findIndex((a) => a.id === 'echo');
    cfg.agents[i] = { ...must(cfg.agents[i], 'echo'), model: 'gpt-x' };
    const four = await ask(b, 'echo', 'general', '@echo four');
    expect(pid(four.answer)).not.toBe(pid(three.answer));
  }, 40_000);

  it('says where it is working, and skips an agent removed while its next run was queued', async () => {
    const holdFile = path.join(agentsDir, 'echo', '.fake-hold');
    fs.writeFileSync(holdFile, '');
    const first = ask(b, 'echo', 'general', '@echo first');
    const second = b.publish({ t: 'msg', ch: 'general', b: { text: '@echo second' } });
    await until(() => ws.host.working.has('echo') && bridgePeer().state.msgs.has(second.id), 10_000);
    expect(ws.host.workingIn('echo', CODE)).toBe('general');
    expect(ws.host.workingIn('echo', 'OTHERCODE')).toBeNull();
    const i = cfg.agents.findIndex((a) => a.id === 'echo');
    const [echo] = cfg.agents.splice(i, 1);
    fs.rmSync(holdFile);
    try {
      await first;
      await new Promise((r) => setTimeout(r, 500));
      expect(answers(b, 'echo', 'general').some((m) => m.text.includes('second'))).toBe(false);
    } finally {
      cfg.agents.splice(i, 0, must(echo, 'echo'));
    }
  }, 40_000);

  it("logs a run that can't even start, and keeps answering later ones", async () => {
    const prev = ws.host;
    const log = logged();
    ws.host = new AgentHost(
      cfg,
      () => ws.me,
      () => {},
      () => {
        throw new Error('presence is down');
      },
    );
    try {
      b.publish({ t: 'msg', ch: 'general', b: { text: '@echo are you there' } });
      await until(() => log.lines.includes('error echo: presence is down'), 10_000);
    } finally {
      log.off();
      ws.host = prev;
    }
    await ask(b, 'echo', 'general', '@echo now?');
  }, 40_000);
});

describe('what it ignores', () => {
  it('stale, malformed, private-to-others and agent-chained messages', async () => {
    const bridge = bridgePeer();
    const log = logged();
    const ev = (kp: KeyPair, f: Parameters<typeof makeEvent>[1]) => makeEvent(kp, f);
    const now = Date.now();
    bridge.receive([
      ev(B, { ws: CODE, t: 'msg', ch: 'general', ts: now - 10 * 60_000, b: { text: '@echo too late' } }),
      ev(B, { ws: CODE, t: 'msg', ts: now, b: { text: '@echo nowhere' } }),
      ev(B, { ws: CODE, t: 'msg', ch: 'no-such-channel', ts: now, b: { text: '@echo lost' } }),
      ev(X, { ws: CODE, t: 'msg', ch: agentDmChannel(X.pub, 'echo'), to: X.pub, ts: now, b: { text: 'not your owner' } }),
      ev(X, { ws: CODE, t: 'msg', ch: guestDmChannel(X.pub, B.pub, 'echo'), to: B.pub, ts: now, b: { text: "someone else's agent" } }),
    ]);
    b.publish({ t: 'msg', ch: dmChannel(B.pub, OWNER.pub), to: OWNER.pub, b: { text: '@echo a DM to the owner, not the agent' } });
    c.publish({ t: 'msg', ch: guestDmChannel(C.pub, OWNER.pub, 'gate'), to: OWNER.pub, b: { text: 'gate is not discoverable' } });
    c.publish({ t: 'msg', ch: guestDmChannel(C.pub, OWNER.pub, 'away'), to: OWNER.pub, b: { text: 'not in this workspace' } });
    c.publish({ t: 'msg', ch: guestDmChannel(C.pub, OWNER.pub, 'gone'), to: OWNER.pub, b: { text: 'no such agent' } });
    // Agents may hand off to each other, but only 4 times per channel within 5 minutes.
    for (let i = 0; i < 5; i++) owner.publish({ t: 'msg', ch: 'chain', ag: 'relay-bot', b: { text: `@echo hop ${i}` } });
    await until(() => answers(b, 'echo', 'chain').length === 4, 30_000);
    await new Promise((r) => setTimeout(r, 1000));
    log.off();
    expect(answers(b, 'echo', 'chain')).toHaveLength(4);
    expect(answers(b, 'echo', 'general').some((m) => /too late|nowhere|lost/.test(m.text))).toBe(false);
  }, 60_000);

  it('does nothing without an identity or for a workspace it does not serve', () => {
    const bridge = bridgePeer();
    const host = new AgentHost(
      cfg,
      () => null,
      () => {},
      () => {},
    );
    host.onEvents(bridge, [...bridge.events.values()]);
    const elsewhere = new AgentHost(
      { ...cfg, workspaces: [] },
      () => OWNER.pub,
      () => {},
      () => {},
    );
    elsewhere.onEvents(bridge, [...bridge.events.values()]);
    expect(host.working.size + elsewhere.working.size).toBe(0);
    expect(ws.host.workingIn('nobody', CODE)).toBeNull();
  });
});

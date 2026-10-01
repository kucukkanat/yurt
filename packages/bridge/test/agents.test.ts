import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig, Ev } from '@yurt/protocol';
import { AcpConnection } from '../src/acp';
import { AgentHost, isOwnerApproval, mentionedAgents } from '../src/agents';
import type { Config } from '../src/config';
import { FAKE_ACP, alive, fakeCopilotOnPath, tempDir, until } from './helpers';

let restorePath: () => void;
beforeAll(() => {
  restorePath = fakeCopilotOnPath();
});
afterAll(() => restorePath());

const agent = (workdir: string, p: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 'scout-1',
  name: 'Scout',
  handle: 'scout',
  runtime: 'copilot',
  workdir,
  instructions: '',
  autoApprove: ['edit'],
  contextSize: 20,
  respondTo: { mentions: true, replies: false },
  postIn: { thread: true, channel: false },
  discoverable: false,
  ...p,
});
const config = (agents: AgentConfig[]): Config => ({ adminToken: 't', tokens: [], startOnLogin: false, allowedOrigins: [], agents, workspaces: [] });
const workdir = (mode?: string) => {
  const d = tempDir('yurt-agent-');
  if (mode) fs.writeFileSync(path.join(d, '.fake-mode'), mode);
  return d;
};
const pidIn = (d: string) => Number(fs.readFileSync(path.join(d, '.fake-pid'), 'utf8'));

describe('AcpConnection', () => {
  it('close() rejects in-flight requests, so an agent queue cannot hang forever', async () => {
    const d = workdir('hang');
    const c = new AcpConnection('t', process.execPath, [FAKE_ACP], d);
    await c.initialize();
    const prompt = c.request('session/prompt', { sessionId: 'x', prompt: [] });
    c.close();
    await expect(prompt).rejects.toThrow('Agent was stopped');
    await until(() => !alive(pidIn(d)));
  });
});

describe('AgentHost sessions', () => {
  it('applies auto-approve changes to a running session (config resolved by id at permission time)', async () => {
    const d = workdir();
    const cfg = config([agent(d)]);
    const host = new AgentHost(
      cfg,
      () => 'me',
      () => {},
      () => {},
    );
    const s = await host['session'](agent(d));
    const run = () => s.conn.request('session/prompt', { sessionId: s.id, prompt: [] }, 10_000);
    expect(await run()).toMatchObject({ permission: { outcome: 'selected' } });
    cfg.agents[0] = agent(d, { autoApprove: [] }); // what agent.save does: a new object
    expect(await run()).toMatchObject({ permission: { outcome: 'cancelled' } }); // asks the owner; no run in progress → cancelled
    host.drop('scout-1');
  });

  it('closes the agent process when session setup fails (auth error included) and stores nothing', async () => {
    const d = workdir('auth-fail');
    const host = new AgentHost(
      config([agent(d)]),
      () => 'me',
      () => {},
      () => {},
    );
    await expect(host['session'](agent(d))).rejects.toThrow('Authentication required');
    expect(host['sessions'].size).toBe(0);
    await until(() => !alive(pidIn(d)));
  });
});

describe('routing', () => {
  const agents = [agent('/a'), agent('/b', { id: 'rex-1', handle: 'rex', name: 'Rex' })];

  it('finds mentioned agents of the workspace, never the author agent', () => {
    expect(mentionedAgents(agents, ['scout-1', 'rex-1'], 'hey @scout and @rex')).toEqual(['scout-1', 'rex-1']);
    expect(mentionedAgents(agents, ['scout-1', 'rex-1'], 'hey @scout and @rex', 'rex-1')).toEqual(['scout-1']);
    expect(mentionedAgents(agents, ['rex-1'], 'hey @scout')).toEqual([]); // not in this workspace
    expect(mentionedAgents(agents, ['scout-1', 'rex-1'], 'plain agent reply')).toEqual([]); // no chain budget spent
  });

  it('only takes approval answers from the human owner, not an agent signing with the owner key', () => {
    const ev = (p: Partial<Ev>): Ev => ({ id: 'e', ws: 'w', t: 'approve', a: 'me', ts: Date.now(), sig: '', b: { req: 'r', option: 'allow' }, ...p });
    expect(isOwnerApproval(ev({}), 'me')).toBe(true);
    expect(isOwnerApproval(ev({ ag: 'scout-1' }), 'me')).toBe(false);
    expect(isOwnerApproval(ev({ a: 'someone' }), 'me')).toBe(false);
    expect(isOwnerApproval(ev({ t: 'msg' }), 'me')).toBe(false);
  });
});

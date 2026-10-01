import { describe, expect, it } from 'vitest';
import type { BridgeState } from '@yurt/protocol';
import { parseBridgeMessage } from '../src/lib/bridgeMessages';
import { anything, fc } from './fuzz';

const json = (x: unknown) => JSON.stringify(x);
const agent: BridgeState['agents'][number] = {
  id: 'scout-1',
  name: 'Scout',
  handle: 'scout',
  runtime: 'copilot',
  model: 'gpt-5',
  workdir: '/w',
  instructions: 'Be brief',
  autoApprove: ['read', 'edit'],
  contextSize: 30,
  respondTo: { mentions: true, replies: true },
  postIn: { thread: true, channel: false },
  discoverable: true,
  status: 'working',
};
const state: BridgeState = {
  version: '1.2.3',
  identity: { pub: 'p', name: 'Ada', handle: 'ada' },
  agents: [agent],
  workspaces: [{ code: 'K7QX2MPD', name: 'W', agents: ['scout-1'], peers: 2 }],
  runtimes: [{ id: 'copilot', name: 'Copilot', installed: true, version: '1', auth: 'signed-in', busy: 'checking', loginHint: 'gh auth' }],
  startOnLogin: true,
  allowedOrigins: ['https://x.example'],
  pairingCode: '123456',
  home: '/home/ada',
};

describe('bridge messages', () => {
  it('parse every message the bridge sends', () => {
    expect(parseBridgeMessage(json({ t: 'hello', ok: true, paired: true, admin: false, version: '1' }))).toEqual({
      t: 'hello',
      ok: true,
      paired: true,
      admin: false,
      version: '1',
    });
    expect(parseBridgeMessage(json({ t: 'paired', token: 'tok' }))).toEqual({ t: 'paired', token: 'tok' });
    expect(parseBridgeMessage(json({ t: 'error', msg: 'Wrong pairing code' }))).toEqual({ t: 'error', msg: 'Wrong pairing code' });
    expect(parseBridgeMessage(json({ t: 'state', state }))).toEqual({ t: 'state', state });
    expect(parseBridgeMessage(json({ t: 'log', at: 1, level: 'acp', src: 'scout', msg: 'hi' }))).toEqual({ t: 'log', at: 1, level: 'acp', src: 'scout', msg: 'hi' });
  });

  it('default what an older or newer bridge leaves out', () => {
    expect(parseBridgeMessage(json({ t: 'hello' }))).toEqual({ t: 'hello', ok: true, paired: false, admin: false, version: '' });
    expect(parseBridgeMessage(json({ t: 'error' }))).toEqual({ t: 'error', msg: '' });
    expect(parseBridgeMessage(json({ t: 'log' }))).toEqual({ t: 'log', at: 0, level: 'info', src: '', msg: '' });
    expect(parseBridgeMessage(json({ t: 'state', state: {} }))).toEqual({
      t: 'state',
      state: { version: '', identity: null, agents: [], workspaces: [], runtimes: [], startOnLogin: false, allowedOrigins: [] },
    });
  });

  it('read agents from bridges that predate triggers and placement', () => {
    const { respondTo: _r, postIn: _p, discoverable: _d, model: _m, ...old } = agent;
    const parse = (a: unknown) => {
      const m = parseBridgeMessage(json({ t: 'state', state: { agents: [a] } }));
      return m?.t === 'state' ? m.state.agents : null;
    };
    expect(parse({ ...old, replyIn: 'channel' })).toEqual([
      { ...old, respondTo: { mentions: true, replies: false }, postIn: { thread: false, channel: true }, discoverable: false },
    ]);
    expect(parse({ ...old, postIn: { thread: false, channel: false } })?.[0]?.postIn).toEqual({ thread: true, channel: false });
    expect(parse({ id: 'x', name: 'X', handle: 'x', runtime: 'copilot' })).toEqual([
      {
        id: 'x',
        name: 'X',
        handle: 'x',
        runtime: 'copilot',
        workdir: '',
        instructions: '',
        autoApprove: [],
        contextSize: 20,
        respondTo: { mentions: true, replies: false },
        postIn: { thread: true, channel: false },
        discoverable: false,
        status: 'idle',
      },
    ]);
  });

  it('drop the malformed parts of a state and keep the rest', () => {
    const m = parseBridgeMessage(
      json({
        t: 'state',
        state: {
          version: 2,
          identity: 'me',
          agents: [agent, { ...agent, runtime: 'gpt-cli' }, null, { ...agent, autoApprove: ['read', 'fly'], contextSize: 0, status: 'asleep' }],
          workspaces: [{ code: 'A', agents: ['x', 1], peers: -1 }, { name: 'no code' }],
          runtimes: [
            { id: 'nope', name: 'x' },
            { id: 'pi', name: 'Pi', auth: 'maybe' },
          ],
          startOnLogin: 'yes',
          allowedOrigins: ['https://a', 5],
        },
      }),
    );
    expect(m?.t === 'state' && m.state).toEqual({
      version: '',
      identity: null,
      agents: [agent, { ...agent, autoApprove: ['read'], contextSize: 20, status: 'idle' }],
      workspaces: [{ code: 'A', name: '', agents: ['x'] }],
      runtimes: [{ id: 'pi', name: 'Pi', installed: false, auth: 'unknown' }],
      startOnLogin: false,
      allowedOrigins: ['https://a'],
    });
  });

  it('ignore anything that isn’t a known message', () => {
    for (const data of [
      new ArrayBuffer(2),
      42,
      null,
      'not json',
      '{"t":"teleport"}',
      '[]',
      json({ t: 'paired' }),
      json({ t: 'paired', token: '' }),
      json({ t: 'state', state: [] }),
    ])
      expect(parseBridgeMessage(data)).toBeNull();
  });

  it('never throw on any frame', () => {
    fc.assert(fc.property(anything, (x) => void parseBridgeMessage(x)));
    fc.assert(fc.property(fc.string(), (s) => void parseBridgeMessage(s)));
    fc.assert(fc.property(anything, (x) => void parseBridgeMessage(json({ t: 'state', state: x }))));
  });
});

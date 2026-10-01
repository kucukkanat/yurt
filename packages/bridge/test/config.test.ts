import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers';

// config.ts reads YURT_HOME on import, so it's imported after pointing it at a temp folder.
const home = tempDir('yurt-home-');
let loadConfig: typeof import('../src/config').loadConfig;
let sanitize: typeof import('../src/server').sanitize;
beforeAll(async () => {
  process.env.YURT_HOME = home;
  ({ loadConfig } = await import('../src/config'));
  ({ sanitize } = await import('../src/server'));
});

const write = (c: object) => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(c));

describe('loadConfig', () => {
  it('defaults allowed origins when never set', () => {
    write({});
    expect(loadConfig().allowedOrigins).toContain('http://localhost:5173');
  });

  it('respects an explicitly empty origin list', () => {
    write({ allowedOrigins: [] });
    expect(loadConfig().allowedOrigins).toEqual([]);
  });
});

describe('agent room settings', () => {
  const old = { id: 'a-1', name: 'A', handle: 'a', runtime: 'copilot', workdir: '/tmp/a', instructions: '', autoApprove: [], contextSize: 20 };

  it('migrates agents saved with only replyIn when loading the config', () => {
    write({ agents: [{ ...old, replyIn: 'channel' }, { ...old, id: 'b-1', handle: 'b' }] });
    const [a, b] = loadConfig().agents;
    expect(a).toEqual({ ...old, respondTo: { mentions: true, replies: false }, postIn: { thread: false, channel: true }, discoverable: false });
    expect(b.postIn).toEqual({ thread: true, channel: false });
    expect('replyIn' in a).toBe(false);
  });

  it('keeps valid new settings and drops malformed ones on save', () => {
    const prefs = { respondTo: { mentions: false, replies: true }, postIn: { thread: true, channel: true }, discoverable: true };
    expect(sanitize({ ...old, ...prefs } as never)).toMatchObject(prefs);
    expect(sanitize({ ...old, respondTo: 'all', discoverable: 'yes' } as never)).toMatchObject({ respondTo: { mentions: true, replies: false }, discoverable: false });
  });

  it('refuses an agent with nowhere to post', () => {
    expect(() => sanitize({ ...old, postIn: { thread: false, channel: false } } as never)).toThrow('Pick where the agent posts');
  });
});

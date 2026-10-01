import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { newNostrTransport, newRecoveryPhrase, newTrysteroTransport } from '@yurt/protocol';
import { must, tempDir } from './helpers';

// config.ts reads YURT_HOME on import, so it's imported after pointing it at a temp folder.
const home = tempDir('yurt-home-');
let config: typeof import('../src/config');
beforeAll(async () => {
  process.env.YURT_HOME = home;
  config = await import('../src/config');
});

const file = (name: string) => path.join(home, name);
const write = (c: unknown) => fs.writeFileSync(file('config.json'), typeof c === 'string' ? c : JSON.stringify(c));
const old = { id: 'a-1', name: 'A', handle: 'a', runtime: 'copilot', workdir: '/tmp/a', instructions: '', autoApprove: [], contextSize: 20 };

describe('loadConfig', () => {
  it('starts fresh without a config, and keeps its new admin token', () => {
    fs.rmSync(file('config.json'), { force: true });
    const c = config.loadConfig();
    expect(c).toMatchObject({ tokens: [], startOnLogin: false, agents: [], workspaces: [] });
    expect(c.adminToken).toMatch(/^[0-9a-f]{48}$/);
    expect(config.loadConfig().adminToken).toBe(c.adminToken);
  });

  it('defaults allowed origins when never set, and respects an explicitly empty list', () => {
    write({});
    expect(config.loadConfig().allowedOrigins).toContain('http://localhost:5173');
    write({ allowedOrigins: [] });
    expect(config.loadConfig().allowedOrigins).toEqual([]);
  });

  it('survives a corrupt or hand-mangled file: bad fields fall back, good ones stay', () => {
    write('{ not json');
    expect(config.loadConfig().agents).toEqual([]);
    const t = newNostrTransport(['wss://relay.example']);
    const p2p = newTrysteroTransport({ kind: 'torrent', urls: ['wss://tracker.example'] });
    write({
      adminToken: 42,
      tokens: ['ok', 7],
      startOnLogin: 'yes',
      allowedOrigins: 'https://x',
      agents: [old, 'nope', { ...old, id: 'bad', runtime: 'vim' }],
      workspaces: [
        { code: 'AAAABBBB', name: 'W', agents: ['a-1', 3], transport: t, creator: null },
        { code: '' },
        { code: 'CCCCDDDD', transport: { kind: 'nostr' } },
        { code: 'EEEEFFFF', name: 'P', agents: [], transport: p2p },
      ],
    });
    const c = config.loadConfig();
    expect(c.adminToken).toMatch(/^[0-9a-f]{48}$/);
    expect(c.tokens).toEqual(['ok']);
    expect(c.startOnLogin).toBe(false);
    expect(c.allowedOrigins).toContain('http://localhost:5173');
    expect(c.agents.map((a) => a.id)).toEqual(['a-1']); // the unrunnable agent is dropped
    expect(c.workspaces).toEqual([
      { code: 'AAAABBBB', name: 'W', agents: ['a-1'], transport: t, creator: null },
      { code: 'CCCCDDDD', name: '', agents: [], transport: { kind: 'trystero' } }, // an unreadable transport: legacy, as before transports existed
      { code: 'EEEEFFFF', name: 'P', agents: [], transport: p2p },
    ]);
  });
});

describe('identity', () => {
  it('reads back what was saved, and nothing from a missing or malformed file', () => {
    fs.rmSync(file('identity.json'), { force: true });
    expect(config.loadIdentity()).toBeNull();
    const id = { phrase: newRecoveryPhrase(), name: 'Ada', handle: 'ada' };
    config.saveIdentity(id);
    expect(config.loadIdentity()).toEqual(id);
    expect(fs.statSync(file('identity.json')).mode & 0o777).toBe(0o600);
    fs.writeFileSync(file('identity.json'), JSON.stringify({ phrase: 1 }));
    expect(config.loadIdentity()).toBeNull();
  });
});

describe('agent room settings', () => {
  it('migrates agents saved with only replyIn when loading the config', () => {
    write({
      agents: [
        { ...old, replyIn: 'channel' },
        { ...old, id: 'b-1', handle: 'b' },
      ],
    });
    const [first, second] = config.loadConfig().agents;
    const a = must(first, 'first agent');
    const b = must(second, 'second agent');
    expect(a).toEqual({ ...old, respondTo: { mentions: true, replies: false }, postIn: { thread: false, channel: true }, discoverable: false, online: true });
    expect(b.postIn).toEqual({ thread: true, channel: false });
    expect('replyIn' in a).toBe(false);
  });

  // Deliberately malformed input, the way an outdated or hostile page could send it.
  it('keeps valid new settings and drops malformed ones on save', () => {
    const prefs = { respondTo: { mentions: false, replies: true }, postIn: { thread: true, channel: true }, discoverable: true, online: false };
    expect(config.sanitize({ ...old, ...prefs })).toMatchObject(prefs);
    expect(config.sanitize({ ...old, respondTo: 'all', discoverable: 'yes', online: 'no' })).toMatchObject({
      respondTo: { mentions: true, replies: false },
      discoverable: false,
      online: true,
    });
  });

  it('refuses an agent with nowhere to post', () => {
    expect(() => config.sanitize({ ...old, postIn: { thread: false, channel: false } })).toThrow('Pick where the agent posts');
  });
});

describe('sanitize', () => {
  it('explains each missing piece in words the bridge page shows', () => {
    expect(() => config.sanitize('agent')).toThrow('Invalid agent');
    expect(() => config.sanitize({ ...old, runtime: 'vim' })).toThrow('Unknown runtime');
    expect(() => config.sanitize({ ...old, name: '   ' })).toThrow('Give the agent a name');
    expect(() => config.sanitize({ ...old, handle: '', name: '!!!' })).toThrow('Give the agent a handle');
    expect(() => config.sanitize({ ...old, workdir: 'relative/dir' })).toThrow('Pick a folder with a full path');
  });

  it('normalizes names, handles, paths, tools, context and model', () => {
    const a = config.sanitize({
      ...old,
      id: '',
      name: '  Scout the Great, first of its name, finder of things  ',
      handle: '',
      workdir: '/tmp/x/../a',
      model: '  gpt  ',
      autoApprove: ['read', 'hack', 'edit'],
      contextSize: '500',
      instructions: 'x'.repeat(9000),
    });
    expect(a.name).toBe('Scout the Great, first of its name, find');
    expect(a.handle).toBe('scout-the-great-first-of');
    expect(a.id).toMatch(/^scout-the-great-first-of-[0-9a-f]{4}$/);
    expect(a.workdir).toBe('/tmp/a');
    expect(a.model).toBe('gpt');
    expect(a.autoApprove).toEqual(['read', 'edit']);
    expect(a.contextSize).toBe(200);
    expect(a.instructions).toHaveLength(8000);
    expect('model' in config.sanitize({ ...old, model: '  ' })).toBe(false);
    expect(config.sanitize({ ...old, contextSize: 'lots' }).contextSize).toBe(20);
    expect(config.sanitize({ ...old, contextSize: -3 }).contextSize).toBe(1);
    // Found by test/fuzz.test.ts: Number() on an object without a callable toString threw "Cannot convert object to primitive value".
    expect(config.sanitize({ ...old, contextSize: { toString: {} } }).contextSize).toBe(20);
  });
});

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
import { WebSocketServer } from 'ws';
import { FAKE_AGENT, tempDir } from '../helpers';
import { PAGE_ORIGINS, type FixtureBridge } from './fixtures';

declare module 'vitest' {
  export interface ProvidedContext {
    busy: FixtureBridge;
    fresh: FixtureBridge;
    /** A bridge that only ever sends what the page can't use (as a much older or newer bridge might). */
    odd: string;
  }
}

const pkg = path.resolve(import.meta.dirname, '..', '..');

/** Starts `args` under tsx as a bridge process; resolves with what it prints after `prefix` (or its pairing URL). */
function bridgeProcess(args: string[], env: NodeJS.ProcessEnv, ready: (out: string) => string | null): Promise<{ p: ChildProcess; line: string }> {
  const p = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd: pkg, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('bridge fixture did not start:\n' + out)), 90_000);
    const onData = (d: Buffer) => {
      out += d;
      const line = ready(out);
      if (line === null) return;
      clearTimeout(timer);
      res({ p, line });
    };
    p.stdout?.on('data', onData);
    p.stderr?.on('data', (d: Buffer) => (out += d));
    p.on('exit', (code) => rej(new Error(`bridge fixture exited (${code}):\n${out}`)));
  });
}

/** Stand-ins for agent CLIs, npm and terminals: real scripts, slowed down so the page can show what's in progress. */
function fakeBin(dir: string, bins: Record<string, string>) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(bins)) fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return [dir, '/usr/bin', '/bin'].join(path.delimiter);
}

export default async function setup(project: TestProject) {
  const root = tempDir('yurt-ui-');
  const children: ChildProcess[] = [];

  // The busy bridge: its own HOME (start on login writes there), PATH and data folder.
  const busyHome = path.join(root, 'busy');
  const busyPath = fakeBin(path.join(root, 'busy-bin'), {
    copilot: `sleep 0.3\n${FAKE_AGENT}`,
    opencode: `sleep 0.5\nFAKE_ACP_MODE=auth-fail ${FAKE_AGENT}`,
    pi: 'true',
    npm: 'sleep 1\necho "npm ERR! code E403" >&2\nexit 1',
    osascript: 'true',
    'x-terminal-emulator': 'true',
  });
  const busy = await bridgeProcess(
    ['test/ui/busy-bridge.ts'],
    { ...process.env, HOME: path.join(root, 'busy-user'), YURT_HOME: busyHome, PATH: busyPath },
    (out) => /^READY (.+)$/m.exec(out)?.[1] ?? null,
  );
  children.push(busy.p);
  project.provide('busy', JSON.parse(busy.line));

  // A fresh install, run as `yurt-bridge` itself: nothing linked, installed or created yet.
  const freshHome = path.join(root, 'fresh');
  fs.mkdirSync(freshHome);
  fs.writeFileSync(path.join(freshHome, 'config.json'), JSON.stringify({ adminToken: 'fresh-admin', tokens: ['fresh-web'], allowedOrigins: PAGE_ORIGINS }));
  const freshEnv = { ...process.env, HOME: path.join(root, 'fresh-user'), YURT_HOME: freshHome, PATH: ['/usr/bin', '/bin'].join(path.delimiter) };
  const startFresh = (port: string) =>
    bridgeProcess(['src/cli.ts', '--no-open', '--port', port], freshEnv, (out) => /Setup\s+http:\/\/127\.0\.0\.1:(\d+)\//.exec(out)?.[1] ?? null);
  let fresh = await startFresh('0');
  const port = fresh.line;
  project.provide('fresh', { url: `ws://127.0.0.1:${port}/ws`, admin: 'fresh-admin', web: 'fresh-web' });
  globalThis.__yurtBridgeFixtures = {
    async freshDown() {
      const exited = new Promise((r) => fresh.p.once('exit', r));
      fresh.p.kill('SIGTERM');
      await exited;
    },
    async freshUp() {
      fresh = await startFresh(port);
    },
  };

  const odd = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  odd.on('connection', (sock) => {
    for (const m of ['not json', JSON.stringify({ t: 'state', state: { version: 1 } }), JSON.stringify({ t: 'news' }), JSON.stringify({ t: 'log', level: 'loud' })]) sock.send(m);
  });
  await new Promise((r) => odd.once('listening', r));
  const address = odd.address();
  if (!address || typeof address !== 'object') throw new Error('the odd bridge has no port');
  project.provide('odd', `ws://127.0.0.1:${address.port}/ws`);

  return () => {
    odd.close();
    for (const p of [...children, fresh.p]) p.kill('SIGKILL');
    globalThis.__yurtBridgeFixtures = undefined;
    fs.rmSync(root, { recursive: true, force: true });
  };
}

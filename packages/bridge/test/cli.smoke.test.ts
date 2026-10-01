/**
 * Smoke test of the published artifact: builds dist/ (UI + CLI bundle) in beforeAll, then runs
 * `node dist/cli.js` as a real process. It builds itself rather than trusting an existing dist/,
 * so it can't pass against a stale bundle; that costs a few seconds per run.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(pkg, 'dist', 'cli.js');
const bin = path.join(pkg, 'node_modules', '.bin');

beforeAll(() => {
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
  for (const [cmd, args] of [
    ['vite', ['build', '--config', 'ui/vite.config.ts', '--logLevel', 'error']],
    ['tsup', ['--silent']],
  ] as const) {
    const r = spawnSync(cmd, [...args], { cwd: pkg, env, encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stdout}\n${r.stderr}`);
  }
}, 120_000);

function start(args: string[]) {
  const home = tempDir('yurt-smoke-');
  const p = spawn(process.execPath, [cli, ...args], { env: { ...process.env, YURT_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  const exited = new Promise<number | null>((res) =>
    p.on('exit', (code) => {
      fs.rmSync(home, { recursive: true, force: true });
      res(code);
    }),
  );
  return { p, output: () => out, exited };
}

describe('built CLI', () => {
  it('starts, serves the UI and exits cleanly on SIGINT', async () => {
    const { p, output, exited } = start(['--no-open', '--port', '0']);
    const end = Date.now() + 20_000;
    let url: string | undefined;
    while (!(url = /Setup\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(output())?.[1])) {
      if (Date.now() > end || p.exitCode !== null) throw new Error('bridge did not start:\n' + output());
      await new Promise((r) => setTimeout(r, 50));
    }
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('__YURT_ADMIN__');
    p.kill('SIGINT');
    expect(await exited).toBe(0);
  }, 30_000);

  it('rejects --port without a number instead of reading another argument', async () => {
    const { output, exited } = start(['--no-open', '--port']);
    expect(await exited).toBe(2);
    expect(output()).toContain('--port needs a number');
  });
});

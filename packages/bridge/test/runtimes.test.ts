import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { acpCommand, check, detect, runtimeStatus, whichPath } from '../src/runtimes';
import { fakeCopilotOnPath, tempDir } from './helpers';

const saved = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR };
// Assigning undefined to process.env stores the string "undefined", so unset what wasn't set.
const restore = (k: keyof typeof saved) => {
  const v = saved[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};
afterEach(() => {
  restore('PATH');
  restore('TMPDIR');
});

describe('acpCommand', () => {
  it('keeps native ACP commands and npx where npx exists', () => {
    expect(acpCommand('copilot')).toEqual(['copilot', ['--acp']]);
    if (whichPath('npx')) expect(acpCommand('codex')).toEqual(['npx', ['-y', '@zed-industries/codex-acp']]);
  });

  it('uses bunx on a Bun-only machine', () => {
    const bun = whichPath('bun');
    if (!bun) return; // needs a real Bun to stand in for a Bun-only PATH
    const bin = tempDir('yurt-bunonly-');
    fs.symlinkSync(bun, path.join(bin, 'bun'));
    process.env.PATH = [bin, '/usr/bin', '/bin'].join(path.delimiter); // `which` lives here, npx doesn't
    expect(acpCommand('claude')).toEqual(['bunx', ['@zed-industries/claude-code-acp']]);
    fs.rmSync(bin, { recursive: true, force: true });
  });
});

describe('check', () => {
  it('signs the runtime in and removes its scratch folder', async () => {
    const restore = fakeCopilotOnPath();
    const tmp = tempDir('yurt-tmp-');
    process.env.TMPDIR = tmp; // os.tmpdir() reads it on each call
    try {
      detect('copilot');
      await check('copilot');
      expect(runtimeStatus().find((r) => r.id === 'copilot')).toMatchObject({ installed: true, auth: 'signed-in', version: '9.9.9' });
      expect(fs.readdirSync(tmp).filter((f) => f.startsWith('yurt-check-'))).toEqual([]);
    } finally {
      restore();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

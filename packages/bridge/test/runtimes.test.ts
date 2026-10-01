import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { acpCommand, check, detect, detectAll, install, login, openTerminal, runtimeStatus, whichPath, onRuntimeChange } from '../src/runtimes';
import { FAKE_AGENT, fakeBins, saveEnv, tempDir, until } from './helpers';

// Every tool the runtimes module runs (which, npm, bun, the agent CLIs, terminals) is a real executable: either the
// system's `which`/`sh`, or a script from fakeBins standing in for npm, osascript and friends. Nothing is installed.
const restoreEnv = saveEnv('TMPDIR', 'FAKE_ACP_MODE', 'FAKE_ACP_VERSION');
let restorePath: (() => void) | null = null;
afterEach(() => {
  restorePath?.();
  restorePath = null;
  restoreEnv();
});
const bins = (b: Record<string, string>, keep?: 'all' | 'system' | 'none') => {
  const f = fakeBins(b, keep);
  restorePath = f.restore;
  return f;
};
const RECORD = 'echo "$@" >> "$0.log"';
const statusOf = (id: string) => runtimeStatus().find((r) => r.id === id);

describe('runtime status', () => {
  it('lists every runtime as not installed before anything was detected', () => {
    bins({});
    const before = runtimeStatus().map((r) => [r.id, r.installed, r.auth]);
    detect('pi'); // nobody listens yet: changes are still recorded
    expect(before).toEqual([
      ['copilot', false, 'unknown'],
      ['opencode', false, 'unknown'],
      ['codex', false, 'unknown'],
      ['claude', false, 'unknown'],
      ['pi', false, 'unknown'],
    ]);
  });

  it('detects installed CLIs and their versions, and notifies listeners', () => {
    let changes = 0;
    onRuntimeChange(() => changes++);
    bins({ copilot: FAKE_AGENT, opencode: 'echo' });
    detectAll();
    expect(statusOf('copilot')).toMatchObject({ installed: true, version: '9.9.9', loginHint: 'copilot' });
    expect(statusOf('opencode')).toMatchObject({ installed: true });
    expect(statusOf('opencode')?.version).toBeUndefined(); // printed nothing useful
    expect(statusOf('codex')).toMatchObject({ installed: false, auth: 'unknown' });
    expect(changes).toBe(5);
    onRuntimeChange(() => {});
  });
});

describe('whichPath', () => {
  it('finds a command with `which`, or `where` on Windows', () => {
    const f = bins({ tool: 'true', where: "printf '%s\\r\\n' 'C:\\a\\tool.exe' 'C:\\b\\tool.exe'" });
    expect(whichPath('tool')).toBe(path.join(f.dir, 'tool'));
    expect(whichPath('no-such-tool-anywhere')).toBeNull();
    expect(whichPath('tool', 'win32')).toBe('C:\\a\\tool.exe');
  });
});

describe('acpCommand', () => {
  it('keeps native ACP commands, and npx where npx exists', () => {
    bins({ npx: 'true' });
    expect(acpCommand('copilot')).toEqual(['copilot', ['--acp']]);
    expect(acpCommand('codex')).toEqual(['npx', ['-y', '@zed-industries/codex-acp']]);
  });

  it('uses bunx on a Bun-only machine, and npx when neither exists (it fails later, visibly)', () => {
    bins({ bun: 'true' });
    expect(acpCommand('claude')).toEqual(['bunx', ['@zed-industries/claude-code-acp']]);
    restorePath?.();
    bins({});
    expect(acpCommand('claude')).toEqual(['npx', ['-y', '@zed-industries/claude-code-acp']]);
  });
});

describe('check', () => {
  it('signs the runtime in and removes its scratch folder', async () => {
    bins({ copilot: FAKE_AGENT }, 'all');
    const tmp = tempDir('yurt-tmp-');
    process.env.TMPDIR = tmp; // os.tmpdir() reads it on each call
    detect('copilot');
    await check('copilot');
    expect(statusOf('copilot')).toMatchObject({ installed: true, auth: 'signed-in', version: '9.9.9' });
    expect(statusOf('copilot')?.busy).toBeUndefined();
    expect(fs.readdirSync(tmp).filter((f) => f.startsWith('yurt-check-'))).toEqual([]);
  });

  it('marks a signed-out CLI, and one whose check fails otherwise as unknown', async () => {
    bins({ copilot: FAKE_AGENT }, 'all');
    detect('copilot');
    process.env.FAKE_ACP_MODE = 'auth-fail';
    await check('copilot');
    expect(statusOf('copilot')?.auth).toBe('signed-out');
    process.env.FAKE_ACP_MODE = 'crash';
    await check('copilot');
    expect(statusOf('copilot')?.auth).toBe('unknown');
  });

  it('does nothing for a CLI that is not installed', async () => {
    bins({});
    detect('pi');
    await check('pi');
    expect(statusOf('pi')).toMatchObject({ installed: false, auth: 'unknown' });
  });
});

describe('install', () => {
  it('installs globally with npm, then detects and checks the CLI', async () => {
    const f = bins({ npm: `${RECORD}\necho installed\necho "npm WARN deprecated" >&2`, copilot: FAKE_AGENT });
    expect(await install('copilot')).toBe(true);
    expect(f.record('npm')).toBe('install -g @github/copilot\n');
    await until(() => statusOf('copilot')?.auth === 'signed-in'); // the check after an install isn't awaited
    expect(statusOf('copilot')).toMatchObject({ installed: true });
  });

  it('uses Bun when npm is missing, and reports a failed install', async () => {
    const f = bins({ bun: `${RECORD}\nexit 1` });
    expect(await install('pi')).toBe(false);
    expect(f.record('bun')).toBe('add -g @mariozechner/pi-coding-agent\n');
    expect(statusOf('pi')?.busy).toBeUndefined();
  });

  it('reports a machine with neither npm nor Bun instead of crashing', async () => {
    bins({});
    expect(await install('codex')).toBe(false);
    expect(statusOf('codex')).toMatchObject({ installed: false });
  });
});

describe('login', () => {
  it('signs in through ACP when the agent offers a method', async () => {
    bins({ opencode: FAKE_AGENT }, 'all');
    process.env.FAKE_ACP_MODE = 'auth-methods';
    detect('opencode');
    await login('opencode', 'darwin');
    expect(statusOf('opencode')).toMatchObject({ auth: 'signed-in' });
    expect(statusOf('opencode')?.busy).toBeUndefined();
  });

  it("opens the CLI's own login in a terminal when ACP has none, or can't start", async () => {
    // Native ACP commands only (npx-based runtimes would fetch packages).
    const f = bins({ copilot: FAKE_AGENT, opencode: FAKE_AGENT, osascript: RECORD });
    await login('copilot'); // this machine's platform: macOS runs osascript
    if (process.platform === 'darwin') await until(() => f.record('osascript').includes('do script "copilot"'));
    process.env.FAKE_ACP_MODE = 'crash';
    await login('opencode', 'darwin');
    await until(() => f.record('osascript').includes('opencode auth login'));
    expect(statusOf('opencode')?.busy).toBeUndefined();
  });
});

describe('openTerminal', () => {
  it('uses Terminal on macOS, escaping quotes', async () => {
    const f = bins({ osascript: RECORD });
    openTerminal('say "hi"', 'darwin');
    await until(() => f.record('osascript').includes('do script "say \\"hi\\""'));
  });

  it('uses cmd on Windows', async () => {
    const f = bins({ cmd: RECORD });
    openTerminal('pi', 'win32');
    await until(() => f.record('cmd') === '/c start cmd /k pi\n');
  });

  it('uses the first terminal it finds on Linux, with the arguments each expects', async () => {
    let f = bins({ 'gnome-terminal': RECORD, xterm: RECORD });
    openTerminal('claude', 'linux');
    await until(() => f.record('gnome-terminal') === '-- sh -c claude; exec sh\n');
    expect(f.record('xterm')).toBe('');
    restorePath?.();
    f = bins({ xterm: RECORD });
    openTerminal('claude', 'linux');
    await until(() => f.record('xterm') === '-e sh -c claude; exec sh\n');
  });

  it('says what to run when there is no terminal, or the launcher is missing', async () => {
    bins({});
    const dir = tempDir('yurt-quiet-');
    const lines: string[] = [];
    const { onLog } = await import('../src/log');
    const off = onLog((e) => lines.push(e.msg));
    openTerminal('codex login', 'linux');
    process.env.PATH = dir; // no osascript at all
    openTerminal('codex login', 'darwin');
    await until(() => lines.some((l) => l.startsWith("couldn't open a terminal")));
    off();
    expect(lines).toContain('No terminal found. Run this yourself: codex login');
  });
});

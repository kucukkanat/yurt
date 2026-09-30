import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeId, RuntimeStatus } from '@yurt/protocol';
import { AcpConnection, isAuthError } from './acp';
import { log } from './log';

interface RuntimeDef {
  name: string;
  bin: string;              // CLI that must be on PATH
  acp: [string, ...string[]]; // command that speaks ACP on stdio
  npm: string;              // package for one-click install
  login: string;            // shown / run in a terminal when ACP has no auth method
}

// Order matters: this is the order shown in the UI.
export const RUNTIMES: Record<RuntimeId, RuntimeDef> = {
  copilot: { name: 'GitHub Copilot CLI', bin: 'copilot', acp: ['copilot', '--acp'], npm: '@github/copilot', login: 'copilot' },
  opencode: { name: 'OpenCode', bin: 'opencode', acp: ['opencode', 'acp'], npm: 'opencode-ai', login: 'opencode auth login' },
  codex: { name: 'Codex', bin: 'codex', acp: ['npx', '-y', '@zed-industries/codex-acp'], npm: '@openai/codex', login: 'codex login' },
  claude: { name: 'Claude Code', bin: 'claude', acp: ['npx', '-y', '@zed-industries/claude-code-acp'], npm: '@anthropic-ai/claude-code', login: 'claude' },
  pi: { name: 'Pi', bin: 'pi', acp: ['npx', '-y', 'pi-acp'], npm: '@mariozechner/pi-coding-agent', login: 'pi' },
};
export const RUNTIME_IDS = Object.keys(RUNTIMES) as RuntimeId[];

const status = new Map<RuntimeId, RuntimeStatus>();
let onChange: () => void = () => {};
export const onRuntimeChange = (f: () => void) => { onChange = f; };

function set(id: RuntimeId, p: Partial<RuntimeStatus>) {
  status.set(id, { ...(status.get(id) || { id, name: RUNTIMES[id].name, installed: false, auth: 'unknown' }), ...p });
  onChange();
}

/** Absolute path of `bin` on PATH, or null. */
export function whichPath(bin: string): string | null {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return (r.status === 0 && r.stdout.trim().split(/\r?\n/)[0]) || null;
}
const which = (bin: string) => whichPath(bin) !== null;

/** The command that speaks ACP; `npx -y pkg` becomes `bunx pkg` on machines that only have Bun. */
export function acpCommand(id: RuntimeId): [string, string[]] {
  const [cmd, ...args] = RUNTIMES[id].acp;
  if (cmd !== 'npx' || which('npx') || !which('bun')) return [cmd, args];
  return ['bunx', args.filter((a) => a !== '-y')];
}

export function detect(id: RuntimeId) {
  const d = RUNTIMES[id];
  const installed = which(d.bin);
  let version: string | undefined;
  if (installed) {
    const r = spawnSync(d.bin, ['--version'], { encoding: 'utf8', timeout: 8000, shell: process.platform === 'win32' });
    version = (r.stdout || '').trim().split('\n')[0]?.replace(/^[^\d]*/, '').slice(0, 24) || undefined;
  }
  set(id, { installed, version, loginHint: d.login, busy: undefined, auth: installed ? status.get(id)?.auth || 'unknown' : 'unknown' });
}

export function detectAll() { RUNTIME_IDS.forEach(detect); }
export const runtimeStatus = (): RuntimeStatus[] => RUNTIME_IDS.map((id) => status.get(id) || { id, name: RUNTIMES[id].name, installed: false, auth: 'unknown' });

export function install(id: RuntimeId): Promise<boolean> {
  const d = RUNTIMES[id];
  const useBun = !which('npm') && which('bun');
  const [cmd, args] = useBun ? ['bun', ['add', '-g', d.npm]] : ['npm', ['install', '-g', d.npm]];
  set(id, { busy: 'installing' });
  log('info', id, `installing: ${cmd} ${args.join(' ')}`);
  return new Promise((res) => {
    const p = spawn(cmd, args, { shell: process.platform === 'win32', env: process.env });
    p.stdout.on('data', (b) => log('info', id, String(b).trim()));
    p.stderr.on('data', (b) => log('warn', id, String(b).trim()));
    p.on('close', (code) => {
      if (code !== 0) log('error', id, 'install failed (' + code + '). If npm needs admin rights, run: ' + cmd + ' ' + args.join(' '));
      detect(id);
      if (code === 0) check(id);
      res(code === 0);
    });
  });
}

/** Start the agent over ACP in a scratch dir and open a session to learn whether it's signed in. */
export async function check(id: RuntimeId): Promise<void> {
  if (!status.get(id)?.installed) return;
  set(id, { busy: 'checking' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yurt-check-'));
  const c = new AcpConnection(id + ':check', ...acpCommand(id), dir);
  try {
    await c.initialize();
    await c.request('session/new', { cwd: dir, mcpServers: [] }, 60_000);
    set(id, { auth: 'signed-in', busy: undefined });
  } catch (e) {
    set(id, { auth: isAuthError(e) ? 'signed-out' : 'unknown', busy: undefined });
    log(isAuthError(e) ? 'info' : 'warn', id, 'check: ' + (e as Error).message);
  } finally {
    c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Sign in through ACP `authenticate` when offered, otherwise open the CLI's own login in a terminal window. */
export async function login(id: RuntimeId): Promise<void> {
  const d = RUNTIMES[id];
  set(id, { busy: 'signing-in' });
  const dir = os.tmpdir();
  const c = new AcpConnection(id + ':login', ...acpCommand(id), dir);
  try {
    const init = await c.initialize();
    const m = init.authMethods?.[0];
    if (m) { await c.request('authenticate', { methodId: m.id }, 10 * 60_000); c.close(); await check(id); return; }
  } catch (e) { log('warn', id, 'ACP sign-in unavailable: ' + (e as Error).message); }
  c.close();
  openTerminal(d.login);
  set(id, { busy: undefined });
}

export function openTerminal(command: string) {
  log('info', 'bridge', 'opening a terminal for: ' + command);
  if (process.platform === 'darwin') spawn('osascript', ['-e', `tell application "Terminal" to do script "${command.replace(/"/g, '\\"')}"`, '-e', 'tell application "Terminal" to activate']);
  else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', 'cmd', '/k', command], { shell: true });
  else {
    for (const t of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']) {
      if (!which(t)) continue;
      spawn(t, t === 'gnome-terminal' ? ['--', 'sh', '-c', command + '; exec sh'] : ['-e', 'sh', '-c', command + '; exec sh'], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    log('warn', 'bridge', 'No terminal found. Run this yourself: ' + command);
  }
}

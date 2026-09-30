import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from './log';
import { whichPath } from './runtimes';

/**
 * What login should run. A global install's dist/cli.js is stable, so it runs directly with this
 * Node. npx/bunx run from a cache that gets wiped, so login goes through the runner again instead.
 * A source checkout (tsx, src/cli.ts) has no stable entry point at all, so that's refused.
 */
export function startCommand(script: string, execPath: string): { exe: string; args: string[] } {
  if (!/\.[cm]?js$/.test(script)) throw new Error('start on login needs the built bridge (npx yurt-bridge), not a source checkout');
  if (!/[\\/](_npx|bunx-[^\\/]+)[\\/]/.test(script)) return { exe: execPath, args: [script, '--no-open'] };
  const npx = whichPath('npx');
  if (npx) return { exe: npx, args: ['-y', 'yurt-bridge', '--no-open'] };
  const bunx = whichPath('bunx');
  if (bunx) return { exe: bunx, args: ['yurt-bridge', '--no-open'] };
  throw new Error('start on login needs npx or bunx on PATH');
}

const command = () => startCommand(path.resolve(process.argv[1] || ''), process.execPath);

const MAC = path.join(os.homedir(), 'Library', 'LaunchAgents', 'dev.yurt.bridge.plist');
const LINUX = path.join(os.homedir(), '.config', 'autostart', 'yurt-bridge.desktop');
const WIN = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'yurt-bridge.cmd');

export function setStartOnLogin(on: boolean): boolean {
  const file = process.platform === 'darwin' ? MAC : process.platform === 'win32' ? WIN : LINUX;
  try {
    if (!on) { fs.rmSync(file, { force: true }); return true; }
    const { exe, args } = command(); // only needed to turn it on, so turning off works from any checkout
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (process.platform === 'darwin') {
      fs.writeFileSync(MAC, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.yurt.bridge</string>
  <key>ProgramArguments</key><array>${[exe, ...args].map((a) => `<string>${a}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${process.env.PATH}</string></dict>
</dict></plist>
`);
    } else if (process.platform === 'win32') {
      fs.writeFileSync(WIN, `@echo off\r\nstart "" /min "${exe}" ${args.map((a) => `"${a}"`).join(' ')}\r\n`);
    } else {
      fs.writeFileSync(LINUX, `[Desktop Entry]\nType=Application\nName=Yurt bridge\nExec=${[exe, ...args].map((a) => `"${a}"`).join(' ')}\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`);
    }
    return true;
  } catch (e) {
    log('error', 'bridge', 'start on login failed: ' + (e as Error).message);
    return false;
  }
}

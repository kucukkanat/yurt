import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from './log';

/** Start yurt-bridge when the user logs in. No admin rights needed on any OS. */
function command(): { exe: string; args: string[] } {
  return { exe: process.execPath, args: [path.resolve(process.argv[1]), '--no-open'] };
}

const MAC = path.join(os.homedir(), 'Library', 'LaunchAgents', 'dev.yurt.bridge.plist');
const LINUX = path.join(os.homedir(), '.config', 'autostart', 'yurt-bridge.desktop');
const WIN = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'yurt-bridge.cmd');

export function setStartOnLogin(on: boolean): boolean {
  try {
    const { exe, args } = command();
    if (process.platform === 'darwin') {
      if (!on) { fs.rmSync(MAC, { force: true }); return true; }
      fs.mkdirSync(path.dirname(MAC), { recursive: true });
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
      if (!on) { fs.rmSync(WIN, { force: true }); return true; }
      fs.writeFileSync(WIN, `@echo off\r\nstart "" /min "${exe}" ${args.map((a) => `"${a}"`).join(' ')}\r\n`);
    } else {
      if (!on) { fs.rmSync(LINUX, { force: true }); return true; }
      fs.mkdirSync(path.dirname(LINUX), { recursive: true });
      fs.writeFileSync(LINUX, `[Desktop Entry]\nType=Application\nName=Yurt bridge\nExec=${[exe, ...args].map((a) => `"${a}"`).join(' ')}\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`);
    }
    return true;
  } catch (e) {
    log('error', 'bridge', 'start on login failed: ' + (e as Error).message);
    return false;
  }
}

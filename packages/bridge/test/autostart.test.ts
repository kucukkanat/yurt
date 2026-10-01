import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { setStartOnLogin, startCommand } from '../src/autostart';
import { fakeBins, saveEnv, tempDir } from './helpers';

// Login items are written under a temporary HOME/APPDATA: os.homedir() follows $HOME on POSIX.
const restoreEnv = saveEnv('HOME', 'APPDATA');
let home: string;
let restorePath: (() => void) | null = null;
beforeEach(() => {
  home = tempDir('yurt-home-');
  process.env.HOME = home;
  process.env.APPDATA = path.join(home, 'AppData');
});
afterEach(() => {
  restorePath?.();
  restorePath = null;
  restoreEnv();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('start on login command', () => {
  it('runs a stable install directly with this Node', () => {
    expect(startCommand('/usr/local/lib/node_modules/yurt-bridge/dist/cli.js', '/usr/bin/node')).toEqual({
      exe: '/usr/bin/node',
      args: ['/usr/local/lib/node_modules/yurt-bridge/dist/cli.js', '--no-open'],
    });
  });

  it('goes through the runner again for npx and bunx caches, which get wiped', () => {
    const npxCache = '/home/u/.npm/_npx/1a2b/node_modules/yurt-bridge/dist/cli.js';
    const bunxCache = '/private/tmp/bunx-501-yurt-bridge@latest/node_modules/yurt-bridge/dist/cli.js';
    let f = fakeBins({ npx: 'true', bunx: 'true' });
    restorePath = f.restore;
    for (const script of [npxCache, bunxCache]) expect(startCommand(script, '/usr/bin/node')).toEqual({ exe: path.join(f.dir, 'npx'), args: ['-y', 'yurt-bridge', '--no-open'] });
    f.restore();
    f = fakeBins({ bunx: 'true' });
    restorePath = f.restore;
    expect(startCommand(bunxCache, '/usr/bin/node')).toEqual({ exe: path.join(f.dir, 'bunx'), args: ['yurt-bridge', '--no-open'] });
    f.restore();
    restorePath = fakeBins({}).restore;
    expect(() => startCommand(npxCache, '/usr/bin/node')).toThrow('needs npx or bunx');
  });

  it('refuses a source checkout, which has no stable entry point', () => {
    expect(() => startCommand('/repo/packages/bridge/src/cli.ts', '/usr/bin/node')).toThrow(/built bridge/);
  });
});

describe('setStartOnLogin', () => {
  // Run under Vitest, the "running script" is Vitest's own .js worker: a stable path, run with this Node.
  it('writes a LaunchAgent on macOS, and removes it again', () => {
    const plist = path.join(home, 'Library', 'LaunchAgents', 'dev.yurt.bridge.plist');
    expect(setStartOnLogin(true, 'darwin')).toBe(true);
    const xml = fs.readFileSync(plist, 'utf8');
    expect(xml).toContain('<string>dev.yurt.bridge</string>');
    expect(xml).toContain(`<string>${process.execPath}</string>`);
    expect(xml).toContain('<string>--no-open</string>');
    expect(setStartOnLogin(false, 'darwin')).toBe(true);
    expect(fs.existsSync(plist)).toBe(false);
  });

  it('writes a Startup script on Windows and an autostart entry on Linux', () => {
    expect(setStartOnLogin(true, 'win32')).toBe(true);
    const cmd = fs.readFileSync(path.join(home, 'AppData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'yurt-bridge.cmd'), 'utf8');
    expect(cmd).toMatch(/^@echo off\r\nstart "" \/min ".+" ".+" "--no-open"\r\n$/);
    expect(setStartOnLogin(true, 'linux')).toBe(true);
    const desktop = fs.readFileSync(path.join(home, '.config', 'autostart', 'yurt-bridge.desktop'), 'utf8');
    expect(desktop).toContain('[Desktop Entry]');
    expect(desktop).toContain('"--no-open"');
  });

  it("reports failure when the login item can't be written, and on this machine's platform by default", () => {
    fs.writeFileSync(path.join(home, 'Library'), 'a file where a folder should be');
    fs.mkdirSync(path.join(home, '.config'));
    fs.writeFileSync(path.join(home, '.config', 'autostart'), 'also a file');
    fs.writeFileSync(path.join(home, 'AppData'), 'and here');
    expect(setStartOnLogin(true)).toBe(false);
  });
});

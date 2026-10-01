import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { newNostrTransport, newRecoveryPhrase, keyFromPhrase } from '@yurt/protocol';
import type { Running } from '../src/main';
import { FAKE_AGENT, fakeBins, must, tempDir, until } from './helpers';

// The bridge as `yurt-bridge` starts it, in this process: real config folder, server and runtime checks.
// Browsers and the agent CLI are stand-ins on PATH (see fakeBins); config.ts reads YURT_HOME on import.
const home = tempDir('yurt-main-');
const uiDir = path.join(home, 'ui');
const phrase = newRecoveryPhrase();
let mod: typeof import('../src/main');
let bins: ReturnType<typeof fakeBins>;
const RECORD = 'echo "$@" >> "$0.log"';

beforeAll(async () => {
  process.env.YURT_HOME = path.join(home, 'data');
  fs.mkdirSync(uiDir);
  fs.writeFileSync(path.join(uiDir, 'index.html'), '<html><head></head><body>setup page</body></html>');
  fs.mkdirSync(process.env.YURT_HOME);
  fs.writeFileSync(path.join(process.env.YURT_HOME, 'identity.json'), JSON.stringify({ phrase, name: 'Ada', handle: 'ada' }));
  bins = fakeBins({ copilot: FAKE_AGENT, open: RECORD, 'xdg-open': RECORD, cmd: RECORD });
  mod = await import('../src/main');
});
afterAll(() => {
  bins.restore();
  fs.rmSync(home, { recursive: true, force: true });
});

const running = (r: { exit: number } | Running): Running => {
  if ('exit' in r) throw new Error('expected a running bridge, got exit ' + r.exit);
  return r;
};

describe('command line', () => {
  it('prints help, and refuses a bad port', async () => {
    expect(await mod.main(['--help'], uiDir)).toEqual({ exit: 0 });
    expect(await mod.main(['-h'], uiDir)).toEqual({ exit: 0 });
    for (const argv of [['--port'], ['--port', 'x'], ['--port', '70000'], ['--port', '-1']]) expect(await mod.main(argv, uiDir)).toEqual({ exit: 2 });
  });
});

describe('starting the bridge', () => {
  it('starts on the default port, or points at the bridge already there', async () => {
    const r = await mod.main(['--no-open'], uiDir);
    if (!('exit' in r)) await r.stop(); // nothing else on 7717 here
  });

  it('starts without a linked identity, then follows what workspaces and agents do', async () => {
    const id = path.join(must(process.env.YURT_HOME, 'YURT_HOME'), 'identity.json');
    const saved = fs.readFileSync(id, 'utf8');
    fs.rmSync(id);
    const unlinked = running(await mod.main(['--no-open', '--port', '0'], uiDir));
    expect(unlinked.workspaces.me).toBeNull();
    await unlinked.stop();
    fs.writeFileSync(id, saved);
    const b = running(await mod.main(['--no-open', '--port', '0'], uiDir));
    b.workspaces.join('MAINWSPC', 'Main', null, [], newNostrTransport(['ws://127.0.0.1:9']));
    const peer = must(b.workspaces.peers.get('MAINWSPC'), 'peer');
    b.workspaces.host.onEvents(peer, []);
    await b.stop();
    b.workspaces.leave('MAINWSPC');
  });

  it('serves the setup page, links the saved identity and checks installed CLIs', async () => {
    const b = running(await mod.main(['--no-open', '--port', '0'], uiDir));
    try {
      const res = await fetch(`http://127.0.0.1:${b.server.boundPort}/`);
      expect(await res.text()).toContain('setup page');
      expect(b.workspaces.me).toBe(keyFromPhrase(phrase).pub);
    } finally {
      await b.stop();
    }
    expect(bins.record('open')).toBe('');
  });

  it('opens the setup page in the default browser on each platform', async () => {
    for (const [platform, tool] of [
      ['darwin', 'open'],
      ['linux', 'xdg-open'],
      ['win32', 'cmd'],
    ] as const) {
      const b = running(await mod.main(['--port', '0'], uiDir, platform));
      const url = `http://127.0.0.1:${b.server.boundPort}/`;
      await until(() => bins.record(tool).includes(url));
      await b.stop();
    }
    expect(bins.record('cmd')).toMatch(/^\/c start {2}http:\/\/127\.0\.0\.1:\d+\/\n$/m);
  });

  it("says where to open it when there's no browser to launch", async () => {
    const { onLog } = await import('../src/log');
    const lines: string[] = [];
    const off = onLog((e) => lines.push(e.msg));
    const prev = process.env.PATH;
    process.env.PATH = tempDir('yurt-empty-'); // no xdg-open
    const b = running(await mod.main(['--port', '0'], uiDir, 'linux'));
    process.env.PATH = prev;
    await until(() => lines.some((l) => l.startsWith("couldn't open a browser")));
    off();
    await b.stop();
  });

  it('points at the bridge that is already running instead of starting a second one', async () => {
    const first = running(await mod.main(['--no-open', '--port', '0'], uiDir));
    const port = String(first.server.boundPort);
    try {
      expect(await mod.main(['--no-open', '--port', port], uiDir)).toEqual({ exit: 0 });
      expect(await mod.main(['--port', port], uiDir, 'darwin')).toEqual({ exit: 0 });
      await until(() => bins.record('open').includes(`http://127.0.0.1:${port}/`));
    } finally {
      await first.stop();
    }
  });
});

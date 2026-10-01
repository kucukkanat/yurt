import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newRecoveryPhrase } from '@yurt/protocol';

export const FAKE_ACP = fileURLToPath(new URL('./fixtures/fake-acp.mjs', import.meta.url));

export const tempDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Puts a `copilot` executable that runs the fake ACP agent first on PATH; returns a restore function. */
export function fakeCopilotOnPath(): () => void {
  const bin = tempDir('yurt-bin-');
  const exe = path.join(bin, 'copilot');
  fs.writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_ACP}" "$@"\n`, { mode: 0o755 });
  const prev = process.env.PATH;
  process.env.PATH = bin + path.delimiter + prev;
  return () => {
    process.env.PATH = prev;
    fs.rmSync(bin, { recursive: true, force: true });
  };
}

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export { memStore, until } from '../../protocol/test/util';

/**
 * A headless bridge (config, workspace peers and agent host, wired as cli.ts does) homed in `home`.
 * config.ts reads YURT_HOME on import, so modules load only after it's set; `prepare` edits the config before any peer starts.
 */
export async function startBridge(home: string, prepare: (cfg: import('../src/config').Config) => void = () => {}) {
  process.env.YURT_HOME = home;
  const [{ loadConfig }, { Workspaces }, { AgentHost }] = await Promise.all([import('../src/config'), import('../src/workspaces'), import('../src/agents')]);
  const cfg = loadConfig();
  prepare(cfg);
  const ws = new Workspaces(cfg, () => {});
  ws.host = new AgentHost(
    cfg,
    () => ws.me,
    () => {},
    () => {},
  );
  ws.setIdentity(newRecoveryPhrase());
  return { cfg, ws };
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_ACP = fileURLToPath(new URL('./fixtures/fake-acp.mjs', import.meta.url));

export const tempDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Puts a `copilot` executable that runs the fake ACP agent first on PATH; returns a restore function. */
export function fakeCopilotOnPath(): () => void {
  const bin = tempDir('yurt-bin-');
  const exe = path.join(bin, 'copilot');
  fs.writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_ACP}" "$@"\n`, { mode: 0o755 });
  const prev = process.env.PATH;
  process.env.PATH = bin + path.delimiter + prev;
  return () => { process.env.PATH = prev; fs.rmSync(bin, { recursive: true, force: true }); };
}

export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

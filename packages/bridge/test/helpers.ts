import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspacePeer, newRecoveryPhrase, type KeyPair, type Msg, type WorkspacePeerOpts, type WsTransport } from '@yurt/protocol';
import { memStore as memoryStore, until as waitUntil } from '../../protocol/test/util';

export const FAKE_ACP = fileURLToPath(new URL('./fixtures/fake-acp.mjs', import.meta.url));

export const tempDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** A shell line that runs the fake ACP agent (test/fixtures/fake-acp.mjs) with this Node. */
export const FAKE_AGENT = `exec "${process.execPath}" "${FAKE_ACP}" "$@"`;

/**
 * Real executables standing in for system tools (npm, osascript, terminals…): each is a `/bin/sh` script with the given
 * body. PATH becomes their folder, then the current PATH (`keep: 'all'`), only /usr/bin and /bin (`'system'`, where
 * `which` lives), or nothing else (`'none'`). `record(name)` reads what an `echo "$@" >> log` body logged.
 */
export function fakeBins(bins: Record<string, string>, keep: 'all' | 'system' | 'none' = 'system') {
  const dir = tempDir('yurt-bin-');
  for (const [name, body] of Object.entries(bins)) fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const prev = process.env.PATH;
  const rest = keep === 'all' ? [prev] : keep === 'system' ? ['/usr/bin', '/bin'] : [];
  process.env.PATH = [dir, ...rest].join(path.delimiter);
  return {
    dir,
    log: (name: string) => path.join(dir, name + '.log'),
    record: (name: string) => (fs.existsSync(path.join(dir, name + '.log')) ? fs.readFileSync(path.join(dir, name + '.log'), 'utf8') : ''),
    restore: () => {
      process.env.PATH = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Puts a `copilot` executable that runs the fake ACP agent first on PATH; returns a restore function. */
export function fakeCopilotOnPath(): () => void {
  return fakeBins({ copilot: FAKE_AGENT }, 'all').restore;
}

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export { until } from '../../protocol/test/util';

export interface BridgeOpts {
  /** Edits the config before any peer starts. */
  prepare?: (cfg: import('../src/config').Config) => void;
  /** The owner's identity (default: a fresh one). */
  phrase?: string;
  devFileServers?: boolean;
  timing?: import('../src/agents').HostTiming;
  /** Replaces the agent host's presence callback (default: the workspaces' own, as in cli.ts). */
  presence?: (code: string) => void;
}

/**
 * A headless bridge (config, workspace peers and agent host, wired as main.ts does) homed in `home`.
 * config.ts reads YURT_HOME on import, so modules load only after it's set.
 */
export async function startBridge(home: string, opts: BridgeOpts = {}) {
  process.env.YURT_HOME = home;
  const [{ loadConfig }, { Workspaces }, { AgentHost }] = await Promise.all([import('../src/config'), import('../src/workspaces'), import('../src/agents')]);
  const cfg = loadConfig();
  opts.prepare?.(cfg);
  const ws = new Workspaces(cfg, () => {}, { devFileServers: opts.devFileServers ?? false });
  ws.host = new AgentHost(
    cfg,
    () => ws.me,
    () => {},
    opts.presence ?? ((code) => ws.presence(code)),
    opts.timing,
  );
  ws.setIdentity(opts.phrase ?? newRecoveryPhrase());
  return { cfg, ws };
}

/** A member's device: a real WorkspacePeer with an in-memory store, started and connected. */
export async function memberPeer(kp: KeyPair, code: string, transport: WsTransport, extra: Partial<WorkspacePeerOpts> = {}) {
  const p = new WorkspacePeer({ code, kp, selfId: kp.pub.slice(0, 20), transport, store: memoryStore().store, onError: () => {}, ...extra });
  await p.start();
  await waitUntil(() => p.connected, 8000);
  return p;
}

/** `agent`'s answers in a channel, as `p` sees them (approval requests aren't answers). */
export const answersOf = (p: WorkspacePeer, agent: string, ch: string) => [...p.state.msgs.values()].filter((m) => m.ag === agent && m.ch === ch && !m.approval);

/** Sends a message and waits for `agent`'s next answer in that channel (answers are queued, so earlier triggers answer first). */
export async function askAgent(p: WorkspacePeer, agent: string, ch: string, text: string, extra: { to?: string; parent?: string; files?: Msg['files'] } = {}) {
  const before = answersOf(p, agent, ch).length;
  const trigger = p.publish({
    t: 'msg',
    ch,
    ...(extra.to ? { to: extra.to } : {}),
    b: { text, ...(extra.parent ? { parent: extra.parent } : {}), ...(extra.files ? { files: extra.files } : {}) },
  });
  await waitUntil(() => answersOf(p, agent, ch).length > before, 20_000);
  const answers = answersOf(p, agent, ch).slice(before);
  return { trigger, answer: must(answers[0], 'an answer'), answers };
}

/** Snapshots environment variables; the returned function puts them back (unsetting those that were unset). */
export function saveEnv(...keys: string[]) {
  const saved = keys.map((k) => [k, process.env[k]] as const);
  return () => {
    // Assigning undefined to process.env stores the string "undefined", so unset what wasn't set.
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

/** The value, or a test failure naming what was missing (strict index access makes "surely there" explicit). */
export function must<T>(x: T | undefined | null, what = 'value'): T {
  if (x === undefined || x === null) throw new Error('missing ' + what);
  return x;
}

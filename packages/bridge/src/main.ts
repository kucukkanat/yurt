import os from 'node:os';
import { spawn } from 'node:child_process';
import { BRIDGE_PORT } from '@yurt/protocol';
import { loadConfig, loadIdentity, HOME } from './config';
import { Workspaces } from './workspaces';
import { AgentHost } from './agents';
import { BridgeServer } from './server';
import { VERSION } from './version';
import { detectAll, check, runtimeStatus } from './runtimes';
import { log } from './log';
import { writeProxy } from './mcp';

/** A bridge that is up: its server and workspaces, and how to stop both. */
export interface Running {
  server: BridgeServer;
  workspaces: Workspaces;
  stop(): Promise<void>;
}

const HELP = `yurt-bridge ${VERSION}\n\nConnects Yurt to agent CLIs on this machine.\n\n  --no-open    don't open the setup page\n  --port N     listen on N (default ${BRIDGE_PORT}; the web app expects ${BRIDGE_PORT})\n\nData lives in ${HOME}`;

/** How each platform opens a URL in the default browser. */
const OPENER: Partial<Record<NodeJS.Platform, (u: string) => [string, string[]]>> = {
  darwin: (u) => ['open', [u]],
  win32: (u) => ['cmd', ['/c', 'start', '', u]],
};

export function openUrl(u: string, platform: NodeJS.Platform) {
  const [cmd, args] = (OPENER[platform] ?? ((x: string) => ['xdg-open', [x]]))(u);
  // Headless boxes lack xdg-open: spawn reports ENOENT as an 'error' event, which would crash if unhandled.
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
  p.on('error', (e) => log('warn', 'bridge', `couldn't open a browser (${e.message}); open ${u} yourself`));
  p.unref();
}

/**
 * Starts the bridge from command-line arguments. Returns an exit code when it shouldn't keep running
 * (help, a bad port, or another bridge already on the port), otherwise the running bridge.
 */
export async function main(argv: string[], uiDir: string, platform: NodeJS.Platform = process.platform): Promise<{ exit: number } | Running> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return { exit: 0 };
  }
  const portAt = argv.indexOf('--port');
  const port = portAt < 0 ? BRIDGE_PORT : Number(argv[portAt + 1]); // 0 picks a free port (tests)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('--port needs a number from 0 to 65535');
    return { exit: 2 };
  }
  const noOpen = argv.includes('--no-open');

  const cfg = loadConfig();
  const changed = () => server.changed();
  const workspaces = new Workspaces(cfg, changed);
  const host = new AgentHost(cfg, () => workspaces.me, changed, workspaces.presence.bind(workspaces));
  workspaces.host = host;
  const server = new BridgeServer(port, cfg, workspaces, host, uiDir);

  try {
    await server.listen();
  } catch (e) {
    await server.close();
    // listen() rejects with a Node system error. Others (EACCES on a privileged Linux port, no loopback) can't be
    // produced on a developer machine, so that line is the one excluded from coverage.
    /* istanbul ignore if -- environment-specific listen failures */
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    console.log(`\n  Yurt bridge is already running on port ${port}. Open http://127.0.0.1:${port}\n`);
    if (!noOpen) openUrl(`http://127.0.0.1:${port}/`, platform);
    return { exit: 0 };
  }

  host.mcp = { url: `http://127.0.0.1:${server.boundPort}/mcp`, proxy: writeProxy(HOME) };

  const id = loadIdentity();
  if (id) workspaces.setIdentity(id.phrase);

  detectAll();
  const checks = (async () => {
    for (const r of runtimeStatus()) if (r.installed) await check(r.id);
  })();

  const url = `http://127.0.0.1:${server.boundPort}/`;
  const c = server.pairingCode;
  console.log(`
  yurt bridge ${VERSION}
  Setup      ${url}
  Pair code  ${c.slice(0, 3)} ${c.slice(3)}   (enter it in Yurt → Settings → Agents & bridge)
  Data       ${HOME.replace(os.homedir(), '~')}
`);
  log('info', 'bridge', 'listening on 127.0.0.1:' + server.boundPort);
  if (!noOpen) openUrl(url, platform);

  return {
    server,
    workspaces,
    async stop() {
      await checks;
      for (const p of workspaces.peers.values()) p.leave();
      await server.close();
    },
  };
}

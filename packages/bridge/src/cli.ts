import './polyfill';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BRIDGE_PORT } from '@yurt/protocol';
import { loadConfig, loadIdentity, HOME } from './config';
import { Workspaces } from './workspaces';
import { AgentHost } from './agents';
import { BridgeServer } from './server';
import { VERSION } from './version';
import { detectAll, check, runtimeStatus } from './runtimes';
import { log } from './log';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    `yurt-bridge ${VERSION}\n\nConnects Yurt to agent CLIs on this machine.\n\n  --no-open    don't open the setup page\n  --port N     listen on N (default ${BRIDGE_PORT}; the web app expects ${BRIDGE_PORT})\n\nData lives in ${HOME}`,
  );
  process.exit(0);
}
const portAt = argv.indexOf('--port');
const port = portAt < 0 ? BRIDGE_PORT : Number(argv[portAt + 1]); // 0 picks a free port (tests)
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('--port needs a number from 0 to 65535');
  process.exit(2);
}
const noOpen = argv.includes('--no-open');

const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = [path.join(here, 'ui'), path.join(here, '..', 'dist', 'ui')].find((d) => fs.existsSync(path.join(d, 'index.html'))) || path.join(here, 'ui');

const cfg = loadConfig();
let server: BridgeServer | null = null;
const changed = () => server?.changed();
const workspaces = new Workspaces(cfg, changed);
const host = new AgentHost(
  cfg,
  () => workspaces.me,
  changed,
  (code) => workspaces.presence(code),
);
workspaces.host = host;
server = new BridgeServer(port, cfg, workspaces, host, path.resolve(uiDir));

try {
  await server.listen();
} catch (e: any) {
  if (e?.code === 'EADDRINUSE') {
    console.log(`\n  Yurt bridge is already running on port ${port}. Open http://127.0.0.1:${port}\n`);
    if (!noOpen) openUrl(`http://127.0.0.1:${port}/`);
    process.exit(0);
  }
  throw e;
}

const id = loadIdentity();
if (id) workspaces.setIdentity(id.phrase);

detectAll();
(async () => {
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
if (!noOpen) openUrl(url);

function openUrl(u: string) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [u]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', u]] : ['xdg-open', [u]];
  // Headless boxes lack xdg-open: spawn reports ENOENT as an 'error' event, which would crash if unhandled.
  const p = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
  p.on('error', (e) => log('warn', 'bridge', `couldn't open a browser (${e.message}); open ${u} yourself`));
  p.unref();
}

const bye = () => {
  for (const p of workspaces.peers.values()) p.leave();
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);

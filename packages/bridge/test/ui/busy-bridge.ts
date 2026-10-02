// A bridge in the middle of things, for the bridge page's browser tests. Run by global-setup.ts as its own process
// (own HOME, PATH and YURT_HOME): agents working, waiting and failing, CLIs in every state, two workspaces.
// Prints `READY {url, admin, web}` once the page has something to show.
import '../../src/polyfill';
import fs from 'node:fs';
import path from 'node:path';
import { WorkspacePeer, keyFromPhrase, newNostrTransport, newRecoveryPhrase, type AgentConfig } from '@yurt/protocol';
import { startRelay } from '../../../protocol/test/relay';
import { memStore, until } from '../../../protocol/test/util';
import { loadConfig, saveIdentity } from '../../src/config';
import { Workspaces } from '../../src/workspaces';
import { AgentHost } from '../../src/agents';
import { BridgeServer } from '../../src/server';
import { check, detectAll, runtimeStatus } from '../../src/runtimes';
import { PAGE_ORIGINS } from './fixtures';

const root = String(process.env.YURT_HOME);
const agent = (id: string, name: string, mode: string, p: Partial<AgentConfig> = {}): AgentConfig => {
  const workdir = path.join(root, 'agents', id);
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, '.fake-mode'), mode);
  return {
    id,
    name,
    handle: id,
    runtime: 'copilot',
    workdir,
    instructions: '',
    autoApprove: ['read'],
    contextSize: 20,
    respondTo: { mentions: true, replies: false },
    postIn: { thread: true, channel: false },
    discoverable: false,
    online: true,
    ...p,
  };
};

const phrase = newRecoveryPhrase();
const cfg = loadConfig(); // creates the data folder
saveIdentity({ phrase, name: 'Olu', handle: 'olu' });
cfg.adminToken = 'busy-admin';
cfg.tokens = ['busy-web'];
cfg.allowedOrigins = PAGE_ORIGINS;
cfg.agents.push(
  agent('harper', 'Harper', 'hang'),
  agent('gatekeeper', 'Gatekeeper', 'ok', { autoApprove: [] }),
  agent('locksmith', 'Locksmith', 'auth-fail'),
  agent('idler', 'Idler', 'echo', { model: 'gpt-x' }),
  agent('lonely', 'Lonely', 'echo'),
);
const relay = await startRelay();
const transport = newNostrTransport([relay.url]);
const ws = new Workspaces(cfg, () => server.changed());
const host = new AgentHost(
  cfg,
  () => ws.me,
  () => server.changed(),
  ws.presence.bind(ws),
);
ws.host = host;
const server = new BridgeServer(0, cfg, ws, host, path.join(root, 'ui'));
await server.listen();
ws.setIdentity(phrase);

const B = keyFromPhrase(newRecoveryPhrase());
const b = new WorkspacePeer({ code: 'BUSYWSPC', kp: B, transport, store: memStore().store, onError: () => {} });
await b.start();
b.publish({ t: 'ws.create', b: { name: 'Busy' } });
b.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
ws.join('BUSYWSPC', 'Busy', B.pub, ['harper', 'gatekeeper', 'locksmith', 'idler'], transport);
ws.join('SPAREWSP', 'Spare', null, ['idler'], newNostrTransport(['ws://127.0.0.1:9']));
await until(() => b.state.agents.size === 4, 20_000);
b.publish({ t: 'msg', ch: 'general', b: { text: '@harper @gatekeeper @locksmith hello' } });
await until(() => host.status.get('harper') === 'working' && host.status.get('gatekeeper') === 'waiting' && host.status.get('locksmith') === 'error', 30_000);

detectAll();
for (const r of runtimeStatus()) if (r.installed) await check(r.id);
console.log('READY ' + JSON.stringify({ url: `ws://127.0.0.1:${server.boundPort}/ws`, admin: 'busy-admin', web: 'busy-web' }));

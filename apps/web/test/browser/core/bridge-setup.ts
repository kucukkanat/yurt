// Node 22's built-in WebSocket recurses when nostr-tools closes a failed socket; use the browser-like `ws` (see AGENTS.md).
import '@yurt/protocol/node-ws';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
import { newRecoveryPhrase } from '@yurt/protocol';
import { TEST_BRIDGE, type TestBridge } from './commands';

declare module 'vitest' {
  export interface ProvidedContext {
    bridgeUrl: string;
    /** A WebSocket server that isn't a bridge: another program listening where the app looks for one. */
    foreignWsUrl: string;
  }
}

interface WsServer {
  on(e: 'connection', f: (sock: { on(e: 'message', f: () => void): void; send(d: string | Uint8Array): void }) => void): void;
  on(e: 'listening', f: () => void): void;
  address(): { port: number };
  close(f: () => void): void;
}

/**
 * A real yurt-bridge server (pairing, identity, workspaces, agents host) on a random port, homed in a temp folder,
 * so the web app's bridge client is tested against the actual protocol and never touches the user's own bridge.
 */
export default async function setup(project: TestProject) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yurt-web-bridge-'));
  const uiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yurt-web-bridge-ui-'));
  fs.writeFileSync(path.join(uiDir, 'index.html'), '<html><body>bridge</body></html>');
  // config.ts reads YURT_HOME on import, so the bridge modules load only after it's set.
  process.env.YURT_HOME = home;
  await import('@yurt/protocol/node-ws');
  const [{ loadConfig }, { Workspaces }, { AgentHost }, { BridgeServer }] = await Promise.all([
    import('../../../../../packages/bridge/src/config'),
    import('../../../../../packages/bridge/src/workspaces'),
    import('../../../../../packages/bridge/src/agents'),
    import('../../../../../packages/bridge/src/server'),
  ]);
  const cfg = loadConfig();
  cfg.allowedOrigins = [];
  const ws = new Workspaces(cfg, () => {});
  const host = new AgentHost(
    cfg,
    () => ws.me,
    () => {},
    () => {},
  );
  ws.host = host;
  ws.setIdentity(newRecoveryPhrase());
  const server = new BridgeServer(0, cfg, ws, host, uiDir);
  await server.listen();
  const bridge: TestBridge = {
    pairingCode: () => server.pairingCode,
    allowOrigin: (origin) => {
      if (!cfg.allowedOrigins.includes(origin)) cfg.allowedOrigins.push(origin);
    },
  };
  (globalThis as Record<symbol, unknown>)[TEST_BRIDGE] = bridge;
  project.provide('bridgeUrl', `ws://127.0.0.1:${server.boundPort}/ws`);
  // The bridge's own `ws` dependency (the web app has none): answers anything with frames no bridge would send.
  const { WebSocketServer } = createRequire(new URL('../../../../../packages/bridge/package.json', import.meta.url))('ws') as {
    WebSocketServer: new (o: { host: string; port: number }) => WsServer;
  };
  const foreign = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((res) => foreign.on('listening', res));
  foreign.on('connection', (sock) =>
    sock.on('message', () => {
      sock.send('["NOTICE","unknown command"]');
      sock.send('{"t":"teleport"}');
      sock.send(new Uint8Array([1, 2, 3]));
    }),
  );
  project.provide('foreignWsUrl', `ws://127.0.0.1:${foreign.address().port}`);
  return async () => {
    for (const p of ws.peers.values()) p.leave();
    await server.close();
    await new Promise<void>((res) => foreign.close(() => res()));
    for (const d of [home, uiDir]) fs.rmSync(d, { recursive: true, force: true });
  };
}

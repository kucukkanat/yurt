import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { newNostrTransport, newTrysteroTransport } from '@yurt/protocol';
import type { Workspaces } from '../src/workspaces';
import type { Config } from '../src/config';
import { startBridge, tempDir, until } from './helpers';

// config.ts reads YURT_HOME on import. The relay is a closed local port: nothing leaves the machine.
const home = tempDir('yurt-ws-');
let ws: Workspaces;
let cfg: Config;
beforeAll(async () => {
  ({ cfg, ws } = await startBridge(home));
});
afterAll(() => {
  for (const p of ws.peers.values()) p.leave();
  fs.rmSync(home, { recursive: true, force: true });
});

const transport = newNostrTransport(['ws://127.0.0.1:9']);

describe('Workspaces leave/rejoin', () => {
  it('stops the peer shortly after leaving', async () => {
    ws.join('AAAABBBB', 'Left', null, [], transport);
    expect(ws.peers.has('AAAABBBB')).toBe(true);
    ws.leave('AAAABBBB');
    await until(() => !ws.peers.has('AAAABBBB'), 3000);
  });

  it('keeps the workspace running when rejoined before the delayed stop fires', async () => {
    ws.join('CCCCDDDD', 'Back', null, [], transport);
    const first = ws.peers.get('CCCCDDDD');
    ws.leave('CCCCDDDD');
    ws.join('CCCCDDDD', 'Back', null, [], transport);
    await new Promise((r) => setTimeout(r, 1800)); // past the 1.5 s stop
    expect(ws.peers.get('CCCCDDDD')).toBe(first);
  });
});

describe('Workspaces ws.join updates', () => {
  const record = (code: string) => cfg.workspaces.find((w) => w.code === code);

  it('moves a relay workspace to edited relays on a fresh peer, keeping kind and key', () => {
    ws.join('EEEEFFFF', 'Relays', null, [], transport);
    const before = ws.peers.get('EEEEFFFF');
    const edited = { ...transport, relays: ['ws://127.0.0.1:10'] };
    ws.join('EEEEFFFF', 'Relays', null, [], edited);
    expect(record('EEEEFFFF')?.transport).toEqual(edited);
    expect(ws.peers.get('EEEEFFFF')).not.toBe(before);
    expect(ws.peers.has('EEEEFFFF')).toBe(true);
  });

  it('moves a peer-to-peer workspace to edited signaling, and leaves an unchanged one alone', () => {
    // Closed local ports: the peers never reach the network.
    const p2p = newTrysteroTransport({ kind: 'nostr', urls: ['ws://127.0.0.1:9'] });
    ws.join('GGGGHHHH', 'P2P', null, [], p2p);
    const first = ws.peers.get('GGGGHHHH');
    ws.join('GGGGHHHH', 'P2P', null, [], p2p);
    expect(ws.peers.get('GGGGHHHH')).toBe(first);
    // A workspace first joined without signaling (Trystero's defaults) must follow the app's later setting.
    const trackers = { ...p2p, signal: { kind: 'torrent' as const, urls: ['ws://127.0.0.1:10'] } };
    ws.join('GGGGHHHH', 'P2P', null, [], trackers);
    expect(cfg.workspaces.find((w) => w.code === 'GGGGHHHH')?.transport).toEqual(trackers);
    expect(ws.peers.get('GGGGHHHH')).not.toBe(first);
  });

  it('never changes the key or kind, and leaves the peer alone', () => {
    const peer = ws.peers.get('EEEEFFFF');
    const saved = record('EEEEFFFF')?.transport;
    ws.join('EEEEFFFF', 'Relays', null, [], newNostrTransport(['ws://127.0.0.1:11']));
    ws.join('EEEEFFFF', 'Relays', null, [], { kind: 'trystero', key: 'k' });
    expect(record('EEEEFFFF')?.transport).toEqual(saved);
    expect(ws.peers.get('EEEEFFFF')).toBe(peer);
  });

  it('takes the creator from ws.join only when none is known', () => {
    const [a, b] = ['a'.repeat(64), 'b'.repeat(64)];
    ws.join('GGGGHHHH', 'Creator', null, [], transport);
    ws.join('GGGGHHHH', 'Creator', a, [], transport);
    ws.join('GGGGHHHH', 'Creator', b, [], transport);
    expect(record('GGGGHHHH')?.creator).toBe(a);
  });
});

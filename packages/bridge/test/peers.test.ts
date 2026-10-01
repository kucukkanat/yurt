import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { selfId as bridgeSelfId } from 'trystero';
import { RTCPeerConnection } from 'werift';
import {
  type WorkspacePeer,
  agentKey,
  keyFromPhrase,
  newNostrTransport,
  newRecoveryPhrase,
  newTrysteroTransport,
  workspaceKeys,
  type AgentConfig,
  type JoinRoom,
  type KeyPair,
  type KeyedTransport,
  type TRoom,
} from '@yurt/protocol';
import { startRelay, type TestRelay } from '../../protocol/test/relay';
import type { Config } from '../src/config';
import type { Workspaces } from '../src/workspaces';
import { onLog } from '../src/log';
import { memberPeer, must, startBridge, tempDir, until } from './helpers';

// The bridge's own workspace peers (Workspaces) against a local relay, with members as real WorkspacePeers.
const OWNER_PHRASE = newRecoveryPhrase();
const OWNER = keyFromPhrase(OWNER_PHRASE);
const B = keyFromPhrase(newRecoveryPhrase());
const home = tempDir('yurt-peers-');
const agent: AgentConfig = {
  id: 'scout',
  name: 'Scout',
  handle: 'scout',
  runtime: 'copilot',
  workdir: path.join(home, 'scout'),
  instructions: '',
  autoApprove: [],
  contextSize: 20,
  respondTo: { mentions: true, replies: false },
  postIn: { thread: true, channel: false },
  discoverable: false,
  online: true,
};

let relay: TestRelay;
let transport: KeyedTransport;
let cfg: Config;
let ws: Workspaces;
let mods: { workspaces: typeof import('../src/workspaces'); config: typeof import('../src/config') };
const peers: WorkspacePeer[] = [];
const lines: string[] = [];
let offLog: () => void;

async function member(kp: KeyPair, code: string) {
  const p = await memberPeer(kp, code, transport);
  peers.push(p);
  return p;
}
const record = (code: string) =>
  must(
    cfg.workspaces.find((w) => w.code === code),
    'workspace ' + code,
  );

beforeAll(async () => {
  offLog = onLog((e) => lines.push(`${e.level} ${e.src}: ${e.msg}`));
  relay = await startRelay();
  transport = newNostrTransport([relay.url]);
  ({ cfg, ws } = await startBridge(home, { phrase: OWNER_PHRASE, prepare: (c) => c.agents.push(agent) }));
  mods = { workspaces: await import('../src/workspaces'), config: await import('../src/config') };
}, 30_000);
afterAll(async () => {
  offLog();
  for (const p of [...ws.peers.values(), ...peers]) p.leave();
  await relay.close();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('following a workspace', () => {
  it('learns its name and creator, and adopts a rotated key', async () => {
    const b = await member(B, 'FOLLOWWS');
    b.publish({ t: 'ws.create', b: { name: 'Renamed' } });
    ws.join('FOLLOWWS', 'Old name', null, ['scout'], transport);
    await until(() => record('FOLLOWWS').name === 'Renamed' && record('FOLLOWWS').creator === B.pub, 10_000);
    // A rotation seals the new key for members with a profile: the owner's browser published it, under the
    // same key the bridge uses.
    (await member(OWNER, 'FOLLOWWS')).publish({ t: 'profile', b: { name: 'Olu', handle: 'olu' } });
    await until(() => b.state.profiles.has(OWNER.pub), 10_000);
    const before = record('FOLLOWWS').transport.key;
    b.rotate();
    await until(() => record('FOLLOWWS').transport.key !== before, 10_000);
    expect(b.state.agents.has(agentKey(OWNER.pub, 'scout'))).toBe(true);
    expect(mods.config.loadConfig().workspaces.find((w) => w.code === 'FOLLOWWS')?.transport.key).toBe(record('FOLLOWWS').transport.key);
  }, 30_000);

  it('keeps announcements in step with its config', async () => {
    const b = await member(B, 'ANNOUNCE');
    b.publish({ t: 'ws.create', b: { name: 'Announce' } });
    // Another member's agent shares the id: it's theirs, the bridge leaves it alone.
    b.publish({ t: 'agent', b: { id: 'scout', name: 'Their scout', handle: 'theirs', runtime: 'copilot', replyIn: 'thread' } });
    ws.join('ANNOUNCE', 'Announce', B.pub, ['scout'], transport);
    const mine = () => b.state.agents.get(agentKey(OWNER.pub, 'scout'));
    await until(() => mine()?.name === 'Scout', 10_000);
    cfg.agents[0] = { ...agent, model: 'gpt-x' };
    ws.refreshAll();
    await until(() => mine()?.model === 'gpt-x', 10_000);
    ws.join('ANNOUNCE', 'Announce', B.pub, [], transport); // taken out of the workspace
    await until(() => mine()?.removed === true, 10_000);
    ws.join('ANNOUNCE', 'Announce', B.pub, ['scout'], transport);
    await until(() => mine()?.removed !== true, 10_000);
    cfg.agents.splice(0, 1); // deleted from the bridge altogether
    ws.refreshAll();
    await until(() => mine()?.removed === true, 10_000);
    expect(b.state.agents.get(agentKey(B.pub, 'scout'))?.removed).toBeUndefined();
    cfg.agents.push(agent);
    b.setPresence({ st: 'online' });
    await until(() => ws.peerCount('ANNOUNCE') > 0, 10_000);
    expect(ws.peerCount('NOTJOINED')).toBe(0);
  }, 40_000);
});

describe('storage on disk', () => {
  it('reloads a workspace log after a restart, skipping a torn line', async () => {
    const b = await member(B, 'RELOADWS');
    b.publish({ t: 'ws.create', b: { name: 'Reload' } });
    b.publish({ t: 'ch.create', b: { id: 'general', name: 'general' } });
    ws.join('RELOADWS', 'Reload', B.pub, [], transport);
    await until(() => must(ws.peers.get('RELOADWS'), 'peer').state.channels.has('general'), 10_000);
    const log = path.join(mods.config.WS_DIR, 'RELOADWS.jsonl');
    await until(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length >= 2);
    fs.appendFileSync(log, '{"not": "an event"}\n{"id": "torn');
    const store = mods.workspaces.storeFor('RELOADWS');
    const evs = await store.load('RELOADWS');
    expect(evs.map((e) => e.t)).toEqual(expect.arrayContaining(['ws.create', 'ch.create']));
    expect(await mods.workspaces.storeFor('NEVERWAS').load('NEVERWAS')).toEqual([]);
  }, 30_000);

  it('keeps file blobs and the sync mark, reading anything odd as nothing', async () => {
    const store = mods.workspaces.storeFor('MARKSWSP');
    expect(await store.getBlob?.('nope')).toBeNull();
    await store.putBlob?.('blob1', new TextEncoder().encode('bytes').buffer as ArrayBuffer);
    expect(new TextDecoder().decode(must(await store.getBlob?.('blob1'), 'blob'))).toBe('bytes');
    expect(await store.loadMark?.('MARKSWSP')).toBe(0);
    await store.saveMark?.('MARKSWSP', 1234);
    expect(await store.loadMark?.('MARKSWSP')).toBe(1234);
    fs.writeFileSync(path.join(mods.config.WS_DIR, 'MARKSWSP.mark'), 'garbage');
    expect(await store.loadMark?.('MARKSWSP')).toBe(0);
  });

  it("reports a workspace that can't load, or can't save", async () => {
    fs.mkdirSync(path.join(mods.config.WS_DIR, 'BADLOADS.jsonl'));
    ws.join('BADLOADS', 'Bad load', null, [], transport);
    await until(() => lines.some((l) => l.startsWith("error p2p: couldn't start workspace BADLOADS")), 10_000);
    // A log file that points nowhere: nothing to load, and every save fails.
    fs.symlinkSync(path.join(home, 'missing-dir', 'log'), path.join(mods.config.WS_DIR, 'BADSAVES.jsonl'));
    const b = await member(B, 'BADSAVES');
    b.publish({ t: 'ws.create', b: { name: 'Bad save' } });
    ws.join('BADSAVES', 'Bad save', B.pub, [], transport);
    await until(() => lines.some((l) => l.startsWith('error relay: BADSAVES:')), 10_000);
    ws.leave('BADLOADS');
    ws.leave('BADSAVES');
  }, 30_000);
});

describe('joining and leaving', () => {
  it('treats an older app without transports as legacy, and upgrades it when a keyed one arrives', () => {
    // No identity on this one: nothing joins any network.
    const bare = new mods.workspaces.Workspaces(cfg, () => {});
    bare.join('LEGACYWS', 'Legacy', null, []);
    expect(record('LEGACYWS').transport).toEqual({ kind: 'trystero' });
    expect(bare.me).toBeNull();
    const keyed = newTrysteroTransport({ kind: 'nostr', urls: ['ws://127.0.0.1:9'] });
    bare.join('LEGACYWS', 'Legacy', null, [], keyed);
    expect(record('LEGACYWS').transport).toEqual(keyed);
    bare.leave('LEGACYWS');
    bare.leave('NEVERWAS'); // leaving what was never joined is harmless
    bare.presence('NEVERWAS');
  });

  it('stops every peer when the identity goes, and ignores a repeated identity', async () => {
    ws.join('IDENTITY', 'Identity', null, [], newNostrTransport(['ws://127.0.0.1:9']));
    const peer = ws.peers.get('IDENTITY');
    ws.setIdentity(OWNER_PHRASE); // the same: nothing restarts
    expect(ws.peers.get('IDENTITY')).toBe(peer);
    ws.setIdentity(null);
    expect(ws.peers.size).toBe(0);
    ws.setIdentity(OWNER_PHRASE);
    await until(() => ws.peers.has('IDENTITY'));
    ws.leave('IDENTITY');
    ws.presence('IDENTITY'); // a leaving workspace's presence: no record, nothing to say
  });
});

describe('peer-to-peer workspaces', () => {
  const raws: TRoom[] = [];
  afterAll(() => {
    for (const r of raws) r.leave();
  });

  it('logs a member who joins its room with the wrong password', async () => {
    const t = newTrysteroTransport({ kind: 'nostr', urls: [relay.url] });
    ws.join('JOINERRS', 'Join errors', null, [], t);
    // Trystero's lower peer id makes the offer: keep making raw peers until one sorts first, so the bridge is the
    // side that receives an offer it can't decrypt.
    const k = workspaceKeys(must(t.key, 'key'));
    for (let tries = 0; ; tries++) {
      if (tries > 50) throw new Error('no raw peer id sorted before the bridge in 50 tries');
      vi.resetModules();
      const { joinRoom, selfId } = await import('trystero');
      if (selfId >= bridgeSelfId) continue;
      const config = { appId: k.app, password: 'not the room password', relayConfig: { urls: [relay.url] }, rtcPolyfill: RTCPeerConnection };
      raws.push((joinRoom as unknown as JoinRoom)(config, k.room, {}));
      break;
    }
    await until(() => lines.some((l) => l.startsWith('warn p2p: join error in JOINERRS')), 30_000);
    ws.leave('JOINERRS');
  }, 45_000);
});

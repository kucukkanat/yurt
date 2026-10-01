import { joinRoom as joinNostr, selfId } from 'trystero';
import { joinRoom as joinTorrent } from '@trystero-p2p/torrent';
import { WorkspacePeer, signalingOf, type KeyPair, type WsState, type Ev, type JoinRoom, type WsTransport } from '@yurt/protocol';
import { peerStore } from './db';
import type { NetSettings } from './stored';

export type { NetSettings } from './stored';

/** The dev server and tests run a local http file server; production only trusts https ones. */
export const isLocalHost = (hostname: string) => hostname === 'localhost' || hostname === '127.0.0.1';

// Free public TURN (Open Relay by Metered). Rate-limited; set your own in Settings → Network.
const DEFAULT_TURN = [
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

function rtcOptions(n: NetSettings): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (n.turn === 'default') o.turnConfig = DEFAULT_TURN;
  if (n.turn === 'custom' && n.turnUrls.trim()) o.turnConfig = [{ urls: n.turnUrls.split(/[\s,]+/).filter(Boolean), username: n.turnUser, credential: n.turnPass }];
  // Signaling servers aren't here: they belong to each workspace (members must share them).
  return o;
}

export interface NetHandlers {
  onState(code: string, s: WsState, fresh: Ev[]): void;
  onPeers(code: string): void;
  onCreator(code: string, pub: string): void;
  onKey(code: string, key: string): void;
  onBlob(id: string): void;
  onBlobProgress(id: string, p: number): void;
  /** A member's WebRTC handshake was refused or failed (e.g. a banned member, or someone on an old key). */
  onJoinError(code: string, details: unknown): void;
  /** Something failed that the user should know about (e.g. this device couldn't save). */
  onError(code: string, msg: string): void;
}

const peers = new Map<string, WorkspacePeer>();

export function connect(code: string, kp: KeyPair, creator: string | null, transport: WsTransport, net: NetSettings, h: NetHandlers): WorkspacePeer {
  const existing = peers.get(code);
  if (existing) return existing;
  const p = new WorkspacePeer({
    code,
    kp,
    selfId,
    creator,
    transport,
    // No mixing: a relay workspace gets no WebRTC at all unless the user opted in. The Trystero strategy
    // follows the workspace's signaling method, since members only meet over the same one.
    ...(transport.kind === 'trystero' || net.webrtc ? { joinRoom: (signalingOf(transport).kind === 'torrent' ? joinTorrent : joinNostr) as unknown as JoinRoom } : {}),
    store: peerStore,
    rtc: rtcOptions(net),
    onState: (s, fresh) => h.onState(code, s, fresh),
    onPeers: () => h.onPeers(code),
    onCreator: (pub) => h.onCreator(code, pub),
    onKey: (key) => h.onKey(code, key),
    onBlob: h.onBlob,
    onBlobProgress: h.onBlobProgress,
    onJoinError: (d) => h.onJoinError(code, d),
    onError: (msg) => h.onError(code, msg),
    devFileServers: isLocalHost(location.hostname),
  });
  peers.set(code, p);
  p.start();
  return p;
}

export const getPeer = (code?: string | null) => (code ? peers.get(code) : undefined);
export const allPeers = () => [...peers.values()];

export function disconnect(code: string) {
  peers.get(code)?.leave();
  peers.delete(code);
}

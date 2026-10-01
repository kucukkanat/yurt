import { joinRoom as joinNostr, selfId } from 'trystero';
import { joinRoom as joinTorrent } from '@trystero-p2p/torrent';
import { WorkspacePeer, signalingOf, type KeyPair, type WsState, type Ev, type JoinRoom, type WsTransport, type SignalKind } from '@yurt/protocol';
import { peerStore } from './db';

export interface NetSettings {
  turn: 'default' | 'custom' | 'off';
  turnUrls: string;
  turnUser: string;
  turnPass: string;
  /** Defaults for new relay workspaces: Nostr relays and Blossom file servers (free text, parsed when used). */
  relays: string;
  blossom: string;
  /** Relay workspaces use WebRTC (voice and video) only when this is on. Trystero workspaces always use it. */
  webrtc: boolean;
  /** Defaults for new peer-to-peer workspaces: how members find each other (empty urls = built-in servers). */
  signalKind: SignalKind;
  signalUrls: string;
}

// Free public TURN (Open Relay by Metered). Rate-limited; set your own in Settings → Network.
const DEFAULT_TURN = [{
  urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'],
  username: 'openrelayproject',
  credential: 'openrelayproject',
}];

function rtcOptions(n: NetSettings): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (n.turn === 'default') o.turnConfig = DEFAULT_TURN;
  if (n.turn === 'custom' && n.turnUrls.trim()) o.turnConfig = [{ urls: n.turnUrls.split(/[\s,]+/).filter(Boolean), username: n.turnUser, credential: n.turnPass }];
  // Signaling servers aren't here: they belong to each workspace (members must share them).
  return o;
}

interface NetHandlers {
  onState(code: string, s: WsState, fresh: Ev[]): void;
  onPeers(code: string): void;
  onCreator(code: string, pub: string): void;
  onKey(code: string, key: string): void;
  onBlob(id: string): void;
  onBlobProgress(id: string, p: number): void;
}

const peers = new Map<string, WorkspacePeer>();

export function connect(code: string, kp: KeyPair, creator: string | null, transport: WsTransport, net: NetSettings, h: NetHandlers): WorkspacePeer {
  const existing = peers.get(code);
  if (existing) return existing;
  const p = new WorkspacePeer({
    code, kp, selfId, creator, transport,
    // No mixing: a relay workspace gets no WebRTC at all unless the user opted in. The Trystero strategy
    // follows the workspace's signaling method, since members only meet over the same one.
    joinRoom: transport.kind === 'trystero' || net.webrtc
      ? ((signalingOf(transport).kind === 'torrent' ? joinTorrent : joinNostr) as unknown as JoinRoom)
      : undefined,
    store: peerStore,
    rtc: rtcOptions(net),
    onState: (s, fresh) => h.onState(code, s, fresh),
    onPeers: () => h.onPeers(code),
    onCreator: (pub) => h.onCreator(code, pub),
    onKey: (key) => h.onKey(code, key),
    onBlob: h.onBlob,
    onBlobProgress: h.onBlobProgress,
    onJoinError: (d) => console.warn('[yurt] join error', d),
    onError: (msg) => console.error('[yurt]', msg),
    // The dev server and e2e run a local http Blossom server; production only trusts https ones.
    devFileServers: ['localhost', '127.0.0.1'].includes(location.hostname),
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

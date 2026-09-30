import { joinRoom, selfId } from 'trystero';
import { WorkspacePeer, type KeyPair, type WsState, type Ev, type JoinRoom } from '@yurt/protocol';
import { peerStore } from './db';

export interface NetSettings {
  turn: 'default' | 'custom' | 'off';
  turnUrls: string;
  turnUser: string;
  turnPass: string;
  relays: string; // optional Nostr relay list, one per line
}

// Free public TURN (Open Relay by Metered). Rate-limited; set your own in Settings → Network.
export const DEFAULT_TURN = [{
  urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'],
  username: 'openrelayproject',
  credential: 'openrelayproject',
}];

export function rtcOptions(n: NetSettings): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (n.turn === 'default') o.turnConfig = DEFAULT_TURN;
  if (n.turn === 'custom' && n.turnUrls.trim()) o.turnConfig = [{ urls: n.turnUrls.split(/[\s,]+/).filter(Boolean), username: n.turnUser, credential: n.turnPass }];
  const relays = n.relays.split(/\s+/).filter((u) => u.startsWith('wss://'));
  if (relays.length) o.relayConfig = { urls: relays };
  return o;
}

export interface NetHandlers {
  onState(code: string, s: WsState, fresh: Ev[]): void;
  onPeers(code: string): void;
  onCreator(code: string, pub: string): void;
  onBlob(id: string): void;
  onBlobProgress(id: string, p: number): void;
}

const peers = new Map<string, WorkspacePeer>();

export function connect(code: string, kp: KeyPair, creator: string | null, net: NetSettings, h: NetHandlers): WorkspacePeer {
  const existing = peers.get(code);
  if (existing) return existing;
  const p = new WorkspacePeer({
    code, kp, selfId, creator,
    joinRoom: joinRoom as unknown as JoinRoom,
    store: peerStore,
    rtc: rtcOptions(net),
    onState: (s, fresh) => h.onState(code, s, fresh),
    onPeers: () => h.onPeers(code),
    onCreator: (pub) => h.onCreator(code, pub),
    onBlob: h.onBlob,
    onBlobProgress: h.onBlobProgress,
    onJoinError: (d) => console.warn('[yurt] join error', d),
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

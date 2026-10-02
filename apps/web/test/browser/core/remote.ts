// Loaded inside a same-origin iframe by harness.ts. A separate document has its own module graph, so this Trystero
// has its own peer id: a second member in the same browser, as real as a second device.
import { joinRoom, selfId } from 'trystero';
import { WorkspacePeer, keyFromPhrase, newRecoveryPhrase, sha256Buf, uploadFile, type JoinRoom, type KeyPair, type WsTransport } from '@yurt/protocol';
import { memStore } from '../../../../../packages/protocol/test/util';

interface RemoteOpts {
  code: string;
  transport: WsTransport;
  creator?: string | null;
  /** May join the workspace's WebRTC room (calls). */
  webrtc?: boolean;
  kp?: KeyPair;
}

function makePeer(o: RemoteOpts) {
  const kp = o.kp ?? keyFromPhrase(newRecoveryPhrase());
  const errors: string[] = [];
  const { store } = memStore();
  const peer = new WorkspacePeer({
    code: o.code,
    kp,
    transport: o.transport,
    creator: o.creator ?? null,
    store,
    devFileServers: true,
    ...(o.webrtc ? { calls: { joinRoom: joinRoom as unknown as JoinRoom, selfId } } : {}),
    onError: (m) => errors.push(m),
  });
  /** A file only this member holds (bytes made in this frame), ready to attach to a message. */
  const ownFile = async (size: number) => {
    const buf = new Uint8Array(size).map((_, i) => i % 251).buffer;
    const id = await sha256Buf(buf);
    await store.putBlob?.(id, buf);
    return { id, name: 'own.bin', size, type: 'application/octet-stream' };
  };
  return { peer, kp, errors, ownFile };
}

/** Bytes uploaded (sealed) to a file server from this frame, as a member's upload would be. */
async function uploaded(servers: string[], size: number) {
  const bytes = new Uint8Array(size).map((_, i) => (i * 7) % 256);
  return { id: await sha256Buf(bytes.slice().buffer), size, blob: await uploadFile(servers, bytes) };
}

/** Real media from this frame's own (fake) devices, so streams belong to the realm that sends them. */
const media = {
  mic: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  cam: () => navigator.mediaDevices.getUserMedia({ video: true }),
};

const api = { makePeer, media, selfId, uploaded };
export type RemoteApi = typeof api;
(window as unknown as { __remote: RemoteApi }).__remote = api;

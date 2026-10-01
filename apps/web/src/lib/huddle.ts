import * as v from 'valibot';
import { parseOr, type HuddleState, type WorkspacePeer } from '@yurt/protocol';
import { getPeer } from './net';

export const MAX_VIDEO = 4;

/** Stream metadata comes from another member: a known kind (anything else is their mic) and the channel it's for. */
const StreamMetaSchema = v.object({ kind: v.fallback(v.picklist(['mic', 'cam', 'screen']), 'mic'), ch: v.fallback(v.optional(v.string()), undefined) });
const streamMeta = (m: unknown) => parseOr(StreamMetaSchema, m) ?? { kind: 'mic' as const, ch: undefined };

interface RemoteMedia {
  mic?: MediaStream | undefined;
  cam?: MediaStream | undefined;
  screen?: MediaStream | undefined;
}
export interface HuddleView {
  code: string | null;
  ch: string | null;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  local: { cam?: MediaStream | undefined; screen?: MediaStream | undefined };
  remote: Record<string, RemoteMedia>;
  error?: string | undefined;
}

type Listener = (v: HuddleView) => void;
const EMPTY: HuddleView = { code: null, ch: null, mic: false, cam: false, screen: false, local: {}, remote: {} };

/** Audio-first huddle per channel. Streams only flow between peers in the same huddle. */
class Huddle {
  view: HuddleView = EMPTY;
  private peer: WorkspacePeer | null = null;
  /** My outgoing streams by kind, in the order they started. */
  private streams = new Map<keyof RemoteMedia, MediaStream>();
  private sentTo = new Set<string>();
  private listeners = new Set<Listener>();

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(p: Partial<HuddleView>) {
    this.view = { ...this.view, ...p };
    for (const l of this.listeners) l(this.view);
  }

  videoCount(peer: WorkspacePeer | undefined, ch: string): number {
    if (!peer) return 0;
    let n = this.view.ch === ch && this.view.cam ? 1 : 0;
    for (const h of peer.huddles.values()) if (h.ch === ch && h.cam) n++;
    return n;
  }

  async join(target: WorkspacePeer, ch: string) {
    if (this.view.ch) await this.leave();
    // Relay workspaces open their WebRTC room only on demand; ensureRoom is null only when WebRTC is off for them.
    const off = 'Turn on “Allow WebRTC for voice and video” in Settings → Network to join calls here.';
    if (!target.ensureRoom()) {
      this.emit({ error: off });
      return;
    }
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch {
      /* istanbul ignore next -- the user refusing the microphone: the test browser's fake devices always allow */
      return this.emit({ error: 'Allow microphone access to join the huddle.' });
    }
    // The permission prompt can take a while: the workspace may have reconnected (new peer) or its room been left meanwhile.
    const peer = getPeer(target.code);
    const room = peer?.ensureRoom();
    if (!peer || !room) {
      for (const t of mic.getTracks()) t.stop();
      this.emit({ error: peer ? off : 'You left this workspace.' });
      return;
    }
    this.peer = peer;
    this.streams = new Map([['mic', mic]]);
    this.sentTo.clear();
    room.onPeerStream = (stream, peerId, metadata) => {
      const { kind, ch: streamCh } = streamMeta(metadata);
      if (streamCh !== this.view.ch) return;
      const cur = this.view.remote[peerId] || {};
      this.emit({ remote: { ...this.view.remote, [peerId]: { ...cur, [kind]: stream } } });
    };
    peer.onHuddle = (peerId, h) => this.onPeerHuddle(peerId, h);
    this.emit({ code: peer.code, ch, mic: true, cam: false, screen: false, local: {}, remote: {}, error: undefined });
    peer.setHuddle({ ch, mic: true, cam: false, screen: false });
    for (const [pid, h] of peer.huddles) this.onPeerHuddle(pid, h);
  }

  /** A member's huddle state changed: send them my streams when they join mine, stop when they leave it. */
  private onPeerHuddle(peerId: string, h: HuddleState | null) {
    const room = this.peer?.room;
    // Only set while I'm in a huddle (leave() removes it), and huddle news only arrives through the room.
    /* istanbul ignore next -- unreachable: kept so a future caller can't send streams into no room */
    if (!room || !this.view.ch) return;
    if (h && h.ch === this.view.ch) this.withPeer(room, peerId, h);
    else if (this.sentTo.has(peerId)) this.withoutPeer(room, peerId);
  }

  private withPeer(room: NonNullable<WorkspacePeer['room']>, peerId: string, h: HuddleState) {
    if (!this.sentTo.has(peerId)) {
      this.sentTo.add(peerId);
      for (const [kind, s] of this.streams) room.addStream(s, { target: peerId, metadata: { kind, ch: this.view.ch } });
    }
    // Drop their video tiles as soon as they say it's off, without waiting for the stream to end.
    const cur = this.view.remote[peerId];
    if (cur && ((!h.cam && cur.cam) || (!h.screen && cur.screen))) {
      this.emit({ remote: { ...this.view.remote, [peerId]: { mic: cur.mic, cam: h.cam ? cur.cam : undefined, screen: h.screen ? cur.screen : undefined } } });
    }
  }

  private withoutPeer(room: NonNullable<WorkspacePeer['room']>, peerId: string) {
    this.sentTo.delete(peerId);
    for (const s of this.streams.values())
      try {
        room.removeStream(s, { target: peerId });
      } catch {
        // Their connection already closed (they left the room too): there's nothing left to stop sending on.
      }
    const { [peerId]: _gone, ...rest } = this.view.remote;
    this.emit({ remote: rest });
  }

  private targets() {
    return [...this.sentTo];
  }

  toggleMic() {
    const t = this.streams.get('mic')?.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    this.emit({ mic: t.enabled });
    this.peer?.setHuddle({ mic: t.enabled });
  }

  async toggleCam() {
    if (!this.peer || !this.view.ch) return;
    if (this.streams.has('cam')) return this.stopKind('cam');
    if (this.videoCount(this.peer, this.view.ch) >= MAX_VIDEO) {
      this.emit({ error: `Video is capped at ${MAX_VIDEO} people. Audio still works.` });
      return;
    }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: false });
      this.startKind('cam', cam);
    } catch {
      /* istanbul ignore next -- the user refusing the camera: the test browser's fake devices always allow */
      this.emit({ error: 'Allow camera access to turn video on.' });
    }
  }

  async toggleScreen() {
    if (!this.peer || !this.view.ch) return;
    if (this.streams.has('screen')) return this.stopKind('screen');
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screen.getVideoTracks()[0]?.addEventListener('ended', () => this.stopKind('screen'));
      this.startKind('screen', screen);
    } catch {
      // The user dismissed the screen picker: nothing to share, nothing to report.
    }
  }

  private startKind(k: 'cam' | 'screen', s: MediaStream) {
    this.streams.set(k, s);
    const t = this.targets();
    if (t.length) this.peer?.room?.addStream(s, { target: t, metadata: { kind: k, ch: this.view.ch } });
    this.emit({ [k]: true, local: { ...this.view.local, [k]: s }, error: undefined });
    this.peer?.setHuddle({ [k]: true });
  }

  private stopKind(k: 'cam' | 'screen') {
    const s = this.streams.get(k);
    if (!s) return; // already stopped (the browser's "stop sharing" can come after the in-app button)
    for (const x of s.getTracks()) x.stop();
    const t = this.targets();
    if (t.length)
      try {
        this.peer?.room?.removeStream(s, { target: t });
      } catch {
        // A member's connection already closed: nothing left to stop sending on.
      }
    this.streams.delete(k);
    this.emit({ [k]: false, local: { ...this.view.local, [k]: undefined } });
    this.peer?.setHuddle({ [k]: false });
  }

  async leave() {
    const p = this.peer;
    // The room as it is now: a key rotation may have left it already, and leaving the huddle can rejoin a fresh one
    // for others who still want calls, which never had my handler.
    const room = p?.room;
    for (const s of this.streams.values()) {
      for (const x of s.getTracks()) x.stop();
      const t = this.targets();
      if (room && t.length)
        try {
          room.removeStream(s, { target: t });
        } catch {
          // A member's connection already closed: nothing left to stop sending on.
        }
    }
    this.streams.clear();
    this.sentTo.clear();
    if (room) room.onPeerStream = null;
    if (p) {
      p.setHuddle({ ch: null, mic: false, cam: false, screen: false });
      delete p.onHuddle;
    }
    this.peer = null;
    this.emit(EMPTY);
  }

  clearError() {
    this.emit({ error: undefined });
  }
}

export const huddle = new Huddle();

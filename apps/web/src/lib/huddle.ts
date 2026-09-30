import type { WorkspacePeer, HuddleState } from '@yurt/protocol';

export const MAX_VIDEO = 4;

export interface RemoteMedia { mic?: MediaStream; cam?: MediaStream; screen?: MediaStream }
export interface HuddleView {
  code: string | null;
  ch: string | null;
  mic: boolean; cam: boolean; screen: boolean;
  local: { cam?: MediaStream; screen?: MediaStream };
  remote: Record<string, RemoteMedia>;
  error?: string;
}

type Listener = (v: HuddleView) => void;
const EMPTY: HuddleView = { code: null, ch: null, mic: false, cam: false, screen: false, local: {}, remote: {} };

/** Audio-first huddle per channel. Streams only flow between peers in the same huddle. */
class Huddle {
  view: HuddleView = EMPTY;
  private peer: WorkspacePeer | null = null;
  private streams: { mic?: MediaStream; cam?: MediaStream; screen?: MediaStream } = {};
  private sentTo = new Set<string>();
  private listeners = new Set<Listener>();

  subscribe(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  private emit(p: Partial<HuddleView>) { this.view = { ...this.view, ...p }; this.listeners.forEach((l) => l(this.view)); }

  videoCount(peer: WorkspacePeer | undefined, ch: string): number {
    if (!peer) return 0;
    let n = this.view.ch === ch && this.view.cam ? 1 : 0;
    for (const h of peer.huddles.values()) if (h.ch === ch && h.cam) n++;
    return n;
  }

  async join(peer: WorkspacePeer, ch: string) {
    if (this.view.ch) await this.leave();
    if (!peer.room) { this.emit({ error: 'Still connecting to this workspace. Try again in a moment.' }); return; }
    let mic: MediaStream;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }
    catch { this.emit({ error: 'Allow microphone access to join the huddle.' }); return; }
    this.peer = peer;
    this.streams = { mic };
    this.sentTo.clear();
    peer.room!.onPeerStream = (stream, peerId, meta) => {
      const kind = (meta?.kind || 'mic') as keyof RemoteMedia;
      if (meta?.ch !== this.view.ch) return;
      const cur = this.view.remote[peerId] || {};
      this.emit({ remote: { ...this.view.remote, [peerId]: { ...cur, [kind]: stream } } });
    };
    peer.onHuddle = (peerId, h) => this.onPeerHuddle(peerId, h);
    this.emit({ code: peer.code, ch, mic: true, cam: false, screen: false, local: {}, remote: {}, error: undefined });
    peer.setHuddle({ ch, mic: true, cam: false, screen: false });
    for (const [pid, h] of peer.huddles) this.onPeerHuddle(pid, h);
  }

  private onPeerHuddle(peerId: string, h: HuddleState | null) {
    const p = this.peer;
    if (!p || !this.view.ch) return;
    if (h && h.ch === this.view.ch) {
      if (!this.sentTo.has(peerId)) {
        this.sentTo.add(peerId);
        for (const k of ['mic', 'cam', 'screen'] as const) {
          const s = this.streams[k];
          if (s) p.room!.addStream(s, { target: peerId, metadata: { kind: k, ch: this.view.ch } });
        }
      }
      const cur = this.view.remote[peerId];
      if (cur && ((!h.cam && cur.cam) || (!h.screen && cur.screen))) {
        this.emit({ remote: { ...this.view.remote, [peerId]: { mic: cur.mic, cam: h.cam ? cur.cam : undefined, screen: h.screen ? cur.screen : undefined } } });
      }
    } else if (this.sentTo.has(peerId)) {
      this.sentTo.delete(peerId);
      for (const s of Object.values(this.streams)) if (s) try { p.room!.removeStream(s, { target: peerId }); } catch { /* peer gone */ }
      const { [peerId]: _gone, ...rest } = this.view.remote;
      this.emit({ remote: rest });
    }
  }

  private targets() { return [...this.sentTo]; }

  toggleMic() {
    const t = this.streams.mic?.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    this.emit({ mic: t.enabled });
    this.peer?.setHuddle({ mic: t.enabled });
  }

  async toggleCam() {
    if (!this.peer || !this.view.ch) return;
    if (this.streams.cam) return this.stopKind('cam');
    if (this.videoCount(this.peer, this.view.ch) >= MAX_VIDEO) { this.emit({ error: `Video is capped at ${MAX_VIDEO} people. Audio still works.` }); return; }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: false });
      this.startKind('cam', cam);
    } catch { this.emit({ error: 'Allow camera access to turn video on.' }); }
  }

  async toggleScreen() {
    if (!this.peer || !this.view.ch) return;
    if (this.streams.screen) return this.stopKind('screen');
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screen.getVideoTracks()[0].addEventListener('ended', () => this.stopKind('screen'));
      this.startKind('screen', screen);
    } catch { /* picker dismissed */ }
  }

  private startKind(k: 'cam' | 'screen', s: MediaStream) {
    this.streams[k] = s;
    const t = this.targets();
    if (t.length) this.peer!.room!.addStream(s, { target: t, metadata: { kind: k, ch: this.view.ch } });
    this.emit({ [k]: true, local: { ...this.view.local, [k]: s }, error: undefined });
    this.peer!.setHuddle({ [k]: true });
  }

  private stopKind(k: 'cam' | 'screen') {
    const s = this.streams[k];
    if (!s) return;
    s.getTracks().forEach((x) => x.stop());
    const t = this.targets();
    if (t.length) try { this.peer?.room?.removeStream(s, { target: t }); } catch { /* ignore */ }
    delete this.streams[k];
    this.emit({ [k]: false, local: { ...this.view.local, [k]: undefined } });
    this.peer?.setHuddle({ [k]: false });
  }

  async leave() {
    const p = this.peer;
    for (const s of Object.values(this.streams)) if (s) {
      s.getTracks().forEach((x) => x.stop());
      const t = this.targets();
      if (p?.room && t.length) try { p.room.removeStream(s, { target: t }); } catch { /* ignore */ }
    }
    this.streams = {};
    this.sentTo.clear();
    if (p) { p.setHuddle({ ch: null, mic: false, cam: false, screen: false }); p.onHuddle = undefined; if (p.room) p.room.onPeerStream = null; }
    this.peer = null;
    this.emit(EMPTY);
  }

  clearError() { this.emit({ error: undefined }); }
}

export const huddle = new Huddle();

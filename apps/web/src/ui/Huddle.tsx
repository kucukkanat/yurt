import React, { useEffect, useRef } from 'react';
import { Icon, IconButton, Button, Tooltip, Avatar } from '@yurt/ui';
import { useApp } from '../store';
import { useCurrent, personFor, channelTitle } from '../model';
import { huddle, MAX_VIDEO } from '../lib/huddle';
import { getPeer } from '../lib/net';

function participants(ch: string) {
  const { peer, state, identity } = useCurrent();
  const hud = useApp((s) => s.huddle);
  const out: { pid: string; pub: string; mic: boolean; cam: boolean; screen: boolean }[] = [];
  if (peer) for (const [pid, h] of peer.huddles) if (h.ch === ch) { const who = peer.peers.get(pid); if (who) out.push({ pid, pub: who.pub, ...h }); }
  const mine = hud.code === peer?.code && hud.ch === ch;
  return { list: out, mine, peer, state, identity, hud };
}

export function HuddleButton({ ch }: { ch: string }) {
  const { mine, peer } = participants(ch);
  if (mine) return null;
  const off = !!peer && !peer.calls;
  return (
    <Tooltip content={off ? 'Turn on WebRTC in Settings → Network to join calls' : 'Start or join huddle'} placement="bottom">
      <IconButton icon="headphones" label="Start or join huddle" size="sm" disabled={off} data-testid="huddle-button" onClick={() => peer && huddle.join(peer, ch)} />
    </Tooltip>
  );
}

export function HuddleStrip({ ch }: { ch: string }) {
  const { list, mine, peer, state, identity } = participants(ch);
  if (mine || !list.length) return null;
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '6px 12px 6px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--agent-soft)', animation: 'ag-rise var(--dur-fast) var(--ease-out)' }}>
      <Icon name="headphones" size={16} style={{ color: 'var(--agent-ink)' }} />
      <span style={{ display: 'flex' }}>{list.slice(0, 4).map((p, i) => { const person = personFor(state, peer, p.pub, identity.pub); return <Avatar key={p.pid} name={person.name} size={24} decorative style={{ marginLeft: i ? -7 : 0, borderRadius: 999, boxShadow: '0 0 0 2px var(--surface-page)' }} />; })}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>Huddle · {list.length} {list.length === 1 ? 'person' : 'people'}</span>
      <Button size="sm" variant="agent" iconLeft="headphones" onClick={() => peer && huddle.join(peer, ch)}>Join</Button>
    </div>
  );
}

function Video({ stream, muted, label, mirror }: { stream: MediaStream; muted?: boolean; label: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) { ref.current.srcObject = stream; ref.current.play().catch(() => {}); } }, [stream]);
  return (
    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: 'var(--ink-950)', aspectRatio: '16 / 9', minWidth: 0 }}>
      <video ref={ref} autoPlay playsInline muted={muted} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined, display: 'block' }} />
      <span style={{ position: 'absolute', left: 8, bottom: 8, padding: '3px 8px', borderRadius: 999, background: 'rgba(13,13,12,.7)', color: '#fff', font: '600 12px/1.2 var(--font-body)' }}>{label}</span>
    </div>
  );
}

function Audio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; ref.current.play().catch(() => {}); } }, [stream]);
  return <audio ref={ref} autoPlay />;
}

/** Always mounted in the shell so audio survives channel switches and the mobile drawer closing. */
export function HuddleAudio() {
  const remote = useApp((s) => s.huddle.remote);
  return <>{Object.entries(remote).map(([pid, r]) => r.mic && <Audio key={pid} stream={r.mic} />)}</>;
}

/** Video / screen tiles for the huddle you're in. */
export function HuddleStage() {
  const hud = useApp((s) => s.huddle);
  const { state, identity } = useCurrent();
  const peer = getPeer(hud.code);
  const tiles: React.ReactNode[] = [];
  if (hud.local.screen) tiles.push(<Video key="ls" stream={hud.local.screen} muted label="Your screen" />);
  for (const [pid, r] of Object.entries(hud.remote)) {
    const pub = peer?.peers.get(pid)?.pub || '';
    const name = personFor(state, peer, pub, identity.pub).name;
    if (r.screen) tiles.push(<Video key={pid + 's'} stream={r.screen} label={name + '’s screen'} />);
    if (r.cam) tiles.push(<Video key={pid + 'c'} stream={r.cam} label={name} />);
  }
  if (hud.local.cam) tiles.push(<Video key="lc" stream={hud.local.cam} muted mirror label="You" />);
  if (!tiles.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 8, padding: 12, borderBottom: '1px solid var(--border-subtle)', maxHeight: '45%', overflow: 'auto', flexShrink: 0 }}>
      {tiles}
    </div>
  );
}

export function HuddleDock() {
  const hud = useApp((s) => s.huddle);
  const states = useApp((s) => s.states);
  const identity = useApp((s) => s.identity)!;
  useApp((s) => s.tick);
  if (!hud.ch || !hud.code) return null;
  const peer = getPeer(hud.code);
  const state = states[hud.code];
  const n = peer ? [...peer.huddles.values()].filter((h) => h.ch === hud.ch).length + 1 : 1;
  const camCap = !hud.cam && huddle.videoCount(peer, hud.ch) >= MAX_VIDEO;
  const where = hud.ch.includes(':') ? channelTitle(state, hud.ch, identity.pub) : '#' + channelTitle(state, hud.ch, identity.pub);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 16, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)', animation: 'ag-pop var(--dur-base) var(--ease-spring)' }}>
      <button type="button" onClick={() => useApp.getState().go({ code: hud.code!, ch: hud.ch! })} style={{ display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ width: 8, height: 8, borderRadius: 9, background: 'var(--volt-400)', boxShadow: '0 0 0 3px rgba(210,255,46,.18)', animation: 'ag-pulse 1.6s var(--ease-in-out) infinite' }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Huddle in {where}</span>
        <span style={{ font: '400 11px var(--font-mono)', color: 'var(--text-subtle)' }}>{n}</span>
      </button>
      {hud.error && <div role="alert" style={{ fontSize: 12, color: 'var(--danger-ink)' }}>{hud.error}</div>}
      <div style={{ display: 'flex', gap: 4 }}>
        <IconButton icon={hud.mic ? 'mic' : 'mic-off'} label={hud.mic ? 'Mute' : 'Unmute'} size="sm" active={!hud.mic} onClick={() => huddle.toggleMic()} />
        <IconButton icon={hud.cam ? 'video' : 'video-off'} label={camCap ? 'Video is full (' + MAX_VIDEO + ')' : hud.cam ? 'Turn video off' : 'Turn video on'} size="sm" active={hud.cam} disabled={camCap} onClick={() => huddle.toggleCam()} />
        <IconButton icon="monitor-up" label={hud.screen ? 'Stop sharing' : 'Share screen'} size="sm" active={hud.screen} onClick={() => huddle.toggleScreen()} />
        <span style={{ flex: 1 }} />
        <IconButton icon="phone-off" label="Leave huddle" size="sm" variant="danger" onClick={() => huddle.leave()} />
      </div>
    </div>
  );
}

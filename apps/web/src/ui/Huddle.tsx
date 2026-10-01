import { useEffect, useRef } from 'react';
import { Icon, IconButton, Button, Tooltip, Avatar } from '@yurt/ui';
import { useApp } from '../store';
import { useCurrent, personFor, channelTitle } from '../model';
import { huddle, MAX_VIDEO } from '../lib/huddle';
import { getPeer } from '../lib/net';

function useParticipants(ch: string) {
  const { peer, state, identity } = useCurrent();
  const hud = useApp((s) => s.huddle);
  const out: { pid: string; pub: string; mic: boolean; cam: boolean; screen: boolean }[] = [];
  if (peer)
    for (const [pid, h] of peer.huddles)
      if (h.ch === ch) {
        const who = peer.peers.get(pid);
        if (who) out.push({ pid, pub: who.pub, ...h });
      }
  const mine = hud.code === peer?.code && hud.ch === ch;
  return { list: out, mine, peer, state, identity, hud };
}

export function HuddleButton({ ch }: { ch: string }) {
  const { mine, peer } = useParticipants(ch);
  if (mine) return null;
  const off = !!peer && !peer.calls;
  return (
    <Tooltip content={off ? 'Turn on calls in Settings → Connection to join' : 'Start or join huddle'} placement="bottom">
      <IconButton icon="headphones" label="Start or join huddle" size="sm" disabled={off} data-testid="huddle-button" onClick={() => peer && huddle.join(peer, ch)} />
    </Tooltip>
  );
}

export function HuddleStrip({ ch }: { ch: string }) {
  const { list, mine, peer, state, identity } = useParticipants(ch);
  if (mine || !list.length) return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 44,
        padding: '6px 12px 6px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--agent-soft)',
        animation: 'ag-rise var(--dur-fast) var(--ease-out)',
      }}
    >
      <Icon name="headphones" size={16} style={{ color: 'var(--agent-ink)' }} />
      <span style={{ display: 'flex' }}>
        {list.slice(0, 4).map((p, i) => {
          const person = personFor(state, peer, p.pub, identity.pub);
          return <Avatar key={p.pid} name={person.name} size={24} decorative style={{ marginLeft: i ? -7 : 0, borderRadius: 999, boxShadow: '0 0 0 2px var(--surface-page)' }} />;
        })}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>
        Huddle · {list.length} {list.length === 1 ? 'person' : 'people'}
      </span>
      <Button size="sm" variant="agent" iconLeft="headphones" onClick={() => peer && huddle.join(peer, ch)}>
        Join
      </Button>
    </div>
  );
}

export function Video({ stream, muted, label, mirror }: { stream: MediaStream; muted?: boolean; label: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: 'var(--ink-950)', aspectRatio: '16 / 9', minWidth: 0 }}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined, display: 'block' }}
      />
      <span
        style={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          padding: '3px 8px',
          borderRadius: 999,
          background: 'rgba(13,13,12,.7)',
          color: '#fff',
          font: '600 12px/1.2 var(--font-body)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

function Audio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    // biome-ignore lint/a11y/useMediaCaption: live call audio from other members; there is no caption track to offer
    <audio ref={ref} autoPlay />
  );
}

/** Always mounted in the shell so audio survives channel switches and the mobile drawer closing. */
export function HuddleAudio() {
  const remote = useApp((s) => s.huddle.remote);
  return <>{Object.entries(remote).map(([pid, r]) => r.mic && <Audio key={pid} stream={r.mic} />)}</>;
}

/**
 * The video button: off when the huddle already shows MAX_VIDEO cameras (counting mine), unless mine is one of them.
 * `cameras` is huddle.videoCount: every camera that's on in this huddle.
 */
export function camButton(mine: boolean, cameras: number): { label: string; disabled: boolean } {
  if (mine) return { label: 'Turn video off', disabled: false };
  if (cameras >= MAX_VIDEO) return { label: 'Video is full (' + MAX_VIDEO + ')', disabled: true };
  return { label: 'Turn video on', disabled: false };
}

/** An error while in a huddle (outside one, the store toasts it instead). */
export function HuddleError({ error }: { error?: string | undefined }) {
  if (!error) return null;
  return (
    <div role="alert" style={{ fontSize: 12, color: 'var(--danger-ink)' }}>
      {error}
    </div>
  );
}

/**
 * The huddle I'm in, collapsed: where it is and how many, Mute and Leave. Tapping it opens the huddle panel (which has
 * everything else); while that panel is open the dock isn't shown.
 */
export function HuddleDock() {
  const hud = useApp((s) => s.huddle);
  const open = useApp((s) => s.huddleOpen);
  const states = useApp((s) => s.states);
  const identity = useApp((s) => s.identity);
  useApp((s) => s.tick);
  if (!hud.ch || !hud.code || !identity || open) return null;
  const peer = getPeer(hud.code);
  const n = peer ? [...peer.huddles.values()].filter((h) => h.ch === hud.ch).length + 1 : 1;
  return (
    <div
      data-testid="huddle-dock"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: 'var(--space-1) var(--space-1) var(--space-1) var(--space-3)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface-card)',
        border: 'var(--border-width) solid var(--border-subtle)',
        boxShadow: 'var(--shadow-sm)',
        animation: 'ag-pop var(--dur-base) var(--ease-spring)',
      }}
    >
      <button
        type="button"
        data-testid="huddle-dock-open"
        onClick={() => useApp.setState({ huddleOpen: true })}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          border: 0,
          background: 'none',
          padding: 'var(--space-1) 0',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <LiveDot />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Huddle in {huddleWhere(states[hud.code], hud.ch, identity.pub)}
        </span>
        <span style={{ font: '400 11px var(--font-mono)', color: 'var(--text-subtle)' }}>{n}</span>
      </button>
      <IconButton icon={hud.mic ? 'mic' : 'mic-off'} label={hud.mic ? 'Mute' : 'Unmute'} size="sm" active={!hud.mic} onClick={() => huddle.toggleMic()} />
      <IconButton icon="phone-off" label="Leave huddle" size="sm" variant="danger" onClick={() => huddle.leave()} />
    </div>
  );
}

/** "#general" for a channel, the other person's name for a DM. */
export const huddleWhere = (state: Parameters<typeof channelTitle>[0], ch: string, me: string) => (ch.includes(':') ? '' : '#') + channelTitle(state, ch, me);

/** The pulsing dot that marks a live call. */
export function LiveDot() {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 8,
        height: 8,
        borderRadius: 'var(--radius-pill)',
        background: 'var(--volt-400)',
        boxShadow: '0 0 0 3px rgba(210,255,46,.18)',
        animation: 'ag-pulse 1.6s var(--ease-in-out) infinite',
      }}
    />
  );
}

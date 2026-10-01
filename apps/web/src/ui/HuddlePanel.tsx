import type React from 'react';
import { Avatar, Icon, IconButton } from '@yurt/ui';
import { useApp } from '../store';
import { personFor } from '../model';
import { huddle, type HuddleView } from '../lib/huddle';
import { getPeer } from '../lib/net';
import { camButton, HuddleError, huddleWhere, LiveDot, Video } from './Huddle';
import { useSwipe } from './touch';

const collapse = () => useApp.setState({ huddleOpen: false });
/** Phones (iOS Safari) can't share a screen at all: no button there rather than one that fails. */
const canShareScreen = () => typeof navigator.mediaDevices?.getDisplayMedia === 'function';

/**
 * The huddle I'm in, in its own column at the right (full screen on a phone): who's in it, their video and shared
 * screens, and the call's controls. It stays open across conversations and workspaces while the call lasts; collapsed,
 * the dock (ui/Huddle.tsx) stands in for it.
 */
export function HuddlePanel({ narrow }: { narrow: boolean }) {
  const hud = useApp((s) => s.huddle);
  const open = useApp((s) => s.huddleOpen);
  const states = useApp((s) => s.states);
  const identity = useApp((s) => s.identity);
  useApp((s) => s.tick);
  const swipe = useSwipe({ right: collapse });
  if (!open || !hud.code || !hud.ch || !identity) return null;
  const { code, ch } = { code: hud.code, ch: hud.ch };
  const peer = getPeer(code);
  const state = states[code];
  const me = identity.pub;
  const nameOf = (pub: string) => personFor(state, peer, pub, me).name;

  const others = [...(peer?.huddles ?? [])].flatMap(([pid, h]) => {
    const pub = h.ch === ch ? peer?.peers.get(pid)?.pub : undefined;
    return pub ? [{ pid, pub, mic: h.mic, cam: h.cam, screen: h.screen }] : [];
  });
  const people = [{ pid: 'me', pub: me, mic: hud.mic, cam: hud.cam, screen: hud.screen }, ...others];

  return (
    <aside
      aria-label="Huddle"
      data-testid="huddle-panel"
      {...(narrow ? swipe.handlers : {})}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-page)',
        ...(narrow
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: 'var(--z-dialog)',
              padding: 'var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)',
              touchAction: 'pan-y',
              transform: swipe.offset > 0 ? 'translateX(' + swipe.offset + 'px)' : undefined,
              animation: 'ag-rise var(--dur-base) var(--ease-out)',
            }
          : { width: 'var(--layout-panel, 320px)', minWidth: 300, flexShrink: 0, height: '100%', borderLeft: 'var(--border-width) solid var(--border-subtle)' }),
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          height: 56,
          padding: '0 var(--space-2) 0 var(--space-4)',
          borderBottom: 'var(--border-width) solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <LiveDot />
        <button
          type="button"
          data-testid="huddle-panel-where"
          onClick={() => useApp.getState().go({ code, ch })}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            background: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            font: '700 16px/1.2 var(--font-display)',
            letterSpacing: '-0.02em',
            color: 'var(--text-strong)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          Huddle in {huddleWhere(state, ch, me)}
        </button>
        <IconButton icon={narrow ? 'chevron-down' : 'chevron-right'} label="Collapse huddle" size="sm" data-testid="huddle-panel-collapse" onClick={collapse} />
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-3)' }}>
        <Stage hud={hud} nameOf={(pid) => nameOf(peer?.peers.get(pid)?.pub ?? '')} />
        <section aria-label="In the huddle">
          <div
            style={{ padding: '0 var(--space-1) var(--space-2)', fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            {people.length} {people.length === 1 ? 'person' : 'people'}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {people.map((p) => (
              <li key={p.pid} data-testid="huddle-person" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-1)' }}>
                <Avatar name={nameOf(p.pub)} size={28} decorative />
                <span
                  style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {nameOf(p.pub)}
                  {p.pub === me && <span style={{ color: 'var(--text-subtle)' }}> (you)</span>}
                </span>
                {p.screen && <Icon name="monitor-up" size={14} aria-label="Sharing screen" style={{ color: 'var(--text-muted)' }} />}
                {p.cam && <Icon name="video" size={14} aria-label="Video on" style={{ color: 'var(--text-muted)' }} />}
                <Icon name={p.mic ? 'mic' : 'mic-off'} size={14} aria-label={p.mic ? 'Mic on' : 'Muted'} style={{ color: p.mic ? 'var(--text-muted)' : 'var(--danger-ink)' }} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          padding: 'var(--space-3)',
          borderTop: 'var(--border-width) solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <HuddleError error={hud.error} />
        <Controls hud={hud} cameras={huddle.videoCount(peer, ch)} />
      </footer>
    </aside>
  );
}

/** Shared screens first, the first one big (the focus), then cameras, mine last. */
function Stage({ hud, nameOf }: { hud: HuddleView; nameOf: (pid: string) => string }) {
  const screens: React.ReactNode[] = [];
  const cams: React.ReactNode[] = [];
  if (hud.local.screen) screens.push(<Video key="ls" stream={hud.local.screen} muted label="Your screen" />);
  for (const [pid, r] of Object.entries(hud.remote)) {
    if (r.screen) screens.push(<Video key={pid + 's'} stream={r.screen} label={nameOf(pid) + '’s screen'} />);
    if (r.cam) cams.push(<Video key={pid + 'c'} stream={r.cam} label={nameOf(pid)} />);
  }
  if (hud.local.cam) cams.push(<Video key="lc" stream={hud.local.cam} muted mirror label="You" />);
  const [focus, ...rest] = screens;
  const tiles = [...rest, ...cams];
  return (
    <>
      {focus && <div data-testid="huddle-focus">{focus}</div>}
      {tiles.length > 0 && (
        <div data-testid="huddle-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--space-2)' }}>
          {tiles}
        </div>
      )}
    </>
  );
}

/** Mic, video, screen and leave. `cameras` counts every camera on in the huddle (for the video cap). */
function Controls({ hud, cameras }: { hud: HuddleView; cameras: number }) {
  const cam = camButton(hud.cam, cameras);
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
      <IconButton icon={hud.mic ? 'mic' : 'mic-off'} label={hud.mic ? 'Mute' : 'Unmute'} active={!hud.mic} onClick={() => huddle.toggleMic()} />
      <IconButton icon={hud.cam ? 'video' : 'video-off'} label={cam.label} active={hud.cam} disabled={cam.disabled} onClick={() => huddle.toggleCam()} />
      {canShareScreen() && <IconButton icon="monitor-up" label={hud.screen ? 'Stop sharing' : 'Share screen'} active={hud.screen} onClick={() => huddle.toggleScreen()} />}
      <IconButton icon="phone-off" label="Leave huddle" variant="danger" onClick={() => huddle.leave()} />
    </div>
  );
}

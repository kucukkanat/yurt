import { useEffect, useSyncExternalStore } from 'react';
import { Avatar, Button } from '@yurt/ui';
import { useApp } from '../store';
import { personFor } from '../model';
import { huddle } from '../lib/huddle';
import { allPeers, getPeer } from '../lib/net';
import { callKey, dmCalls } from '../lib/ring';
import { ringer } from '../lib/ringer';

/** Who is in which huddle in a workspace, by public key. */
const inHuddles = (p: ReturnType<typeof allPeers>[number]) =>
  [...p.huddles].flatMap(([pid, h]) => {
    const who = p.peers.get(pid);
    return who ? [{ pub: who.pub, ch: h.ch }] : [];
  });

/**
 * Rings for a huddle in a DM with me, in any workspace, and shows who's calling with Join and Silence. Mounted once,
 * for as long as there's an identity.
 */
export function IncomingCall() {
  const me = useApp((s) => s.identity?.pub);
  const tick = useApp((s) => s.tick);
  const hud = useApp((s) => s.huddle);
  const call = useSyncExternalStore(ringer.subscribe, ringer.current);
  const state = useApp((s) => (call ? s.states[call.code] : undefined));

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is how huddle changes (kept on the peers, outside the store) re-run this
  useEffect(() => {
    if (!me) return;
    const calls = allPeers().flatMap((p) => dmCalls(p.code, me, inHuddles(p)));
    ringer.update(calls, hud.code && hud.ch ? callKey({ code: hud.code, ch: hud.ch }) : null);
  }, [me, tick, hud]);
  useEffect(() => {
    // Browsers play sound only once a tap has; any tap from now on lets a later call ring.
    window.addEventListener('pointerdown', ringer.unlock);
    window.addEventListener('keydown', ringer.unlock);
    return () => {
      window.removeEventListener('pointerdown', ringer.unlock);
      window.removeEventListener('keydown', ringer.unlock);
      ringer.update([], null);
    };
  }, []);

  if (!call || !me) return null;
  const peer = getPeer(call.code);
  const caller = personFor(state, peer, call.from, me);
  const join = () => {
    if (peer) void huddle.join(peer, call.ch);
    useApp.getState().go({ code: call.code, ch: call.ch });
  };
  return (
    <div
      role="alertdialog"
      aria-label={`${caller.name} is calling you`}
      data-testid="incoming-call"
      style={{
        position: 'fixed',
        top: 'calc(var(--space-3) + var(--safe-top))',
        left: 0,
        right: 0,
        margin: '0 auto',
        zIndex: 'var(--z-toast)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        width: 'min(420px, calc(100vw - var(--space-6)))',
        boxSizing: 'border-box',
        padding: 'var(--space-3) var(--space-3) var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        border: 'var(--border-width) solid var(--border-subtle)',
        background: 'var(--surface-raised)',
        boxShadow: 'var(--shadow-lg)',
        animation: 'ag-rise var(--dur-base) var(--ease-out)',
      }}
    >
      <Avatar name={caller.name} size={36} decorative />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{caller.name}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>is calling you</div>
      </div>
      <Button size="sm" variant="ghost" data-testid="incoming-call-silence" onClick={() => ringer.silence()}>
        Silence
      </Button>
      <Button size="sm" variant="agent" iconLeft="headphones" data-testid="incoming-call-join" onClick={join}>
        Join
      </Button>
    </div>
  );
}

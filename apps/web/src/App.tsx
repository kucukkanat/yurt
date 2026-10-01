import { useEffect } from 'react';
import { Toast } from '@yurt/ui';
import { useApp } from './store';
import { useCurrent, useMedia } from './model';
import { Onboarding } from './ui/Onboarding';
import { Rail, Sidebar } from './ui/Sidebar';
import { ChannelView } from './ui/ChannelView';
import { Home } from './ui/Home';
import { RightPanel } from './ui/Panels';
import { Dialogs } from './ui/Dialogs';
import { HuddleAudio } from './ui/Huddle';
import { useSwipe } from './ui/touch';

/** How close to the left edge (px) a swipe must start to pull the sidebar out. */
const EDGE = 28;
const setDrawer = (open: boolean) => useApp.setState({ drawer: open });

export function App() {
  const ready = useApp((s) => s.ready);
  const identity = useApp((s) => s.identity);
  if (!ready) return null;
  return (
    <>
      {identity ? <Shell /> : <Onboarding />}
      <Toasts />
    </>
  );
}

type AppStore = ReturnType<typeof useApp.getState>;

/** ⌘/Ctrl shortcuts: the key, whether it needs an open workspace, and what it does. */
const MOD_KEYS: Record<string, { inWorkspace?: boolean; run(s: AppStore): void }> = {
  k: { run: (s) => s.setDialog(s.dialog === 'jump' ? null : 'jump') },
  ',': { run: (s) => s.openSettings() },
  i: { inWorkspace: true, run: (s) => s.setPanel(s.panel.type === 'members' ? { type: null } : { type: 'members' }) },
  f: { inWorkspace: true, run: (s) => s.setPanel({ type: 'search' }) },
};

/** Escape closes the side panel (leaving a thread's route too), unless a dialog or a text field has it. */
function closePanel(s: AppStore, e: KeyboardEvent): boolean {
  const typing = e.target instanceof HTMLElement && !!e.target.closest('textarea,input');
  if (e.key !== 'Escape' || s.dialog || !s.panel.type || typing) return false;
  if (s.panel.type === 'thread' && s.route.code) s.go({ code: s.route.code, ch: s.route.ch });
  s.setPanel({ type: null });
  return true;
}

function useShortcuts() {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const shortcut = e.metaKey || e.ctrlKey ? MOD_KEYS[e.key.toLowerCase()] : undefined;
      if (shortcut && (!shortcut.inWorkspace || s.route.code)) {
        e.preventDefault();
        shortcut.run(s);
        return;
      }
      closePanel(s, e);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
}

function Shell() {
  const narrow = useMedia('(max-width: 760px)');
  const { route, state } = useCurrent();
  const panel = useApp((s) => s.panel);
  const drawer = useApp((s) => s.drawer);
  // Narrow screens: swipe in from the left edge for the sidebar, and swipe it away to the left.
  const pullOut = useSwipe({ right: () => setDrawer(true) }, { edge: EDGE });
  const pushAway = useSwipe({ left: () => setDrawer(false) });
  useShortcuts();
  const nChannels = state?.channels.size || 0;
  useEffect(() => {
    if (route.code && !route.ch && state && nChannels) {
      const first = state.channels.has('general') ? 'general' : [...state.channels.keys()][0];
      useApp.getState().go({ code: route.code, ch: first });
    }
  }, [route.code, route.ch, state, nChannels]);
  const side = (
    <div style={{ display: 'flex', height: '100%', flexShrink: 0 }}>
      <Rail />
      {route.code && <Sidebar />}
    </div>
  );
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        height: '100%',
        boxSizing: 'border-box',
        // Clear of the notch, the rounded corners and the home indicator (installed apps draw under them).
        padding: 'var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)',
        background: 'var(--surface-page)',
      }}
    >
      {narrow
        ? drawer && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-dialog)', animation: 'ag-fade var(--dur-fast) var(--ease-out)' }}>
              {/* The dimmed backdrop is a real button, so tapping beside the drawer closes it. */}
              <button
                type="button"
                aria-label="Close sidebar"
                onClick={() => useApp.setState({ drawer: false })}
                style={{ position: 'absolute', inset: 0, padding: 0, border: 0, background: 'var(--surface-overlay)', cursor: 'default' }}
              />
              <div
                data-testid="drawer"
                {...pushAway.handlers}
                style={{
                  position: 'relative',
                  height: '100%',
                  width: 'min(100%, 340px)',
                  boxSizing: 'border-box',
                  paddingTop: 'var(--safe-top)',
                  touchAction: 'pan-y',
                  transform: pushAway.offset < 0 ? 'translateX(' + pushAway.offset + 'px)' : undefined,
                  animation: 'ag-rise var(--dur-base) var(--ease-out)',
                }}
              >
                {side}
              </div>
            </div>
          )
        : side}
      <main data-testid="main" {...(narrow && !panel.type ? pullOut.handlers : {})} style={{ flex: 1, minWidth: 0, display: 'flex', height: '100%', touchAction: 'pan-y' }}>
        {route.code && route.ch ? <ChannelView narrow={narrow} /> : <Home narrow={narrow} />}
        {panel.type && route.code && <RightPanel narrow={narrow} />}
      </main>
      <Dialogs />
      <HuddleAudio />
    </div>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'calc(20px + var(--safe-bottom))',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 'var(--z-toast)',
        pointerEvents: 'none',
        padding: '0 12px',
      }}
    >
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto', maxWidth: '100%' }}>
          <Toast
            tone={t.tone}
            title={t.title}
            description={t.description}
            actionLabel={t.actionLabel}
            duration={t.duration}
            onAction={() => {
              t.onAction?.();
              dismiss(t.id);
            }}
            onClose={() => dismiss(t.id)}
          />
        </div>
      ))}
    </div>
  );
}

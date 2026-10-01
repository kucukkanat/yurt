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

function useShortcuts() {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        s.setDialog(s.dialog === 'jump' ? null : 'jump');
      } else if (mod && e.key === ',') {
        e.preventDefault();
        s.openSettings();
      } else if (mod && e.key.toLowerCase() === 'i' && s.route.code) {
        e.preventDefault();
        s.setPanel(s.panel.type === 'members' ? { type: null } : { type: 'members' });
      } else if (mod && e.key.toLowerCase() === 'f' && s.route.code) {
        e.preventDefault();
        s.setPanel({ type: 'search' });
      } else if (e.key === 'Escape' && !s.dialog && s.panel.type && !(e.target as HTMLElement)?.closest?.('textarea,input')) {
        if (s.panel.type === 'thread' && s.route.code) s.go({ code: s.route.code, ch: s.route.ch });
        s.setPanel({ type: null });
      }
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
  useShortcuts();
  const nChannels = state?.channels.size || 0;
  useEffect(() => {
    if (route.code && !route.ch && state && nChannels) {
      const first = state.channels.has('general') ? 'general' : [...state.channels.keys()][0];
      useApp.getState().go({ code: route.code, ch: first });
    }
  }, [route.code, route.ch, nChannels]);
  const side = (
    <div style={{ display: 'flex', height: '100%', flexShrink: 0 }}>
      <Rail />
      {route.code && <Sidebar />}
    </div>
  );
  return (
    <div style={{ position: 'relative', display: 'flex', height: '100%', background: 'var(--surface-page)' }}>
      {narrow
        ? drawer && (
            <div
              onMouseDown={(e) => e.target === e.currentTarget && useApp.setState({ drawer: false })}
              style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-dialog)' as any, background: 'var(--surface-overlay)', animation: 'ag-fade var(--dur-fast) var(--ease-out)' }}
            >
              <div style={{ height: '100%', width: 'min(100%, 340px)', animation: 'ag-rise var(--dur-base) var(--ease-out)' }}>{side}</div>
            </div>
          )
        : side}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', height: '100%' }}>
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
        bottom: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 'var(--z-toast)' as any,
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

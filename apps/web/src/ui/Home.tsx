import { Button, Icon, IconButton } from '@yurt/ui';
import { formatCode } from '@yurt/protocol';
import { useApp } from '../store';
import { useCurrent, othersOnline } from '../model';
import { CreateJoin } from './Dialogs';

export function Home({ narrow }: { narrow: boolean }) {
  const { route, state, rec, peer, identity } = useCurrent();
  const workspaces = useApp((s) => s.workspaces);
  const app = useApp.getState();
  const menu = narrow && <div style={{ position: 'absolute', top: 10, left: 8 }}><IconButton icon="menu" label="Open sidebar" size="sm" onClick={() => useApp.setState({ drawer: true })} /></div>;

  if (route.code) {
    const n = othersOnline(peer, identity.pub);
    const relayed = peer?.transport.kind === 'nostr';
    return (
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32, textAlign: 'center' }}>
        {menu}
        <span style={{ display: 'flex', color: 'var(--accent)', animation: 'ag-spin 1.2s linear infinite' }}><Icon name="loader" size={28} /></span>
        <div style={{ font: '700 28px/1.1 var(--font-display)', letterSpacing: '-0.04em', color: 'var(--text-strong)' }}>{relayed ? 'Fetching ' : n ? 'Syncing ' : 'Looking for members of '}{state?.name || rec?.name || formatCode(route.code)}</div>
        <div style={{ fontSize: 14.5, color: 'var(--text-muted)', maxWidth: 440, textWrap: 'pretty' as any }}>
          {relayed ? (peer?.connected ? 'Downloading encrypted history from relays.' : 'Connecting to relays. Keep this tab open; it retries on its own.')
            : n ? 'Pulling channels and history from ' + n + (n === 1 ? ' member' : ' members') + '.' : 'Channels and history arrive once another member is online. Keep this tab open; it connects on its own.'}
        </div>
        <span style={{ font: '500 13px var(--font-mono)', color: 'var(--text-subtle)' }}>{formatCode(route.code)}</span>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: narrow ? '56px 16px 24px' : '72px 32px' }}>
      {menu}
      <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <h1 style={{ margin: 0, font: '700 44px/1 var(--font-display)', letterSpacing: '-0.045em', color: 'var(--text-strong)', textWrap: 'balance' as any }}>
          {workspaces.length ? 'Where to?' : 'Start your first workspace.'}
        </h1>
        {workspaces.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workspaces.map((w) => (
              <button key={w.code} type="button" onClick={() => app.go({ code: w.code })}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 20, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ flex: 1, font: '700 18px/1.2 var(--font-display)', letterSpacing: '-0.03em', color: 'var(--text-strong)' }}>{w.name}</span>
                <span style={{ font: '400 12px var(--font-mono)', color: 'var(--text-subtle)' }}>{formatCode(w.code)}</span>
                <Icon name="arrow-right" size={18} style={{ color: 'var(--text-subtle)' }} />
              </button>
            ))}
          </div>
        )}
        <div style={{ padding: 24, borderRadius: 28, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
          <CreateJoin />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-subtle)' }}>
          <Icon name="sparkles" size={16} style={{ color: 'var(--agent-ink)' }} />
          <span style={{ flex: 1 }}>Want agents in your rooms? They’re optional and run on your machine.</span>
          <Button variant="ghost" size="sm" onClick={() => app.setDialog('bridge')}>Set up</Button>
        </div>
      </div>
    </div>
  );
}

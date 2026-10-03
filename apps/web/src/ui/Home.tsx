import type React from 'react';
import { Button, Icon, IconButton } from '@yurt/ui';
import { formatCode } from '@yurt/protocol';
import { useApp } from '../store';
import { useCurrent } from '../model';
import { CreateJoin } from './Dialogs';

/** What a joined workspace's page says while its channels and history are still arriving. */
const syncingText = (connected: boolean): { verb: string; detail: string } => ({
  verb: 'Fetching ',
  detail: connected ? 'Downloading encrypted history from relays.' : 'Connecting to relays. Keep this tab open; it retries on its own.',
});

function Joining({ code, menu }: { code: string; menu: React.ReactNode }) {
  const { state, rec, peer } = useCurrent();
  const text = syncingText(!!peer?.connected);
  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 32,
        textAlign: 'center',
      }}
    >
      {menu}
      <span style={{ display: 'flex', color: 'var(--accent)', animation: 'ag-spin 1.2s linear infinite' }}>
        <Icon name="loader" size={28} />
      </span>
      <div style={{ font: '700 28px/1.1 var(--font-display)', letterSpacing: '-0.04em', color: 'var(--text-strong)' }}>
        {text.verb}
        {state?.name || rec?.name || formatCode(code)}
      </div>
      <div style={{ fontSize: 14.5, color: 'var(--text-muted)', maxWidth: 440, textWrap: 'pretty' }}>{text.detail}</div>
      <span style={{ font: '500 13px var(--font-mono)', color: 'var(--text-subtle)' }}>{formatCode(code)}</span>
    </div>
  );
}

/** Workspaces I asked to join: an admin has to let me in. */
function Waiting() {
  const joins = useApp((s) => s.joins);
  if (!joins.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {joins.map((j) => (
        <div
          key={j.code}
          data-testid="join-pending"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderRadius: 20,
            border: '1px dashed var(--border-strong)',
            background: 'var(--surface-card)',
          }}
        >
          <span style={{ display: 'flex', color: 'var(--accent)', animation: 'ag-spin 1.2s linear infinite' }}>
            <Icon name="loader" size={18} />
          </span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: '700 16px/1.2 var(--font-display)', color: 'var(--text-strong)' }}>Asked to join {formatCode(j.code)}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Waiting for an admin to let you in. You can close this tab; it picks up where it left off.</span>
          </span>
          <Button size="sm" variant="ghost" data-testid="join-cancel" onClick={() => useApp.getState().cancelJoin(j.code)}>
            Cancel
          </Button>
        </div>
      ))}
    </div>
  );
}

export function Home({ narrow }: { narrow: boolean }) {
  const { route } = useCurrent();
  const workspaces = useApp((s) => s.workspaces);
  const app = useApp.getState();
  const menu = narrow && (
    <div style={{ position: 'absolute', top: 10, left: 8 }}>
      <IconButton icon="menu" label="Open sidebar" size="sm" onClick={() => useApp.setState({ drawer: true })} />
    </div>
  );

  if (route.code) return <Joining code={route.code} menu={menu} />;

  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: narrow ? '56px 16px 24px' : '72px 32px' }}>
      {menu}
      <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <h1 style={{ margin: 0, font: '700 44px/1 var(--font-display)', letterSpacing: '-0.045em', color: 'var(--text-strong)', textWrap: 'balance' }}>
          {workspaces.length ? 'Where to?' : 'Start your first workspace.'}
        </h1>
        <Waiting />
        {workspaces.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workspaces.map((w) => (
              <button
                key={w.code}
                type="button"
                onClick={() => app.go({ code: w.code })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 20,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface-card)',
                  boxShadow: 'var(--shadow-sm)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
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
          <Button variant="ghost" size="sm" onClick={() => app.openSettings('agents')}>
            Set up
          </Button>
        </div>
      </div>
    </div>
  );
}

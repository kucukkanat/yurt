import { IconButton } from '@yurt/ui';
import { useApp } from '../store';
import { unreadEverywhere } from '../model';
import { menuCount, menuLabel } from '../lib/alerts';

/**
 * The narrow screen's "Open sidebar" button. What's unread elsewhere (any workspace, not the conversation on screen)
 * shows on it: a count of messages that alert me, else a dot for anything new. The label says the same.
 */
export function MenuButton() {
  // Two primitive selections: a fresh object from a selector would re-render on every store change.
  const m = useApp((s) => unreadEverywhere(s, true).m);
  const n = useApp((s) => unreadEverywhere(s, true).n);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <IconButton icon="menu" label={menuLabel({ m, n })} size="sm" data-testid="menu-button" onClick={() => useApp.setState({ drawer: true })} />
      {(m > 0 || n) && (
        <span
          aria-hidden="true"
          data-testid="menu-unread"
          style={{
            position: 'absolute',
            top: m > 0 ? -4 : 2,
            right: m > 0 ? -4 : 2,
            minWidth: m > 0 ? 16 : 8,
            height: m > 0 ? 16 : 8,
            padding: m > 0 ? '0 4px' : 0,
            boxSizing: 'border-box',
            borderRadius: 'var(--radius-pill)',
            background: m > 0 ? 'var(--human)' : 'var(--accent)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: '16px',
            textAlign: 'center',
            boxShadow: '0 0 0 2px var(--surface-page)',
            pointerEvents: 'none',
          }}
        >
          {m > 0 ? menuCount(m) : null}
        </span>
      )}
    </span>
  );
}

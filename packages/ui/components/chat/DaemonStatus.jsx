import React from 'react';
import { Icon } from '../core/Icon.jsx';

const S = {
  connected: { dot: 'var(--volt-400)', label: 'Agents ready' },
  connecting: { dot: null, label: 'Looking for bridge' },
  missing: { dot: 'transparent', label: 'Agents off' },
};

export function DaemonStatus({ status = 'connected', version, port, agents, onClick, style }) {
  const s = S[status] || S.missing;
  const [h, setH] = React.useState(false);
  const detail = status === 'connected' ? [version && 'v' + version, port && ':' + port].filter(Boolean).join(' · ') : status === 'missing' ? 'Set up' : '';
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => setH(true)}
      onPointerLeave={() => setH(false)}
      aria-label={'Local agent daemon: ' + s.label + (detail ? ', ' + detail : '')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 32,
        padding: '0 10px',
        width: '100%',
        border: '1px solid var(--border-subtle)',
        borderRadius: 999,
        cursor: 'pointer',
        background: h ? 'var(--surface-hover)' : 'transparent',
        color: 'var(--text-muted)',
        font: '500 12.5px/1 var(--font-body)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        transition: 'background var(--dur-instant)',
        ...style,
      }}
    >
      {status === 'connecting' ? (
        <span style={{ display: 'flex', color: 'var(--text-subtle)', animation: 'ag-spin 1s linear infinite' }}>
          <Icon name="loader" size={12} strokeWidth={2.5} />
        </span>
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 9,
            background: s.dot,
            boxShadow: status === 'missing' ? 'inset 0 0 0 1.5px var(--ink-500)' : '0 0 0 3px rgba(210,255,46,.18)',
          }}
        />
      )}
      <span style={{ color: 'var(--text-body)' }}>{s.label}</span>
      {agents != null && status === 'connected' && <span style={{ color: 'var(--text-subtle)' }}>{agents}</span>}
      <span style={{ flex: 1 }} />
      {detail && (
        <span
          style={{
            fontFamily: status === 'connected' ? 'var(--font-mono)' : 'var(--font-body)',
            fontSize: status === 'connected' ? 11 : 12.5,
            fontWeight: status === 'missing' ? 600 : 400,
            color: status === 'missing' ? 'var(--accent)' : 'var(--text-subtle)',
          }}
        >
          {detail}
        </span>
      )}
    </button>
  );
}

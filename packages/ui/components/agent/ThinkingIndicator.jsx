import React from 'react';

export function ThinkingIndicator({ label = 'Thinking', detail, variant = 'dots', size = 'md', style }) {
  const d = size === 'sm' ? 5 : 7;
  return (
    <span role="status" aria-live="polite" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, ...style }}>
      {variant === 'dots' && (
        <span aria-hidden="true" style={{ display: 'inline-flex', gap: d * 0.6, alignItems: 'center', height: d * 2.4, padding: '0 ' + d + 'px', borderRadius: 99, background: 'var(--ink-900)' }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: d, height: d, borderRadius: 99, background: 'var(--volt-400)', animation: 'ag-dot 1.1s var(--ease-in-out) ' + i * 0.14 + 's infinite' }} />
          ))}
        </span>
      )}
      {variant === 'orb' && (
        <span aria-hidden="true" style={{ width: d * 2.2, height: d * 2.2, borderRadius: 99, background: 'var(--volt-400)', boxShadow: '0 0 0 2px var(--ink-900) inset', animation: 'ag-pulse 1.4s var(--ease-out) infinite' }} />
      )}
      {label && (
        <span style={{
          fontSize: size === 'sm' ? 13 : 14, fontWeight: 500,
          background: 'linear-gradient(90deg, var(--text-muted) 0%, var(--text-muted) 35%, var(--text-strong) 50%, var(--text-muted) 65%, var(--text-muted) 100%)',
          backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          animation: 'ag-shimmer 2.2s linear infinite',
        }}>{label}{detail && <span style={{ fontWeight: 400 }}> · {detail}</span>}</span>
      )}
    </span>
  );
}

import React from 'react';
import { useInteraction, mergeHandlers, shadows } from '../core/useInteraction.js';

export function SourceChip({ index, title, domain, href = '#', verified = false, style }) {
  const [st, h] = useInteraction(false);
  return (
    <a href={href} target="_blank" rel="noreferrer" title={title} {...mergeHandlers(h, {})}
      aria-label={'Source ' + index + ': ' + (title || domain)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px 0 3px', verticalAlign: 'middle',
        borderRadius: 99, background: st.hover ? 'var(--accent-soft)' : 'var(--surface-sunken)', color: st.hover ? 'var(--accent-soft-ink)' : 'var(--text-muted)',
        fontSize: 12, fontWeight: 500, textDecoration: 'none', outline: 'none', boxShadow: shadows(st.focus && 'var(--focus-ring)'),
        transform: st.hover ? 'translateY(-1px)' : 'none', transition: 'all var(--dur-fast) var(--ease-spring)', ...style,
      }}>
      <span style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: st.hover ? 'var(--accent)' : 'var(--ink-900)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, transition: 'background var(--dur-fast)' }}>{index}</span>
      {domain}
      {verified && <span aria-label="verified" style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--success)' }} />}
    </a>
  );
}

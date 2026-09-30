import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { useInteraction, mergeHandlers, shadows } from '../core/useInteraction.js';

export function Tag({ children, icon, selected = false, onClick, onRemove, removeLabel, disabled = false, style }) {
  const [st, h] = useInteraction(disabled);
  const [rm, rh] = useInteraction(disabled);
  const interactive = !!onClick;
  const El = interactive ? 'button' : 'span';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', animation: 'ag-pop var(--dur-slow) var(--ease-spring)', ...style }}>
      <El
        type={interactive ? 'button' : undefined} onClick={onClick} disabled={interactive ? disabled : undefined}
        aria-pressed={interactive ? selected : undefined}
        {...(interactive ? mergeHandlers(h, {}) : {})}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: onRemove ? '0 6px 0 10px' : '0 12px',
          borderRadius: 'var(--radius-pill)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, lineHeight: 1,
          color: selected ? 'var(--text-inverse)' : 'var(--text-body)',
          background: selected ? 'var(--surface-inverse)' : st.hover ? 'var(--surface-sunken)' : 'var(--surface-card)',
          border: '1px solid ' + (selected ? 'var(--surface-inverse)' : 'var(--border-default)'),
          boxShadow: shadows(st.focus && 'var(--focus-ring)'), outline: 'none',
          cursor: interactive && !disabled ? 'pointer' : 'default', opacity: disabled ? 0.45 : 1,
          transform: st.press ? 'scale(.96)' : 'none', transition: 'all var(--dur-fast) var(--ease-spring)',
        }}
      >
        {selected && interactive && <Icon name="check" size={14} strokeWidth={2.5} style={{ animation: 'ag-pop var(--dur-base) var(--ease-spring)' }} />}
        {icon && !(selected && interactive) && <Icon name={icon} size={14} />}
        <span>{children}</span>
        {onRemove && (
          <span
            role="button" tabIndex={0} aria-label={removeLabel || 'Remove ' + (typeof children === 'string' ? children : '')}
            onClick={(e) => { e.stopPropagation(); onRemove(e); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onRemove(e); } }}
            {...mergeHandlers(rh, {})}
            style={{
              width: 20, height: 20, borderRadius: 99, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: rm.hover ? 'var(--surface-press)' : 'transparent', color: 'var(--text-muted)', cursor: 'pointer', outline: 'none',
              boxShadow: shadows(rm.focus && 'var(--focus-ring)'), transition: 'background var(--dur-fast)',
            }}
          ><Icon name="x" size={12} strokeWidth={2.5} /></span>
        )}
      </El>
    </span>
  );
}

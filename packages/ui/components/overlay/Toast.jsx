import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../actions/IconButton.jsx';

const T = {
  neutral: { icon: 'info', c: 'var(--ink-300)' },
  success: { icon: 'circle-check', c: 'var(--green-500)' },
  agent: { icon: 'sparkles', c: 'var(--volt-400)' },
  human: { icon: 'hand', c: 'var(--coral-400)' },
  danger: { icon: 'circle-alert', c: 'var(--red-500)' },
};

export function Toast({ tone = 'neutral', title, description, actionLabel, onAction, onClose, duration = 0, icon, style }) {
  const t = T[tone] || T.neutral;
  const [paused, setPaused] = React.useState(false);
  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        width: 380,
        maxWidth: '100%',
        padding: '14px 12px 14px 16px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--ink-900)',
        color: 'var(--ink-50)',
        boxShadow: 'var(--shadow-lg)',
        animation: 'ag-toast-in var(--dur-slow) var(--ease-spring)',
        ...style,
      }}
    >
      <Icon name={icon || t.icon} size={18} color={t.c} style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.35 }}>{title}</div>
        {description && <div style={{ fontSize: 13, color: 'var(--ink-300)', marginTop: 2, lineHeight: 1.4 }}>{description}</div>}
      </div>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          style={{
            flexShrink: 0,
            height: 28,
            padding: '0 10px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,.18)',
            background: 'rgba(255,255,255,.08)',
            color: '#fff',
            font: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {/undo/i.test(actionLabel) && <Icon name="undo-2" size={14} />}
          {actionLabel}
        </button>
      )}
      {onClose && (
        <IconButton
          icon="x"
          label="Dismiss"
          size="sm"
          variant="inverse"
          onClick={onClose}
          style={{ width: 28, height: 28, background: 'transparent', boxShadow: 'none', color: 'var(--ink-300)' }}
        />
      )}
      {duration > 0 && (
        <span
          aria-hidden="true"
          onAnimationEnd={() => onClose?.()}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 3,
            background: t.c,
            transformOrigin: 'left',
            animation: 'ag-shrink ' + duration + 'ms linear forwards',
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      )}
    </div>
  );
}

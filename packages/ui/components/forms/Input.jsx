import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { shadows } from '../core/useInteraction.js';

const H = { sm: 32, md: 40, lg: 48 };

export function FieldShell({ id, label, hint, error, optional, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {label && (
        <label htmlFor={id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, font: 'var(--type-label)', color: 'var(--text-strong)' }}>
          <span>{label}</span>
          {optional && <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>Optional</span>}
        </label>
      )}
      {children}
      {(error || hint) && (
        <div
          id={id + '-msg'}
          role={error ? 'alert' : undefined}
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'flex-start',
            fontSize: 12.5,
            lineHeight: 1.4,
            color: error ? 'var(--danger-ink)' : 'var(--text-subtle)',
            animation: error ? 'ag-rise var(--dur-base) var(--ease-spring)' : 'none',
          }}
        >
          {error && <Icon name="circle-alert" size={14} style={{ marginTop: 1 }} />}
          <span>{error || hint}</span>
        </div>
      )}
    </div>
  );
}

export function Input({ label, hint, error, optional, iconLeft, suffix, size = 'md', id, disabled, style, onFocus, onBlur, ...rest }) {
  const auto = React.useId();
  const fid = id || auto;
  const [focus, setFocus] = React.useState(false);
  const bd = error ? 'var(--danger)' : focus ? 'var(--accent)' : 'var(--border-default)';
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} optional={optional}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: H[size],
          padding: '0 12px',
          borderRadius: 'var(--radius-sm)',
          background: disabled ? 'var(--surface-sunken)' : 'var(--surface-card)',
          border: '1px solid ' + bd,
          boxShadow: shadows(focus && (error ? '0 0 0 3px var(--danger-soft)' : '0 0 0 3px var(--accent-soft)'), !focus && 'var(--shadow-xs)'),
          transition: 'border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
          opacity: disabled ? 0.6 : 1,
          ...style,
        }}
      >
        {iconLeft && <Icon name={iconLeft} size={17} color={focus ? 'var(--accent)' : 'var(--text-subtle)'} style={{ transition: 'color var(--dur-fast)' }} />}
        <input
          id={fid}
          disabled={disabled}
          aria-invalid={!!error || undefined}
          aria-describedby={error || hint ? fid + '-msg' : undefined}
          onFocus={(e) => {
            setFocus(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            onBlur?.(e);
          }}
          {...rest}
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            border: 0,
            outline: 'none',
            background: 'transparent',
            font: 'inherit',
            fontSize: size === 'lg' ? 16 : 14.5,
            color: 'var(--text-strong)',
            boxShadow: 'none',
          }}
        />
        {suffix}
      </div>
    </FieldShell>
  );
}

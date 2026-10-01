import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { FieldShell } from './Input.jsx';
import { shadows } from '../core/useInteraction.js';

export function Select({ label, hint, error, options = [], value, defaultValue, onChange, placeholder, size = 'md', id, disabled, style, ...rest }) {
  const auto = React.useId();
  const fid = id || auto;
  const [focus, setFocus] = React.useState(false);
  const h = { sm: 32, md: 40, lg: 48 }[size];
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error}>
      <div style={{ position: 'relative', ...style }}>
        <select
          id={fid}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={!!error || undefined}
          aria-describedby={error || hint ? fid + '-msg' : undefined}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          {...rest}
          style={{
            width: '100%',
            height: h,
            appearance: 'none',
            WebkitAppearance: 'none',
            padding: '0 38px 0 12px',
            font: 'inherit',
            fontSize: 14.5,
            color: 'var(--text-strong)',
            background: disabled ? 'var(--surface-sunken)' : 'var(--surface-card)',
            border: '1px solid ' + (error ? 'var(--danger)' : focus ? 'var(--accent)' : 'var(--border-default)'),
            borderRadius: 'var(--radius-sm)',
            boxShadow: shadows(focus && '0 0 0 3px var(--accent-soft)', !focus && 'var(--shadow-xs)'),
            outline: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
            transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
          }}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => {
            const opt = typeof o === 'string' ? { value: o, label: o } : o;
            return (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            );
          })}
        </select>
        <Icon
          name="chevron-down"
          size={16}
          color="var(--text-muted)"
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            pointerEvents: 'none',
            transform: 'translateY(-50%) rotate(' + (focus ? 180 : 0) + 'deg)',
            transition: 'transform var(--dur-base) var(--ease-spring)',
          }}
        />
      </div>
    </FieldShell>
  );
}

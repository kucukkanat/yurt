import React from 'react';
import { shadows } from '../core/useInteraction.js';

export function Checkbox({ label, description, checked, defaultChecked, indeterminate = false, onChange, disabled, id, style, ...rest }) {
  const auto = React.useId();
  const fid = id || auto;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = checked !== undefined ? checked : inner;
  const [focus, setFocus] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const filled = on || indeterminate;
  return (
    <label
      htmlFor={fid}
      style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, minHeight: 24, ...style }}
    >
      <span style={{ position: 'relative', width: 20, height: 20, marginTop: 1, flexShrink: 0 }}>
        <input
          ref={ref}
          id={fid}
          type="checkbox"
          checked={on}
          disabled={disabled}
          onChange={(e) => {
            setInner(e.target.checked);
            onChange && onChange(e);
          }}
          onFocus={(e) => {
            let fv = true;
            try {
              fv = e.target.matches(':focus-visible');
            } catch (_) {}
            setFocus(fv);
          }}
          onBlur={() => setFocus(false)}
          {...rest}
          style={{ position: 'absolute', inset: 0, margin: 0, opacity: 0, cursor: 'inherit' }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            background: filled ? 'var(--accent)' : 'var(--surface-card)',
            border: '1.5px solid ' + (filled ? 'var(--accent)' : 'var(--ink-300)'),
            boxShadow: shadows(focus && 'var(--focus-ring)'),
            transform: filled ? 'scale(1)' : 'scale(.94)',
            transition: 'background var(--dur-fast), border-color var(--dur-fast), transform var(--dur-base) var(--ease-snap)',
          }}
        >
          {on && !indeterminate && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" strokeDasharray="24" style={{ animation: 'ag-draw var(--dur-base) var(--ease-out) both' }} />
            </svg>
          )}
          {indeterminate && <span style={{ width: 10, height: 2.5, borderRadius: 2, background: '#fff' }} />}
        </span>
      </span>
      {(label || description) && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {label && <span style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-strong)', lineHeight: '22px' }}>{label}</span>}
          {description && <span style={{ fontSize: 13, color: 'var(--text-subtle)', lineHeight: 1.4 }}>{description}</span>}
        </span>
      )}
    </label>
  );
}

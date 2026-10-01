import React from 'react';
import { shadows } from '../core/useInteraction.js';

export function Radio({ label, description, name, value, checked, defaultChecked, onChange, disabled, id, style, ...rest }) {
  const auto = React.useId();
  const fid = id || auto;
  const [focus, setFocus] = React.useState(false);
  const ref = React.useRef(null);
  const [, force] = React.useState(0);
  const on = checked !== undefined ? checked : ref.current ? ref.current.checked : !!defaultChecked;
  React.useEffect(() => {
    if (checked !== undefined || !name) return;
    const f = () => force((n) => n + 1);
    document.addEventListener('change', f);
    return () => document.removeEventListener('change', f);
  }, [checked, name]);
  return (
    <label htmlFor={fid} style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}>
      <span style={{ position: 'relative', width: 20, height: 20, marginTop: 1, flexShrink: 0 }}>
        <input
          ref={ref}
          id={fid}
          type="radio"
          name={name}
          value={value}
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          onChange={(e) => {
            force((n) => n + 1);
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
            borderRadius: 99,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface-card)',
            border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--ink-300)'),
            boxShadow: shadows(focus && 'var(--focus-ring)'),
            transition: 'border-color var(--dur-fast)',
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 99,
              background: 'var(--accent)',
              transform: on ? 'scale(1)' : 'scale(0)',
              transition: 'transform var(--dur-base) var(--ease-snap)',
            }}
          />
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

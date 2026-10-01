import React from 'react';
import { shadows } from '../core/useInteraction.js';
import { ChoiceLabel, HIDDEN_INPUT, useChoice } from './Choice.jsx';

export function Checkbox({ label, description, checked, defaultChecked, indeterminate = false, onChange, disabled, id, style, ...rest }) {
  const { fid, on, setInner, focus, focusHandlers } = useChoice({ id, checked, defaultChecked });
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const filled = on || indeterminate;
  return (
    <ChoiceLabel htmlFor={fid} disabled={disabled} style={{ minHeight: 24, ...style }} label={label} description={description}>
      <input
        ref={ref}
        id={fid}
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => {
          setInner(e.target.checked);
          onChange?.(e);
        }}
        {...focusHandlers}
        {...rest}
        style={HIDDEN_INPUT}
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
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" strokeDasharray="24" style={{ animation: 'ag-draw var(--dur-base) var(--ease-out) both' }} />
          </svg>
        )}
        {indeterminate && <span style={{ width: 10, height: 2.5, borderRadius: 2, background: '#fff' }} />}
      </span>
    </ChoiceLabel>
  );
}

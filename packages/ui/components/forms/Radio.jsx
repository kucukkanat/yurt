import React from 'react';
import { shadows, useFocusVisible } from '../core/useInteraction.js';
import { ChoiceLabel, HIDDEN_INPUT } from './Choice.jsx';

export function Radio({ label, description, name, value, checked, defaultChecked, onChange, disabled, id, style, ...rest }) {
  const auto = React.useId();
  const fid = id || auto;
  const [focus, focusHandlers] = useFocusVisible();
  const ref = React.useRef(null);
  const [, force] = React.useState(0);
  const on = checked !== undefined ? checked : ref.current ? ref.current.checked : !!defaultChecked;
  // Uncontrolled radios don't hear about a sibling in their group being picked; re-read on any change.
  React.useEffect(() => {
    if (checked !== undefined || !name) return;
    const f = () => force((n) => n + 1);
    document.addEventListener('change', f);
    return () => document.removeEventListener('change', f);
  }, [checked, name]);
  return (
    <ChoiceLabel htmlFor={fid} disabled={disabled} style={style} label={label} description={description}>
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
    </ChoiceLabel>
  );
}

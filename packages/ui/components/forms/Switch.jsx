import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { shadows } from '../core/useInteraction.js';
import { ChoiceText, useChoice } from './Choice.jsx';

const SIZES = { sm: { w: 32, h: 18, top: 2, line: '22px' }, md: { w: 40, h: 24, top: 0, line: '24px' } };
const TRACK = { accent: 'var(--accent)', agent: 'var(--volt-400)' };
const MARK = { accent: 'var(--accent)', agent: 'var(--volt-700)' };

/** The thumb: stretches by 4px while pressed and slides across when on. */
function Thumb({ on, press, tone, size }) {
  const { w, h } = SIZES[size];
  const k = h - 6;
  const stretch = press ? 4 : 0;
  return (
    <span
      style={{
        position: 'absolute',
        top: 3,
        left: 3,
        height: k,
        width: k + stretch,
        borderRadius: 99,
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: 'translateX(' + (on ? w - k - 6 - stretch : 0) + 'px)',
        transition: 'transform var(--dur-slow) var(--ease-spring), width var(--dur-fast) var(--ease-out)',
      }}
    >
      {size !== 'sm' && <Icon name={on ? 'check' : 'x'} size={11} strokeWidth={3} color={on ? MARK[tone] : 'var(--ink-400)'} />}
    </span>
  );
}

export function Switch({ checked, defaultChecked, onChange, label, description, tone = 'accent', size = 'md', disabled, id, style, ...rest }) {
  const { fid, on, setInner, focus, focusHandlers } = useChoice({ id, checked, defaultChecked });
  const [press, setPress] = React.useState(false);
  const { w, h, top, line } = SIZES[size] || SIZES.md;
  const toggle = () => {
    if (disabled) return;
    setInner(!on);
    onChange?.(!on);
  };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 10, opacity: disabled ? 0.5 : 1, ...style }}>
      <button
        {...rest}
        id={fid}
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={toggle}
        {...focusHandlers}
        onPointerDown={() => setPress(true)}
        onPointerUp={() => setPress(false)}
        onPointerLeave={() => setPress(false)}
        style={{
          position: 'relative',
          width: w,
          height: h,
          flexShrink: 0,
          borderRadius: 99,
          border: 0,
          padding: 0,
          marginTop: top,
          background: on ? TRACK[tone] : 'var(--ink-200)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          boxShadow: shadows(focus && 'var(--focus-ring)', 'inset 0 1px 2px rgba(0,0,0,.12)'),
          transition: 'background var(--dur-base) var(--ease-out)',
        }}
      >
        <Thumb on={on} press={press} tone={tone} size={size === 'sm' ? 'sm' : 'md'} />
      </button>
      {(label || description) && (
        <label htmlFor={fid} style={{ display: 'flex', flexDirection: 'column', gap: 2, cursor: disabled ? 'not-allowed' : 'pointer' }}>
          <ChoiceText label={label} description={description} lineHeight={line} />
        </label>
      )}
    </div>
  );
}

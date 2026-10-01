import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { shadows } from '../core/useInteraction.js';

export function Switch({ checked, defaultChecked, onChange, label, description, tone = 'accent', size = 'md', disabled, id, style, ...rest }) {
  const auto = React.useId();
  const fid = id || auto;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = checked !== undefined ? checked : inner;
  const [focus, setFocus] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const w = size === 'sm' ? 32 : 40,
    h = size === 'sm' ? 18 : 24,
    k = h - 6;
  const track = on ? (tone === 'agent' ? 'var(--volt-400)' : 'var(--accent)') : 'var(--ink-200)';
  const toggle = () => {
    if (disabled) return;
    setInner(!on);
    onChange && onChange(!on);
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
        onFocus={(e) => {
          let fv = true;
          try {
            fv = e.target.matches(':focus-visible');
          } catch (_) {}
          setFocus(fv);
        }}
        onBlur={() => setFocus(false)}
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
          marginTop: size === 'sm' ? 2 : 0,
          background: track,
          cursor: disabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          boxShadow: shadows(focus && 'var(--focus-ring)', 'inset 0 1px 2px rgba(0,0,0,.12)'),
          transition: 'background var(--dur-base) var(--ease-out)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: 3,
            height: k,
            width: press ? k + 4 : k,
            borderRadius: 99,
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'translateX(' + (on ? w - k - 6 - (press ? 4 : 0) : 0) + 'px)',
            transition: 'transform var(--dur-slow) var(--ease-spring), width var(--dur-fast) var(--ease-out)',
          }}
        >
          {size !== 'sm' && <Icon name={on ? 'check' : 'x'} size={11} strokeWidth={3} color={on ? (tone === 'agent' ? 'var(--volt-700)' : 'var(--accent)') : 'var(--ink-400)'} />}
        </span>
      </button>
      {(label || description) && (
        <label htmlFor={fid} style={{ display: 'flex', flexDirection: 'column', gap: 2, cursor: disabled ? 'not-allowed' : 'pointer' }}>
          {label && <span style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-strong)', lineHeight: size === 'sm' ? '22px' : '24px' }}>{label}</span>}
          {description && <span style={{ fontSize: 13, color: 'var(--text-subtle)', lineHeight: 1.4 }}>{description}</span>}
        </label>
      )}
    </div>
  );
}

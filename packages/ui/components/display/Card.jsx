import React from 'react';
import { useInteraction, mergeHandlers, shadows } from '../core/useInteraction.js';

const V = {
  default: { bg: 'var(--surface-card)', bd: 'var(--border-subtle)', sh: 'var(--shadow-sm)', fg: 'var(--text-body)' },
  outline: { bg: 'transparent', bd: 'var(--border-default)', sh: null, fg: 'var(--text-body)' },
  sunken: { bg: 'var(--surface-sunken)', bd: 'transparent', sh: null, fg: 'var(--text-body)' },
  inverse: { bg: 'var(--surface-inverse)', bd: 'transparent', sh: 'var(--shadow-md)', fg: 'var(--text-inverse)' },
  agent: { bg: 'var(--agent-soft)', bd: 'transparent', sh: null, fg: 'var(--text-body)' },
};
const P = { none: 0, sm: 12, md: 20, lg: 28 };

export function Card({ variant = 'default', padding = 'md', interactive = false, as, onClick, children, style, ...rest }) {
  const v = V[variant] || V.default;
  const [st, h] = useInteraction(!interactive);
  const El = as || (interactive ? 'button' : 'div');
  return (
    <El
      type={El === 'button' ? 'button' : undefined} onClick={onClick}
      {...rest} {...(interactive ? mergeHandlers(h, rest) : {})}
      style={{
        display: 'block', textAlign: 'left', width: El === 'button' ? '100%' : undefined, font: 'inherit',
        background: v.bg, color: v.fg, border: '1px solid ' + v.bd, borderRadius: 'var(--radius-lg)', padding: P[padding] ?? padding,
        boxShadow: shadows(st.focus && 'var(--focus-ring)', interactive && st.hover ? 'var(--shadow-md)' : v.sh),
        transform: interactive ? (st.press ? 'scale(.99)' : st.hover ? 'translateY(-2px)' : 'none') : undefined,
        transition: 'transform var(--dur-base) var(--ease-spring), box-shadow var(--dur-base) var(--ease-out)',
        cursor: interactive ? 'pointer' : undefined, outline: 'none', ...style,
      }}
    >{children}</El>
  );
}

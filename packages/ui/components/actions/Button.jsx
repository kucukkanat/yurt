import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Kbd } from '../core/Kbd.jsx';
import { useInteraction, mergeHandlers, shadows } from '../core/useInteraction.js';

const SIZES = {
  sm: { h: 32, px: 12, fs: 13, gap: 6, icon: 16, r: 'var(--radius-sm)' },
  md: { h: 40, px: 16, fs: 14, gap: 8, icon: 18, r: 'var(--radius-sm)' },
  lg: { h: 48, px: 20, fs: 16, gap: 10, icon: 20, r: 'var(--radius-md)' },
};
export const BUTTON_VARIANTS = {
  primary: {
    bg: 'var(--accent)',
    hover: 'var(--accent-hover)',
    press: 'var(--accent-press)',
    fg: 'var(--text-on-accent)',
    bd: 'transparent',
    lip: 'var(--shadow-lip)',
    kbd: 'onAccent',
  },
  agent: { bg: 'var(--volt-400)', hover: 'var(--volt-300)', press: 'var(--volt-500)', fg: 'var(--ink-950)', bd: 'transparent', lip: 'var(--shadow-lip)', kbd: 'onAgent' },
  secondary: {
    bg: 'var(--surface-card)',
    hover: 'var(--surface-sunken)',
    press: 'var(--surface-sunken)',
    fg: 'var(--text-strong)',
    bd: 'var(--border-default)',
    lip: 'var(--shadow-lip-light)',
    kbd: 'default',
  },
  ghost: { bg: 'transparent', hover: 'var(--surface-hover)', press: 'var(--surface-press)', fg: 'var(--text-body)', bd: 'transparent', lip: null, kbd: 'default' },
  inverse: {
    bg: 'var(--surface-inverse)',
    hover: 'var(--ink-800)',
    press: 'var(--ink-950)',
    fg: 'var(--text-inverse)',
    bd: 'transparent',
    lip: 'var(--shadow-lip)',
    kbd: 'inverse',
  },
  danger: { bg: 'var(--danger)', hover: 'var(--red-700)', press: 'var(--red-700)', fg: '#fff', bd: 'transparent', lip: 'var(--shadow-lip)', kbd: 'onAccent' },
};

export function Button({
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  loading = false,
  disabled = false,
  kbd,
  fullWidth = false,
  type = 'button',
  children,
  style,
  ...rest
}) {
  const v = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary;
  const s = SIZES[size] || SIZES.md;
  const off = disabled || loading;
  const [st, h] = useInteraction(off);
  const bg = off ? v.bg : st.press ? v.press : st.hover ? v.hover : v.bg;
  const transform = off ? 'none' : st.press ? 'translateY(1px) scale(.98)' : st.hover ? 'translateY(-1px)' : 'none';
  return (
    <button
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={off || undefined}
      {...rest}
      {...mergeHandlers(h, rest)}
      style={{
        position: 'relative',
        display: fullWidth ? 'flex' : 'inline-flex',
        width: fullWidth ? '100%' : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        height: s.h,
        padding: '0 ' + s.px + 'px',
        fontFamily: 'var(--font-body)',
        fontSize: s.fs,
        fontWeight: 600,
        letterSpacing: '-0.005em',
        whiteSpace: 'nowrap',
        color: v.fg,
        background: bg,
        border: '1px solid ' + v.bd,
        borderRadius: s.r,
        boxShadow: shadows(st.focus && 'var(--focus-ring)', !st.press && v.lip),
        opacity: disabled ? 0.45 : 1,
        cursor: off ? (loading ? 'progress' : 'not-allowed') : 'pointer',
        transform,
        transition: 'transform var(--dur-fast) var(--ease-spring), background var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
        outline: 'none',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      {loading ? <Icon name="loader" size={s.icon} style={{ animation: 'ag-spin 800ms linear infinite' }} /> : iconLeft && <Icon name={iconLeft} size={s.icon} />}
      {children && <span>{children}</span>}
      {iconRight && !loading && (
        <Icon name={iconRight} size={s.icon} style={{ transition: 'transform var(--dur-base) var(--ease-spring)', transform: st.hover ? 'translateX(2px)' : 'none' }} />
      )}
      {kbd && <Kbd keys={kbd} tone={v.kbd} size="sm" style={{ marginRight: -4 }} />}
    </button>
  );
}

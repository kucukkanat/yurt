import { Icon } from '../core/Icon.jsx';
import { BUTTON_VARIANTS } from './Button.jsx';
import { useInteraction, mergeHandlers, shadows } from '../core/useInteraction.js';

const SZ = { sm: [32, 16, 'var(--radius-sm)'], md: [40, 18, 'var(--radius-sm)'], lg: [48, 20, 'var(--radius-md)'] };

export function IconButton({ icon, label, variant = 'ghost', size = 'md', active = false, disabled = false, round = false, style, ...rest }) {
  const v = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.ghost;
  const [h, is, r] = SZ[size] || SZ.md;
  const [st, hd] = useInteraction(disabled);
  const bg = active ? 'var(--accent-soft)' : st.press ? v.press : st.hover ? v.hover : v.bg;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={active || undefined}
      {...rest}
      {...mergeHandlers(hd, rest)}
      style={{
        width: h,
        height: h,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: active ? 'var(--accent-soft-ink)' : v.fg,
        background: bg,
        border: '1px solid ' + v.bd,
        borderRadius: round ? 'var(--radius-pill)' : r,
        padding: 0,
        boxShadow: shadows(st.focus && 'var(--focus-ring)', !st.press && v.lip),
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        outline: 'none',
        transform: disabled ? 'none' : st.press ? 'scale(.92)' : 'none',
        transition: 'transform var(--dur-fast) var(--ease-spring), background var(--dur-fast) var(--ease-out), color var(--dur-fast)',
        ...style,
      }}
    >
      <Icon name={icon} size={is} style={{ transition: 'transform var(--dur-base) var(--ease-spring)', transform: st.hover && !disabled ? 'scale(1.08)' : 'none' }} />
    </button>
  );
}

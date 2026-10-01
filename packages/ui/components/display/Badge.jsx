import { Icon } from '../core/Icon.jsx';

const TONES = {
  neutral: { soft: 'var(--surface-sunken)', ink: 'var(--text-muted)', solid: 'var(--ink-800)', on: '#fff', dot: 'var(--ink-400)' },
  accent: { soft: 'var(--accent-soft)', ink: 'var(--accent-soft-ink)', solid: 'var(--accent)', on: '#fff', dot: 'var(--accent)' },
  agent: { soft: 'var(--agent-soft)', ink: 'var(--agent-ink)', solid: 'var(--volt-400)', on: 'var(--ink-950)', dot: 'var(--volt-500)' },
  human: { soft: 'var(--human-soft)', ink: 'var(--human-ink)', solid: 'var(--human)', on: '#fff', dot: 'var(--human)' },
  success: { soft: 'var(--success-soft)', ink: 'var(--success-ink)', solid: 'var(--success)', on: '#fff', dot: 'var(--success)' },
  warning: { soft: 'var(--warning-soft)', ink: 'var(--warning-ink)', solid: 'var(--warning)', on: 'var(--ink-950)', dot: 'var(--warning)' },
  danger: { soft: 'var(--danger-soft)', ink: 'var(--danger-ink)', solid: 'var(--danger)', on: '#fff', dot: 'var(--danger)' },
};

export function Badge({ tone = 'neutral', variant = 'soft', dot = false, live = false, icon, size = 'md', children, style }) {
  const t = TONES[tone] || TONES.neutral;
  const solid = variant === 'solid';
  const sm = size === 'sm';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: sm ? 20 : 24,
        padding: sm ? '0 7px' : '0 9px',
        borderRadius: 'var(--radius-pill)',
        background: solid ? t.solid : t.soft,
        color: solid ? t.on : t.ink,
        fontFamily: 'var(--font-body)',
        fontSize: sm ? 11 : 12,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        boxShadow: variant === 'outline' ? 'inset 0 0 0 1px ' + t.dot : 'none',
        ...(variant === 'outline' ? { background: 'transparent' } : null),
        ...style,
      }}
    >
      {(dot || live) && (
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: 99, background: solid ? t.on : t.dot, animation: live ? 'ag-pulse 1.6s var(--ease-out) infinite' : 'none' }}
        />
      )}
      {icon && <Icon name={icon} size={sm ? 12 : 13} strokeWidth={2.25} />}
      {children}
    </span>
  );
}

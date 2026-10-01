import { Icon } from '../core/Icon.jsx';
import { useInteraction, shadows } from '../core/useInteraction.js';

function pillBackground(selected, hover) {
  if (selected) return 'var(--surface-inverse)';
  return hover ? 'var(--surface-sunken)' : 'var(--surface-card)';
}

/** The × of a removable tag: its own button (never nested in the tag's button), also answering Backspace and Delete. */
function RemoveButton({ label, disabled, onRemove }) {
  const [rm, rh] = useInteraction(disabled);
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onRemove(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          onRemove(e);
        }
      }}
      {...rh}
      style={{
        width: 20,
        height: 20,
        margin: '0 6px',
        padding: 0,
        border: 0,
        borderRadius: 99,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: rm.hover ? 'var(--surface-press)' : 'transparent',
        color: 'var(--text-muted)',
        cursor: disabled ? 'default' : 'pointer',
        outline: 'none',
        boxShadow: shadows(rm.focus && 'var(--focus-ring)'),
        transition: 'background var(--dur-fast)',
      }}
    >
      <Icon name="x" size={12} strokeWidth={2.5} />
    </button>
  );
}

export function Tag({ children, icon, selected = false, onClick, onRemove, removeLabel, disabled = false, style }) {
  const [st, h] = useInteraction(disabled);
  const interactive = !!onClick;
  const El = interactive ? 'button' : 'span';
  const checked = selected && interactive;
  return (
    // The pill is the wrapper, so the tag's own button and the remove button sit side by side inside it.
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 30,
        borderRadius: 'var(--radius-pill)',
        color: selected ? 'var(--text-inverse)' : 'var(--text-body)',
        background: pillBackground(selected, st.hover),
        border: '1px solid ' + (selected ? 'var(--surface-inverse)' : 'var(--border-default)'),
        boxShadow: shadows(st.focus && 'var(--focus-ring)'),
        opacity: disabled ? 0.45 : 1,
        transform: st.press ? 'scale(.96)' : 'none',
        transition: 'all var(--dur-fast) var(--ease-spring)',
        animation: 'ag-pop var(--dur-slow) var(--ease-spring)',
        ...style,
      }}
    >
      <El
        type={interactive ? 'button' : undefined}
        onClick={onClick}
        disabled={interactive ? disabled : undefined}
        aria-pressed={interactive ? selected : undefined}
        {...(interactive ? h : {})}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: '100%',
          padding: onRemove ? '0 0 0 10px' : '0 12px',
          border: 0,
          borderRadius: 'var(--radius-pill)',
          background: 'transparent',
          color: 'inherit',
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1,
          outline: 'none',
          cursor: interactive && !disabled ? 'pointer' : 'default',
        }}
      >
        {checked && <Icon name="check" size={14} strokeWidth={2.5} style={{ animation: 'ag-pop var(--dur-base) var(--ease-spring)' }} />}
        {icon && !checked && <Icon name={icon} size={14} />}
        <span>{children}</span>
      </El>
      {onRemove && <RemoveButton label={removeLabel || 'Remove ' + (typeof children === 'string' ? children : '')} disabled={disabled} onRemove={onRemove} />}
    </span>
  );
}

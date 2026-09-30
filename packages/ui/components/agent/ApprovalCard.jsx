import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Badge } from '../display/Badge.jsx';
import { Button } from '../actions/Button.jsx';

const RISK = { low: ['success', 'Low risk'], medium: ['warning', 'Check this'], high: ['danger', 'Can’t be undone'] };

export function ApprovalCard({ title, description, risk = 'medium', changes = [], status = 'pending', onApprove, onReject, onEdit, onUndo, approveLabel = 'Approve', shortcuts = true, style }) {
  const ref = React.useRef(null);
  const [r, rl] = RISK[risk] || RISK.medium;
  React.useEffect(() => {
    if (!shortcuts || status !== 'pending') return;
    const el = ref.current;
    const k = (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onApprove && onApprove(); }
      if (e.key === 'Escape') { e.preventDefault(); onReject && onReject(); }
    };
    el && el.addEventListener('keydown', k);
    return () => el && el.removeEventListener('keydown', k);
  }, [shortcuts, status, onApprove, onReject]);

  if (status !== 'pending') {
    const ok = status === 'approved';
    return (
      <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px 10px 14px', borderRadius: 'var(--radius-md)', background: ok ? 'var(--success-soft)' : 'var(--surface-sunken)', color: ok ? 'var(--success-ink)' : 'var(--text-muted)', fontSize: 14, fontWeight: 500, animation: 'ag-pop var(--dur-slow) var(--ease-spring)', ...style }}>
        <Icon name={ok ? 'circle-check' : 'x'} size={18} />
        <span style={{ flex: 1 }}>{ok ? 'Approved' : 'Declined'} · {title}</span>
        {onUndo && <Button variant="ghost" size="sm" iconLeft="undo-2" onClick={onUndo}>Undo</Button>}
      </div>
    );
  }
  return (
    <section ref={ref} tabIndex={-1} aria-label={'Approval needed: ' + (typeof title === 'string' ? title : '')} style={{
      position: 'relative', borderRadius: 'var(--radius-lg)', background: 'var(--surface-card)', border: '1.5px solid var(--coral-400)',
      boxShadow: 'var(--glow-human), var(--shadow-md)', padding: 20, animation: 'ag-rise var(--dur-slow) var(--ease-spring)', outline: 'none', ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Badge tone="human" variant="solid" icon="hand">Needs your OK</Badge>
        <Badge tone={r} dot>{rl}</Badge>
      </div>
      <h3 style={{ font: 'var(--weight-bold) 20px/1.25 var(--font-display)', letterSpacing: '-0.015em', color: 'var(--text-strong)' }}>{title}</h3>
      {description && <p style={{ marginTop: 6, fontSize: 14.5, color: 'var(--text-muted)' }}>{description}</p>}
      {changes.length > 0 && (
        <dl style={{ margin: '14px 0 0', padding: 4, borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)', display: 'grid', gap: 2 }}>
          {changes.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr)', gap: 12, padding: '8px 10px', borderRadius: 10, background: 'var(--surface-card)', fontSize: 13.5 }}>
              <dt style={{ color: 'var(--text-subtle)' }}>{c.label}</dt>
              <dd style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                {c.before && <><span style={{ color: 'var(--text-subtle)', textDecoration: 'line-through' }}>{c.before}</span><Icon name="arrow-right" size={13} color="var(--text-subtle)" /></>}
                <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{c.after}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
        <Button iconLeft="check" kbd={shortcuts ? 'mod+enter' : undefined} onClick={onApprove}>{approveLabel}</Button>
        {onEdit && <Button variant="secondary" iconLeft="pencil" onClick={onEdit}>Edit first</Button>}
        <div style={{ flex: 1 }} />
        <Button variant="ghost" kbd={shortcuts ? 'esc' : undefined} onClick={onReject}>Not now</Button>
      </div>
    </section>
  );
}

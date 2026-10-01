import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { AgentStep } from '../agent/AgentStep.jsx';

export function AgentActivity({ summary, meta, steps = [], defaultOpen = false, running = false, style }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [h, setH] = React.useState(false);
  const id = React.useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', ...style }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onPointerEnter={() => setH(true)}
        onPointerLeave={() => setH(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 24,
          padding: '0 8px 0 7px',
          border: 0,
          borderRadius: 999,
          cursor: 'pointer',
          background: h ? 'var(--surface-press)' : 'var(--surface-hover)',
          color: 'var(--text-muted)',
          font: '500 12px/1 var(--font-body)',
          transition: 'background var(--dur-instant)',
        }}
      >
        <span style={{ display: 'flex', color: running ? 'var(--agent-ink)' : 'var(--text-subtle)', animation: running ? 'ag-spin 1s linear infinite' : 'none' }}>
          <Icon name={running ? 'loader' : 'list-checks'} size={13} strokeWidth={2.25} />
        </span>
        <span>{summary || steps.length + ' steps'}</span>
        {meta && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-subtle)' }}>{meta}</span>}
        <span style={{ display: 'flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-spring)' }}>
          <Icon name="chevron-down" size={13} />
        </span>
      </button>
      {open && (
        <div
          id={id}
          style={{
            alignSelf: 'stretch',
            maxWidth: 560,
            padding: '12px 14px 4px',
            borderRadius: 14,
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border-subtle)',
            animation: 'ag-rise var(--dur-fast) var(--ease-out)',
          }}
        >
          {steps.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a run's trace only grows at the end, so a position always names the same step
            <AgentStep key={i} {...s} last={i === steps.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

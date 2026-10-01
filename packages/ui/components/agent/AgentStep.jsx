import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { shadows, useFocusVisible } from '../core/useInteraction.js';

// Per status: dot colours and icon, the spoken word, and how the title and detail read.
const S = {
  queued: { bg: 'var(--surface-card)', bd: 'var(--border-default)', fg: 'var(--text-subtle)', icon: null, word: 'Queued', dashed: true, dim: true },
  running: { bg: 'var(--volt-400)', bd: 'var(--volt-500)', fg: 'var(--ink-950)', icon: 'loader', word: 'Running', anim: 'ag-pulse 1.6s var(--ease-out) infinite', spin: true },
  done: { bg: 'var(--ink-900)', bd: 'var(--ink-900)', fg: '#fff', icon: 'check', word: 'Done', anim: 'ag-pop var(--dur-slow) var(--ease-spring)', rail: 'var(--ink-900)' },
  waiting: { bg: 'var(--coral-500)', bd: 'var(--coral-500)', fg: '#fff', icon: 'hand', word: 'Needs you', detailFg: 'var(--human-ink)' },
  error: { bg: 'var(--red-500)', bd: 'var(--red-500)', fg: '#fff', icon: 'x', word: 'Failed', detailFg: 'var(--danger-ink)' },
  skipped: { bg: 'var(--surface-sunken)', bd: 'var(--border-default)', fg: 'var(--text-subtle)', icon: 'minus', word: 'Skipped', dim: true, strike: true },
};

/** The timeline column: the status dot and, unless last, the rail down to the next step. */
function StepMarker({ s, last }) {
  return (
    <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
      {!last && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 26,
            bottom: -4,
            width: 2,
            borderRadius: 2,
            background: s.rail || 'var(--border-default)',
            transition: 'background var(--dur-slow)',
          }}
        />
      )}
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          zIndex: 1,
          marginTop: 2,
          width: 22,
          height: 22,
          borderRadius: 99,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: s.bg,
          border: '1.5px ' + (s.dashed ? 'dashed ' : 'solid ') + s.bd,
          color: s.fg,
          animation: s.anim || 'none',
        }}
      >
        {s.icon && <Icon name={s.icon} size={12} strokeWidth={3} style={s.spin ? { animation: 'ag-spin 900ms linear infinite' } : null} />}
      </span>
    </div>
  );
}

export function AgentStep({ status = 'done', title, detail, tool, meta, children, defaultOpen = false, last = false, style }) {
  const s = S[status] || S.done;
  const [open, setOpen] = React.useState(defaultOpen);
  const [fv, focusHandlers] = useFocusVisible();
  const bid = React.useId();
  const expandable = !!children;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '24px minmax(0,1fr)', columnGap: 12, animation: 'ag-rise var(--dur-slow) var(--ease-spring)', ...style }}>
      <StepMarker s={s} last={last} />
      <div style={{ paddingBottom: last ? 0 : 18, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minHeight: 26 }}>
          <button
            type="button"
            disabled={!expandable}
            aria-expanded={expandable ? open : undefined}
            aria-controls={expandable ? bid : undefined}
            onClick={() => setOpen(!open)}
            {...focusHandlers}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
              flex: 1,
              padding: '2px 4px',
              margin: '0 -4px',
              border: 0,
              background: 'transparent',
              font: 'inherit',
              textAlign: 'left',
              cursor: expandable ? 'pointer' : 'default',
              color: s.dim ? 'var(--text-subtle)' : 'var(--text-strong)',
              borderRadius: 6,
              outline: 'none',
              boxShadow: shadows(fv && 'var(--focus-ring)'),
            }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35, textDecoration: s.strike ? 'line-through' : 'none' }}>{title}</span>
            <span className="ag-sr-only">— {s.word}</span>
            {expandable && (
              <Icon
                name="chevron-right"
                size={14}
                color="var(--text-subtle)"
                style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-base) var(--ease-spring)' }}
              />
            )}
          </button>
          {tool && (
            <code style={{ flexShrink: 0, fontSize: 11.5, padding: '2px 6px', borderRadius: 5, background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}>{tool}</code>
          )}
          {meta && <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-subtle)' }}>{meta}</span>}
        </div>
        {detail && (
          <div
            style={{
              marginTop: 2,
              fontSize: 13.5,
              lineHeight: 1.45,
              color: s.detailFg || 'var(--text-muted)',
            }}
          >
            {detail}
          </div>
        )}
        {expandable && (
          <div id={bid} hidden={!open} style={{ marginTop: 10, animation: open ? 'ag-rise var(--dur-base) var(--ease-out)' : 'none' }}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

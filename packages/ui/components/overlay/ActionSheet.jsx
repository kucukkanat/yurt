import React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../core/Icon.jsx';

/**
 * A touch menu that rises from the bottom edge. Focus moves to the first action; Escape, the backdrop and Cancel close it.
 * Rendered into <body>, so whatever opened it (a message being swiped, a scrolling list) can't move or clip it.
 */
export function ActionSheet({ open, onClose, label, header, actions }) {
  const panel = React.useRef(null);
  // Callers pass a fresh onClose each render; the effect below only follows `open`.
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    panel.current.querySelector('button').focus();
    const k = (e) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      prev.focus(); // a document always has an active element (at least <body>)
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-dialog)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'var(--surface-overlay)',
        animation: 'ag-fade var(--dur-fast) var(--ease-out)',
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          width: '100%',
          maxWidth: 'var(--layout-content)',
          background: 'var(--surface-raised)',
          color: 'var(--text-body)',
          borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
          boxShadow: 'var(--shadow-xl)',
          padding: 'var(--space-2) var(--space-2) calc(var(--space-2) + var(--safe-bottom))',
          animation: 'ag-sheet-in var(--dur-base) var(--ease-out)',
        }}
      >
        <div aria-hidden="true" style={{ width: 36, height: 4, borderRadius: 'var(--radius-pill)', background: 'var(--border-strong)', margin: '4px auto var(--space-2)' }} />
        {header}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {[...actions, { id: 'cancel', label: 'Cancel', icon: 'x', onSelect: () => {} }].map((a) => (
            <button
              key={a.id}
              type="button"
              data-testid={'sheet-' + a.id}
              onClick={() => {
                onClose();
                a.onSelect();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                minHeight: 'var(--hit-min)',
                padding: '0 var(--space-4)',
                border: 0,
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
                color: a.tone === 'danger' ? 'var(--danger-ink)' : 'var(--text-body)',
                font: 'inherit',
                fontSize: 'var(--fs-body)',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <Icon name={a.icon} size={18} />
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

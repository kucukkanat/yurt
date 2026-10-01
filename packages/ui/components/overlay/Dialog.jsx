import React from 'react';
import { IconButton } from '../actions/IconButton.jsx';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, title, label, description, children, footer, width = 480, inline = false, dismissible = true }) {
  const panel = React.useRef(null);
  const prev = React.useRef(null);
  const tid = React.useId();
  React.useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement;
    const t = setTimeout(() => {
      // The panel is mounted while open, and closing clears this timer.
      const el = panel.current.querySelector('[data-autofocus]') || panel.current.querySelector(FOCUSABLE);
      el?.focus();
    }, 20);
    return () => {
      clearTimeout(t);
      prev.current?.focus?.();
    };
  }, [open]);
  // Escape must close the dialog even when focus isn't inside it yet (focus moves in after a tick) or
  // drifted to the page, e.g. after clicking a menu item that unmounted. Keys inside the panel are
  // handled by onKey below, so they're skipped here.
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    if (!open || !dismissible) return;
    const k = (e) => {
      if (e.key === 'Escape' && !panel.current?.contains(e.target)) closeRef.current?.();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, dismissible]);
  if (!open) return null;
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      onClose?.();
    }
    if (e.key === 'Tab') {
      const f = [...panel.current.querySelectorAll(FOCUSABLE)];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop dismisses; Escape is the keyboard equivalent (handled on the panel and window)
    <div
      style={{
        position: inline ? 'absolute' : 'fixed',
        inset: 0,
        zIndex: 'var(--z-dialog)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--surface-overlay)',
        backdropFilter: 'blur(3px)',
        animation: 'ag-fade var(--dur-base) var(--ease-out)',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose?.();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        onKeyDown={onKey}
        aria-modal="true"
        aria-labelledby={title ? tid : undefined}
        aria-label={title ? undefined : label}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: width,
          maxHeight: '100%',
          overflow: 'auto',
          background: 'var(--surface-raised)',
          color: 'var(--text-body)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-xl)',
          padding: 28,
          animation: 'ag-dialog-in var(--dur-slow) var(--ease-spring)',
        }}
      >
        {dismissible && (
          <div style={{ position: 'absolute', top: 16, right: 16 }}>
            <IconButton icon="x" label="Close (Esc)" size="sm" onClick={onClose} />
          </div>
        )}
        {title && (
          <h2 id={tid} style={{ font: 'var(--weight-bold) 24px/1.15 var(--font-display)', letterSpacing: '-0.02em', color: 'var(--text-strong)', paddingRight: 40 }}>
            {title}
          </h2>
        )}
        {description && <p style={{ marginTop: 8, fontSize: 15, color: 'var(--text-muted)' }}>{description}</p>}
        {children && <div style={{ marginTop: 20 }}>{children}</div>}
        {footer && <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>
  );
}

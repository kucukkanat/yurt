import type React from 'react';
import { useState } from 'react';
import { IconButton } from '@yurt/ui';

// Rows and titled groups shared by the sidebar and the Settings side nav.
export function Row({
  active,
  onClick,
  children,
  label,
  dim,
  testId,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
  dim?: boolean | undefined;
  testId?: string;
}) {
  const [h, setH] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      data-testid={testId}
      onPointerEnter={() => setH(true)}
      onPointerLeave={() => setH(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        minHeight: 32,
        padding: '0 10px',
        border: 0,
        borderRadius: 8,
        width: '100%',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 14,
        textAlign: 'left',
        flexShrink: 0,
        background: active ? 'var(--surface-press)' : h ? 'var(--surface-hover)' : 'transparent',
        color: active ? 'var(--text-strong)' : 'var(--text-muted)',
        opacity: dim && !active ? 0.6 : 1,
        transition: 'background var(--dur-instant)',
      }}
    >
      {children}
    </button>
  );
}

/** A titled group; with `onAdd`, a + button that `addLabel` names (required with it, so the button is never unnamed). */
type SectionProps = { title: string; children: React.ReactNode } & ({ onAdd: () => void; addLabel: string } | { onAdd?: undefined; addLabel?: undefined });

export function Section({ title, onAdd, addLabel, children }: SectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 4px 10px' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle)', lineHeight: '28px' }}>{title}</span>
        {onAdd && <IconButton icon="plus" label={addLabel} size="sm" onClick={onAdd} />}
      </div>
      {children}
    </div>
  );
}

import React from 'react';

export function TypingIndicator({ people = [], style }) {
  if (!people.length) return <div aria-live="polite" style={{ height: 18, ...style }} />;
  const agents = people.filter((p) => p.kind === 'agent');
  const names = people.map((p) => p.name);
  const who = names.length === 1 ? names[0] : names.length === 2 ? names[0] + ' and ' + names[1] : names[0] + ' and ' + (names.length - 1) + ' others';
  const verb = agents.length === people.length ? (people.length === 1 ? 'is writing' : 'are writing') : people.length === 1 ? 'is typing' : 'are typing';
  const dotC = agents.length ? 'var(--volt-400)' : 'var(--ink-400)';
  return (
    <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 18, font: '500 12px/1 var(--font-body)', color: 'var(--text-subtle)', ...style }}>
      <span aria-hidden="true" style={{ display: 'inline-flex', gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 4, height: 4, borderRadius: 9, background: dotC, animation: 'ag-dot 1.1s var(--ease-in-out) ' + i * 0.14 + 's infinite' }} />
        ))}
      </span>
      <span>
        <b style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{who}</b> {verb}
      </span>
    </div>
  );
}

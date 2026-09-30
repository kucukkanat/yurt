import React from 'react';

export const PRESENCE = {
  online: { color: 'var(--green-500)', label: 'Online' },
  away: { color: 'var(--amber-500)', label: 'Away' },
  offline: { color: 'transparent', label: 'Offline' },
};

export function PresenceDot({ status = 'online', size = 10, cutout = 'var(--surface-page)', style }) {
  const p = PRESENCE[status] || PRESENCE.offline;
  const off = status === 'offline';
  return (
    <span role="img" aria-label={p.label} style={{
      display: 'inline-block', width: size, height: size, borderRadius: 999, flexShrink: 0, background: off ? cutout : p.color,
      boxShadow: (cutout ? '0 0 0 2px ' + cutout + ', ' : '') + (off ? 'inset 0 0 0 ' + Math.max(1.5, size / 5) + 'px var(--ink-500)' : 'none'),
      transition: 'background var(--dur-fast) var(--ease-out)', ...style,
    }} />
  );
}

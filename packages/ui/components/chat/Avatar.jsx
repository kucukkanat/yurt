import React from 'react';
import { PresenceDot } from './PresenceDot.jsx';

const HUMAN_FILLS = ['var(--ink-600)', 'var(--ink-700)', 'var(--ink-500)', '#5E5A4E', '#4E5448'];
const hash = (s) => {
  let h = 0;
  for (const c of s || '') h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
};
export const initials = (n = '') =>
  n
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function Avatar({ name, kind = 'human', self = false, owner, presence, working = false, size = 32, cutout = 'var(--surface-page)', decorative = false, style }) {
  const agent = kind === 'agent';
  const off = presence === 'offline';
  const ring = Math.max(2, Math.round(size / 14));
  const bg = agent ? 'var(--ink-900)' : self ? 'var(--cobalt-500)' : HUMAN_FILLS[hash(name) % HUMAN_FILLS.length];
  const fg = agent ? (off ? 'var(--ink-400)' : 'var(--volt-400)') : '#fff';
  const label = agent
    ? name + ', agent' + (owner ? ' owned by ' + owner.name : '') + (presence ? ', ' + presence : '')
    : name + (self ? ' (you)' : '') + (presence ? ', ' + presence : '');
  const mini = Math.max(12, Math.round(size * 0.46));
  const dot = Math.max(8, Math.round(size * 0.3));
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0, ...style }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 999,
          background: bg,
          color: fg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          font: '700 ' + Math.round(size * (agent ? 0.44 : 0.38)) + 'px/1 var(--font-display)',
          letterSpacing: '-0.03em',
          userSelect: 'none',
          boxShadow: agent ? 'inset 0 0 0 ' + ring + 'px ' + (off ? 'var(--ink-600)' : 'var(--volt-400)') : 'none',
          opacity: off && !agent ? 0.55 : 1,
          animation: working && !off ? 'ag-pulse 1.6s var(--ease-out) infinite' : 'none',
          transition: 'box-shadow var(--dur-base) var(--ease-out), color var(--dur-base)',
        }}
      >
        {agent ? (name || '?')[0].toUpperCase() : initials(name)}
      </span>
      {agent && owner && (
        <span
          style={{ position: 'absolute', right: -Math.round(mini * 0.28), bottom: -Math.round(mini * 0.22), borderRadius: 999, boxShadow: '0 0 0 2px ' + cutout, display: 'flex' }}
        >
          <Avatar name={owner.name} self={owner.self} size={mini} decorative />
        </span>
      )}
      {!agent && presence && <PresenceDot status={presence} size={dot} cutout={cutout} style={{ position: 'absolute', right: -1, bottom: -1 }} />}
    </span>
  );
}

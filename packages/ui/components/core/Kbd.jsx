import React from 'react';

const MAC = {
  mod: '⌘',
  cmd: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  opt: '⌥',
  shift: '⇧',
  enter: '↵',
  return: '↵',
  esc: 'Esc',
  tab: '⇥',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  backspace: '⌫',
  space: 'Space',
};

export function Kbd({ keys, tone = 'default', size = 'md', style }) {
  const list = Array.isArray(keys) ? keys : String(keys).split('+');
  const t = {
    default: { bg: 'var(--surface-card)', fg: 'var(--text-muted)', bd: 'var(--border-default)' },
    onAccent: { bg: 'rgba(255,255,255,.16)', fg: 'rgba(255,255,255,.92)', bd: 'rgba(255,255,255,.22)' },
    onAgent: { bg: 'rgba(13,13,12,.08)', fg: 'var(--ink-800)', bd: 'rgba(13,13,12,.16)' },
    inverse: { bg: 'rgba(255,255,255,.08)', fg: 'var(--ink-200)', bd: 'rgba(255,255,255,.16)' },
  }[tone];
  const h = size === 'sm' ? 18 : 22;
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', ...style }} aria-label={list.join(' + ')}>
      {list.map((k, i) => (
        <kbd
          key={i}
          aria-hidden="true"
          style={{
            minWidth: h,
            height: h,
            padding: '0 5px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: size === 'sm' ? 10.5 : 11.5,
            fontWeight: 500,
            lineHeight: 1,
            color: t.fg,
            background: t.bg,
            border: '1px solid ' + t.bd,
            borderBottomWidth: 2,
            borderRadius: 5,
          }}
        >
          {MAC[k.trim().toLowerCase()] || k.trim().toUpperCase()}
        </kbd>
      ))}
    </span>
  );
}

import React from 'react';

const TONE = {
  self: { bg: 'var(--human-soft)', fg: 'var(--human-ink)' },
  agent: { bg: 'var(--agent-soft)', fg: 'var(--agent-ink)' },
  human: { bg: 'var(--surface-press)', fg: 'var(--text-strong)' },
  room: { bg: 'var(--accent-soft)', fg: 'var(--accent-soft-ink)' },
};

export function Mention({ handle, kind = 'human', self = false, onClick, style }) {
  const t = TONE[self ? 'self' : kind] || TONE.human;
  const [h, setH] = React.useState(false);
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      onPointerEnter={() => setH(true)}
      onPointerLeave={() => setH(false)}
      style={{
        display: 'inline',
        whiteSpace: 'nowrap',
        padding: '1px 5px',
        margin: '0 1px',
        borderRadius: 6,
        border: 0,
        font: 'inherit',
        lineHeight: 'inherit',
        verticalAlign: 'baseline',
        fontWeight: 600,
        WebkitBoxDecorationBreak: 'clone',
        background: t.bg,
        color: t.fg,
        cursor: onClick ? 'pointer' : 'inherit',
        boxShadow: h && onClick ? 'inset 0 0 0 1px currentColor' : 'none',
        transition: 'box-shadow var(--dur-instant)',
        ...style,
      }}
    >
      @{handle}
    </Tag>
  );
}

/** Splits plain text on @handles and renders known ones as Mention chips. */
export function MentionText({ text = '', members = [], meId, onMention }) {
  // Each piece is keyed by where it starts in the text: stable for a given text, unique once empty pieces are dropped.
  let at = 0;
  const parts = String(text)
    .split(/(@[A-Za-z0-9_-]+)/g)
    .map((p) => {
      const start = at;
      at += p.length;
      return { p, start };
    })
    .filter(({ p }) => p);
  return parts.map(({ p, start }) => {
    if (p[0] !== '@') return <React.Fragment key={start}>{p}</React.Fragment>;
    const h = p.slice(1).toLowerCase();
    if (h === 'room' || h === 'here') return <Mention key={start} handle={h} kind="room" />;
    const m = members.find((x) => (x.handle || '').toLowerCase() === h);
    if (!m) return <React.Fragment key={start}>{p}</React.Fragment>;
    return <Mention key={start} handle={m.handle} kind={m.kind} self={m.id === meId} onClick={onMention ? () => onMention(m) : undefined} />;
  });
}

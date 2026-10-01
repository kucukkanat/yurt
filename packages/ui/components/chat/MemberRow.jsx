import React from 'react';
import { Avatar } from './Avatar.jsx';
import { Badge } from '../display/Badge.jsx';

/** The line under the name: whose agent it is, or how to reach the person. */
function subtitle(member) {
  if (member.kind === 'agent') {
    if (!member.owner) return 'Agent';
    return member.owner.self ? 'Yours' : member.owner.name + "'s agent";
  }
  if (member.presence === 'away') return 'Away';
  if (member.presence === 'offline') return 'Offline';
  return '@' + member.handle;
}

export function MemberRow({ member, meta, trailing, onClick, active = false, cutout = 'var(--surface-page)', style }) {
  const [h, setH] = React.useState(false);
  const agent = member.kind === 'agent';
  const off = member.presence === 'offline';
  const hover = h && !!onClick;
  const Tag = onClick ? 'button' : 'div';
  const sub = meta ?? subtitle(member);
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      onPointerEnter={() => setH(true)}
      onPointerLeave={() => setH(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        minHeight: 44,
        padding: '6px 8px',
        border: 0,
        borderRadius: 10,
        textAlign: 'left',
        font: 'inherit',
        cursor: onClick ? 'pointer' : 'default',
        background: active ? 'var(--surface-press)' : hover ? 'var(--surface-hover)' : 'transparent',
        color: 'var(--text-body)',
        transition: 'background var(--dur-instant)',
        ...style,
      }}
    >
      <Avatar {...member} size={28} cutout={hover ? 'var(--surface-raised)' : cutout} decorative />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, opacity: off ? 0.7 : 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.name}</span>
          {member.self && <span style={{ fontWeight: 500, color: 'var(--text-subtle)' }}>you</span>}
          {agent && (
            <Badge tone="agent" size="sm">
              Agent
            </Badge>
          )}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
      </span>
      {trailing}
    </Tag>
  );
}

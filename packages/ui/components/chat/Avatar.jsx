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

/** What a screen reader hears: "Scout, agent owned by Ada, online" / "Ada (you), away". */
function avatarLabel(name, agent, self, owner, presence) {
  const status = presence ? ', ' + presence : '';
  if (agent) return name + ', agent' + (owner ? ' owned by ' + owner.name : '') + status;
  return name + (self ? ' (you)' : '') + status;
}

/** Fill and text colour: agents are dark with a volt mark (dimmed offline), you are cobalt, others get a stable neutral. */
function avatarColors(name, agent, self, off) {
  if (agent) return { bg: 'var(--ink-900)', fg: off ? 'var(--ink-400)' : 'var(--volt-400)' };
  return { bg: self ? 'var(--cobalt-500)' : HUMAN_FILLS[hash(name) % HUMAN_FILLS.length], fg: '#fff' };
}

export function Avatar({ name, kind = 'human', self = false, owner, presence, working = false, size = 32, cutout = 'var(--surface-page)', decorative = false, style }) {
  const agent = kind === 'agent';
  const off = presence === 'offline';
  const ring = Math.max(2, Math.round(size / 14));
  const { bg, fg } = avatarColors(name, agent, self, off);
  const mini = Math.max(12, Math.round(size * 0.46));
  const dot = Math.max(8, Math.round(size * 0.3));
  // Decorative avatars sit next to the name already; the rest are images with a spoken label.
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': avatarLabel(name, agent, self, owner, presence) };
  return (
    <span {...a11y} style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0, ...style }}>
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

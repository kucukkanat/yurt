import React from 'react';
import { Avatar } from './Avatar.jsx';
import { MentionText } from './Mention.jsx';
import { AgentActivity } from './AgentActivity.jsx';
import { Icon } from '../core/Icon.jsx';
import { Badge } from '../display/Badge.jsx';

const TINT = { default: 'transparent', agent: 'color-mix(in oklab, var(--agent) 6%, transparent)', mention: 'color-mix(in oklab, var(--human) 9%, transparent)' };
/** The quick reactions offered on a message (the action bar's picker, and the app's touch sheet). */
export const REACTIONS = ['thumbs-up', 'heart', 'circle-check', 'eye', 'zap', 'flag'];
const PICK = REACTIONS;

function Act({ icon, label, onClick, tone, testId }) {
  const [h, setH] = React.useState(false);
  const muted = tone === 'muted';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
      onPointerEnter={() => setH(true)}
      onPointerLeave={() => setH(false)}
      style={{
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 0,
        borderRadius: 8,
        cursor: muted ? 'help' : 'pointer',
        background: h ? 'var(--surface-press)' : 'transparent',
        color: tone === 'danger' && h ? 'var(--danger-ink)' : muted ? 'var(--text-subtle)' : 'var(--text-muted)',
      }}
    >
      <span style={{ display: 'flex', transform: h ? 'scale(1.08)' : 'none', transition: 'transform var(--dur-fast) var(--ease-spring)' }}>
        <Icon name={icon} size={15} />
      </span>
    </button>
  );
}

export function Reaction({ icon, count, mine = false, onClick }) {
  const [h, setH] = React.useState(false);
  return (
    <button
      type="button"
      aria-pressed={mine}
      aria-label={icon + ' ' + count}
      onClick={onClick}
      onPointerEnter={() => setH(true)}
      onPointerLeave={() => setH(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 24,
        padding: '0 8px',
        borderRadius: 999,
        cursor: 'pointer',
        font: '500 11.5px/1 var(--font-mono)',
        border: '1px solid ' + (mine ? 'var(--accent)' : 'var(--border-subtle)'),
        background: mine ? 'var(--accent-soft)' : h ? 'var(--surface-hover)' : 'transparent',
        color: mine ? 'var(--accent-soft-ink)' : 'var(--text-muted)',
        transition: 'background var(--dur-instant)',
      }}
    >
      <Icon name={icon} size={13} strokeWidth={2.25} />
      {count}
    </button>
  );
}

function MessageHeader({ author, agent, time, edited, pinned, onAuthor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', lineHeight: 1.2 }}>
      <button
        type="button"
        onClick={onAuthor}
        style={{ padding: 0, border: 0, background: 'none', font: '700 14px/1.2 var(--font-body)', color: 'var(--text-strong)', cursor: onAuthor ? 'pointer' : 'default' }}
      >
        {author.name}
      </button>
      {agent && (
        <Badge tone="agent" size="sm" icon="sparkles">
          Agent
        </Badge>
      )}
      {agent && author.owner && <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{author.owner.self ? 'yours' : author.owner.name + "'s"}</span>}
      <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-subtle)' }}>{time}</span>
      {edited && <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>edited</span>}
      {pinned && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: 'var(--text-subtle)' }}>
          <Icon name="pin" size={11} />
          Pinned
        </span>
      )}
    </div>
  );
}

function Attachments({ attachments }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
      {attachments.map((a, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: one message's attachments never change order, and names may repeat
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px 8px 8px',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--surface-card)',
            minWidth: 200,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--surface-sunken)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
            }}
          >
            <Icon name={a.kind === 'image' ? 'image' : 'file-text'} size={16} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{a.name}</span>
            <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-subtle)' }}>{a.size}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function RepliesButton({ replies, onReplies }) {
  return (
    <button
      type="button"
      onClick={onReplies}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 26,
        padding: '0 8px 0 4px',
        border: 0,
        borderRadius: 8,
        background: 'transparent',
        cursor: 'pointer',
        font: '600 12.5px/1 var(--font-body)',
        color: 'var(--text-link)',
      }}
    >
      <span style={{ display: 'flex' }}>
        {(replies.people || []).slice(0, 3).map((p, i) => (
          <Avatar
            // biome-ignore lint/suspicious/noArrayIndexKey: up to three overlapping faces; the position is what's drawn, names may repeat
            key={i}
            {...p}
            owner={undefined}
            size={20}
            decorative
            style={{ marginLeft: i ? -6 : 0, boxShadow: '0 0 0 2px var(--surface-page)', borderRadius: 999 }}
          />
        ))}
      </span>
      {replies.count} {replies.count === 1 ? 'reply' : 'replies'}
      {replies.last && <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}>{replies.last}</span>}
    </button>
  );
}

/** Shown under messages that haven't gone out: written offline, or failed. */
function DeliveryNote({ status }) {
  if (status === 'queued')
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-subtle)' }}>
        <Icon name="clock" size={12} />
        Sends when you reconnect
      </span>
    );
  if (status === 'failed')
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--danger-ink)' }}>
        <Icon name="circle-alert" size={12} />
        Not delivered · Retry
      </span>
    );
  return null;
}

function ReactionPicker({ onPick }) {
  return (
    <div
      role="menu"
      aria-label="Pick a reaction"
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        display: 'flex',
        gap: 2,
        padding: 4,
        borderRadius: 12,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-lg)',
        animation: 'ag-rise var(--dur-fast) var(--ease-out)',
        zIndex: 5,
      }}
    >
      {PICK.map((ic) => (
        <Act key={ic} icon={ic} label={ic.replace('circle-', '')} onClick={() => onPick(ic)} />
      ))}
    </div>
  );
}

/** Hover/focus toolbar: react, pin, the app's own actions (`more`), reply, and edit/delete (or the lock) for your own messages. */
function ActionBar({ self, pinned, locked, editLabel, lockedLabel, picker, setPicker, onReact, onPin, more, onReply, onEdit, onDelete, onLocked }) {
  return (
    <div
      role="toolbar"
      aria-label="Message actions"
      style={{
        position: 'absolute',
        top: -14,
        right: 16,
        display: 'flex',
        gap: 2,
        padding: 2,
        borderRadius: 10,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-md)',
        animation: 'ag-fade var(--dur-fast) var(--ease-out)',
      }}
    >
      <Act icon="thumbs-up" label="React" onClick={() => onReact?.('thumbs-up')} />
      <Act icon="smile-plus" label="Add reaction" onClick={() => setPicker((p) => !p)} />
      {onPin && <Act icon="pin" label={pinned ? 'Unpin' : 'Pin'} onClick={onPin} />}
      {more.map((a) => (
        <Act key={a.id} icon={a.icon} label={a.label} onClick={a.onSelect} testId={'msg-' + a.id} />
      ))}
      <Act icon="reply" label="Reply in thread" onClick={onReply} />
      {/* Past the edit window, one muted lock replaces Edit and Delete and explains why when clicked. */}
      {self && !locked && <Act icon="pencil" label={editLabel} onClick={onEdit} testId="msg-edit" />}
      {self && !locked && <Act icon="trash-2" label="Delete" tone="danger" onClick={onDelete} testId="msg-delete" />}
      {self && locked && <Act icon="lock" label={lockedLabel} tone="muted" onClick={onLocked} testId="msg-edit-locked" />}
      {picker && (
        <ReactionPicker
          onPick={(ic) => {
            onReact?.(ic);
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}

function MessageBody({ editor, text, members, meId, onMention, children }) {
  if (editor) return editor;
  if (text != null) return <MentionText text={text} members={members} meId={meId} onMention={onMention} />;
  return children;
}

/** The left column: the author's avatar, or for a grouped message its time on hover (and its pin, which has no header). */
function Gutter({ continued, pinned, hover, time, author, onAuthor }) {
  return (
    <div style={{ paddingTop: 2 }}>
      {continued ? (
        // A grouped message has no header, so its pin is marked here; the time shows on hover.
        <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, font: '400 10px/20px var(--font-mono)', color: 'var(--text-subtle)' }}>
          {pinned && <Icon name="pin" size={11} label="Pinned" style={{ display: hover ? 'none' : 'block' }} />}
          <span style={{ opacity: hover ? 1 : 0 }}>{time}</span>
        </span>
      ) : (
        <button
          type="button"
          onClick={onAuthor}
          aria-label={'Open profile: ' + author.name}
          style={{ padding: 0, border: 0, background: 'none', cursor: onAuthor ? 'pointer' : 'default', borderRadius: 999, display: 'flex' }}
        >
          <Avatar {...author} size={32} decorative cutout="var(--surface-page)" />
        </button>
      )}
    </div>
  );
}

export function ChatMessage({
  author,
  time,
  text,
  children,
  members = [],
  meId,
  onMention,
  tone = 'default',
  continued = false,
  edited = false,
  pinned = false,
  status = 'sent',
  reactions = [],
  onReact,
  onPin,
  more = [],
  editor,
  replies,
  onReplies,
  attachments = [],
  activity,
  actions = true,
  onReply,
  onEdit,
  onDelete,
  editLabel = 'Edit',
  locked = false,
  lockedLabel = 'Edit window closed',
  onLocked,
  onAuthor,
  highlighted = false,
  style,
}) {
  const [h, setH] = React.useState(false);
  const [picker, setPicker] = React.useState(false);
  const agent = author.kind === 'agent';
  const bg = highlighted ? 'var(--accent-soft)' : TINT[tone] || 'transparent';
  const leave = () => {
    setH(false);
    setPicker(false);
  };
  return (
    <article
      aria-label={author.name + (time ? ', ' + time : '')}
      tabIndex={-1}
      onPointerEnter={() => setH(true)}
      onPointerLeave={leave}
      onFocus={() => setH(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) leave();
      }}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '32px minmax(0,1fr)',
        columnGap: 10,
        padding: continued ? '2px 16px' : '8px 16px 4px',
        borderRadius: 12,
        background: h && bg === 'transparent' ? 'var(--surface-hover)' : bg,
        transition: 'background var(--dur-instant)',
        animation: 'ag-rise var(--dur-base) var(--ease-out)',
        ...style,
      }}
    >
      <Gutter continued={continued} pinned={pinned} hover={h} time={time} author={author} onAuthor={onAuthor} />
      {/* A queued message stays at full contrast (fading it made its text unreadable); "Sends when you reconnect" marks it. */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {!continued && <MessageHeader author={author} agent={agent} time={time} edited={edited} pinned={pinned} onAuthor={onAuthor} />}
        <div style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-body)', textWrap: 'pretty', overflowWrap: 'anywhere' }}>
          <MessageBody editor={editor} text={text} members={members} meId={meId} onMention={onMention}>
            {children}
          </MessageBody>
        </div>
        {attachments.length > 0 && <Attachments attachments={attachments} />}
        {activity && <AgentActivity {...activity} />}
        {(reactions.length > 0 || replies) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
            {reactions.map((r) => (
              <Reaction key={r.icon} {...r} onClick={onReact ? () => onReact(r.icon) : undefined} />
            ))}
            {replies && <RepliesButton replies={replies} onReplies={onReplies} />}
          </div>
        )}
        <DeliveryNote status={status} />
      </div>
      {actions && h && status === 'sent' && !editor && (
        <ActionBar
          self={author.self}
          pinned={pinned}
          locked={locked}
          editLabel={editLabel}
          lockedLabel={lockedLabel}
          picker={picker}
          setPicker={setPicker}
          onReact={onReact}
          onPin={onPin}
          more={more}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onLocked={onLocked}
        />
      )}
    </article>
  );
}

// A divider's line: a real <hr> (a separator), followed by its text, which screen readers read as is.
const RULE = { flex: 1, height: 1, margin: 0, border: 0 };

/** "New" divider for the first unread message. */
export function UnreadDivider({ label = 'New' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px' }}>
      <hr style={{ ...RULE, background: 'var(--human)' }} />
      <span style={{ font: '700 11px/1 var(--font-body)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--human-ink)' }}>{label}</span>
    </div>
  );
}

export function DayDivider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px 4px' }}>
      <hr style={{ ...RULE, background: 'var(--border-subtle)' }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)' }}>{label}</span>
      <span aria-hidden="true" style={{ ...RULE, background: 'var(--border-subtle)' }} />
    </div>
  );
}

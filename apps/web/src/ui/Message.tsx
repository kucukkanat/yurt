import { useEffect, useRef, useState } from 'react';
import { ChatMessage, MentionText, ApprovalCard, Button, Kbd, Icon, IconButton, ICONS, type IconName } from '@yurt/ui';
import { EDIT_WINDOW_MS, mentions, type Msg, type WsState, type WorkspacePeer, type FileRef } from '@yurt/protocol';
import { editLeft, editLeftLabel, EDIT_CLOSED } from '../lib/editWindow';
import { useApp } from '../store';
import { addressed } from '../lib/private';
import { personFor, authorKey, type Person } from '../model';
import { blobsDb } from '../lib/db';
import { must } from './must';
import { fmtTime, fmtBytes } from '../lib/format';

const pendingDeletes = new Set<string>();

// Reaction icons arrive from other members: only names the icon set has can be drawn.
const isIconName = (s: string): s is IconName => Object.hasOwn(ICONS, s);

function useBlobUrl(f: FileRef, code: string) {
  const ver = useApp((s) => s.blobVer[f.id] ?? 0); // only this blob's arrivals re-run the load
  const progress = useApp((s) => s.blobProgress[f.id]);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ver` (this blob arrived) and `attempt` (retry clicked) are re-run triggers, not inputs
  useEffect(() => {
    if (url) return; // loaded once; never swap (and revoke) a URL that's on screen
    let alive = true;
    (async () => {
      const buf = await blobsDb.get(f.id);
      if (!alive) return;
      if (buf) {
        setUrl(URL.createObjectURL(new Blob([buf], { type: f.type })));
        return;
      }
      setFailed(false);
      const ok = await useApp.getState().fetchBlob(code, f.id);
      if (alive && !ok) setFailed(true);
    })();
    return () => {
      alive = false;
    };
  }, [f.id, f.type, code, ver, attempt, url]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return { url, progress, failed, retry: () => setAttempt((n) => n + 1) };
}

function Attachment({ f, code }: { f: FileRef; code: string }) {
  const { url, progress, failed, retry } = useBlobUrl(f, code);
  const isImg = f.type.startsWith('image/');
  if (isImg && url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'block', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-subtle)', maxWidth: 360, width: 'fit-content' }}
      >
        <img src={url} alt={f.name} style={{ display: 'block', maxWidth: '100%', maxHeight: 280, objectFit: 'cover' }} />
      </a>
    );
  }
  // Relay workspaces fetch sealed files from Blossom; Trystero ones need a member who has the file online.
  const note = url
    ? fmtBytes(f.size)
    : failed
      ? 'Couldn’t download · retry'
      : progress != null && progress < 1
        ? 'Fetching · ' + Math.round(progress * 100) + '%'
        : fmtBytes(f.size) + (f.blob ? ' · downloading' : ' · waiting for a peer who has it');
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 8px 8px 8px',
        borderRadius: 12,
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-card)',
        minWidth: 220,
        maxWidth: 360,
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
          flexShrink: 0,
        }}
      >
        <Icon name={isImg ? 'image' : 'file-text'} size={16} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
        <span data-testid="attachment-status" style={{ font: '400 11px/1.2 var(--font-mono)', color: failed && !url ? 'var(--danger-ink)' : 'var(--text-subtle)' }}>
          {note}
        </span>
      </span>
      {url ? (
        <a href={url} download={f.name} aria-label={'Download ' + f.name} style={{ display: 'flex', color: 'var(--text-muted)', padding: 6 }}>
          <Icon name="download" size={16} />
        </a>
      ) : (
        <IconButton icon="refresh-cw" label={f.blob ? 'Try downloading again' : 'Ask peers again'} size="sm" onClick={retry} data-testid="attachment-retry" />
      )}
    </div>
  );
}

function InlineEditor({ initial, left, onSave, onCancel }: { initial: string; left: number; onSave: (t: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  // The user just chose Edit, so the text is where they're headed.
  useEffect(() => field.current?.focus(), []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea
        ref={field}
        value={v}
        onChange={(e) => setV(e.target.value)}
        aria-label="Edit message"
        rows={2}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            v.trim() && onSave(v.trim());
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          resize: 'vertical',
          padding: '8px 12px',
          borderRadius: 12,
          border: '1.5px solid var(--accent)',
          boxShadow: '0 0 0 3px var(--accent-soft)',
          background: 'var(--surface-card)',
          color: 'var(--text-body)',
          font: '400 14.5px/1.5 var(--font-body)',
          outline: 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-subtle)', flexWrap: 'wrap' }}>
        <Button size="sm" variant="primary" onClick={() => v.trim() && onSave(v.trim())}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Kbd keys="enter" size="sm" /> save <Kbd keys="esc" size="sm" /> cancel
        </span>
        <span
          data-testid="edit-time-left"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto', color: left < 120_000 ? 'var(--warning-ink)' : 'var(--text-subtle)' }}
        >
          <Icon name="clock" size={12} />
          {editLeftLabel(left)}
        </span>
      </div>
    </div>
  );
}

export interface MsgCtx {
  state: WsState;
  peer?: WorkspacePeer | undefined;
  me: string;
  handle: string;
  roster: Person[];
  code: string;
  inThread?: boolean | undefined;
  forceRender(): void;
}

/** "replied in a thread: …" above a thread reply that's also shown in the channel. */
function AlsoInChannel({ m, state, code }: { m: Msg & { parent: string }; state: WsState; code: string }) {
  return (
    <button
      type="button"
      data-testid="also-in-channel"
      onClick={() => useApp.getState().go({ code, ch: m.ch, thread: m.parent })}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        maxWidth: '100%',
        padding: '4px 16px 0 58px',
        border: 0,
        background: 'none',
        cursor: 'pointer',
        font: '400 12px/1.3 var(--font-body)',
        color: 'var(--text-subtle)',
        textAlign: 'left',
      }}
    >
      <Icon name="reply" size={12} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        replied in a thread: {state.msgs.get(m.parent)?.text.slice(0, 80) || 'view thread'}
      </span>
    </button>
  );
}

/** An agent asking its owner to allow a tool call, and the owner's answer. */
function Approval({ approval, state, author }: { approval: NonNullable<Msg['approval']>; state: WsState; author: Person }) {
  const app = useApp.getState();
  const decided = state.approvals.get(approval.req);
  const decidedKind = decided ? approval.options.find((o) => o.id === decided)?.kind || '' : '';
  const answer = (o: { id: string } | undefined) => o && app.approve(approval.req, o.id);
  return (
    <div style={{ padding: '2px 16px 10px 58px', display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 640 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-subtle)' }}>
        <Icon name="eye-off" size={12} />
        Only you see this · {author.name} is yours
      </span>
      <ApprovalCard
        title={approval.title}
        description={approval.kind ? 'Tool kind: ' + approval.kind + '. Not on the auto-approve list.' : undefined}
        risk={approval.kind === 'execute' || approval.kind === 'delete' ? 'high' : approval.kind === 'edit' ? 'medium' : 'low'}
        status={!decided ? 'pending' : decidedKind.startsWith('allow') ? 'approved' : 'rejected'}
        approveLabel="Allow once"
        onApprove={() => answer(approval.options.find((x) => x.kind === 'allow_once') || approval.options.find((x) => x.kind.startsWith('allow')))}
        onReject={() => answer(approval.options.find((x) => x.kind.startsWith('reject')))}
      />
    </div>
  );
}

/** A message's thread replies; the reducer only lists replies it holds. */
const repliesOf = (m: Msg, ctx: MsgCtx): Msg[] => m.replies.map((id) => must(ctx.state.msgs.get(id), 'a listed reply is held'));

/** Up to three distinct people who replied in a message's thread. */
function replyPeople(replies: Msg[], ctx: MsgCtx): Person[] {
  const keys = [...new Set(replies.map(authorKey))];
  return keys.slice(0, 3).map((k) => personFor(ctx.state, ctx.peer, k, ctx.me));
}

function threadSummary(m: Msg, ctx: MsgCtx) {
  const replies = repliesOf(m, ctx);
  const last = replies.at(-1);
  if (ctx.inThread || !last) return undefined;
  return { count: replies.length, last: 'Last reply ' + fmtTime(last.ts), people: replyPeople(replies, ctx) };
}

function activityOf(m: Msg) {
  if (!m.trace?.length) return undefined;
  return {
    summary: m.trace.length + (m.trace.length === 1 ? ' step' : ' steps'),
    meta: m.meta,
    steps: m.trace.map((s) => ({ status: s.status, title: s.title, tool: s.tool, meta: s.ms != null ? (s.ms / 1000).toFixed(1) + 's' : undefined, detail: s.detail })),
  };
}

/** Deletes go out only when their toast goes away (expired, closed or pushed out), so Undo always wins while it's visible. */
function deleteWithUndo(m: Msg, ctx: MsgCtx) {
  const app = useApp.getState();
  let undone = false;
  pendingDeletes.add(m.id);
  ctx.forceRender();
  app.toast({
    title: 'Message deleted',
    actionLabel: 'Undo',
    duration: 5000,
    onAction: () => {
      undone = true;
      pendingDeletes.delete(m.id);
      ctx.forceRender();
    },
    onDismiss: () => {
      if (undone) return;
      pendingDeletes.delete(m.id);
      app.publish(ctx.code, { t: 'del', b: { target: m.id }, ch: m.ch, ...addressed(m.ch, ctx.me) });
    },
  });
}

function messageTone(m: Msg, author: Person, mine: boolean, ctx: MsgCtx): 'mention' | 'agent' | 'default' {
  const handles = mentions(m.text);
  if (!mine && handles.includes(ctx.handle)) return 'mention';
  const agentTalk = author.kind === 'agent' && handles.some((h) => ctx.roster.some((p) => p.kind === 'agent' && p.handle.toLowerCase() === h));
  return agentTalk ? 'agent' : 'default';
}

export function MessageItem({ m, continued, ctx }: { m: Msg; continued: boolean; ctx: MsgCtx }) {
  const editing = useApp((s) => s.editing);
  // Re-render my own messages as their edit window counts down (and once just after it closes); others never change.
  useApp((s) => (m.a === ctx.me && !m.ag && s.clock - m.ts < EDIT_WINDOW_MS + 60_000 ? s.clock : 0));
  const highlight = useApp((s) => s.highlight);
  const { state, peer, me, code } = ctx;
  const app = useApp.getState();
  if (pendingDeletes.has(m.id)) return null;
  if (m.deleted) {
    return (
      <div data-mid={m.id} style={{ padding: '4px 16px 4px 58px', fontSize: 13, fontStyle: 'italic', color: 'var(--text-subtle)' }}>
        Message deleted{m.replies.length ? ' · ' + m.replies.length + ' replies' : ''}
      </div>
    );
  }
  const author = personFor(state, peer, authorKey(m), me);
  const mine = m.a === me && !m.ag;
  const left = mine ? editLeft(m.ts, Date.now()) : 0;
  const canEdit = left > 0;
  const text = m.text;
  const pinned = !!state.pins.get(m.ch)?.has(m.id);
  const reactions = Object.entries(m.reactions).flatMap(([icon, who]) => (isIconName(icon) ? [{ icon, count: who.length, mine: who.includes(me) }] : []));
  const members = ctx.roster.map((p) => ({ id: p.id, handle: p.handle, kind: p.kind }));
  const openThread = () => app.go({ code, ch: m.ch, thread: m.id });
  const explainClosed = () => app.toast({ ...EDIT_CLOSED, duration: 8000, ...(ctx.inThread ? {} : { actionLabel: 'Reply in thread', onAction: openThread }) });
  const saveEdit = (t: string) => {
    useApp.setState({ editing: null });
    // The window can close while the editor is open; say so instead of publishing an edit nobody will apply.
    if (editLeft(m.ts, Date.now()) === 0) {
      explainClosed();
      return;
    }
    app.publish(code, { t: 'edit', ch: m.ch, ...addressed(m.ch, me), b: { target: m.id, text: t } });
  };
  return (
    <div data-mid={m.id}>
      {/* A thread reply also shown in the channel: point back to the conversation it answers. */}
      {!ctx.inThread && m.alsoInChannel && m.parent && <AlsoInChannel m={{ ...m, parent: m.parent }} state={state} code={code} />}
      <ChatMessage
        author={author}
        time={fmtTime(m.ts)}
        members={members}
        meId={me}
        tone={messageTone(m, author, mine, ctx)}
        continued={continued}
        edited={m.edited}
        pinned={pinned}
        status={peer?.queued.has(m.id) ? 'queued' : 'sent'}
        reactions={reactions}
        onReact={(icon) => app.publish(code, { t: 'react', ch: m.ch, ...addressed(m.ch, me), b: { target: m.id, icon, on: !m.reactions[icon]?.includes(me) } })}
        onPin={m.ch.includes(':') ? undefined : () => app.publish(code, { t: 'pin', b: { target: m.id, on: !pinned } })}
        replies={threadSummary(m, ctx)}
        onReplies={openThread}
        onReply={ctx.inThread ? undefined : openThread}
        onEdit={canEdit ? () => useApp.setState({ editing: m.id }) : undefined}
        onDelete={canEdit ? () => deleteWithUndo(m, ctx) : undefined}
        editLabel={'Edit · ' + editLeftLabel(left)}
        locked={mine && !canEdit}
        lockedLabel="Edit window closed"
        onLocked={explainClosed}
        onAuthor={() => app.setPanel({ type: 'profile', id: authorKey(m) })}
        activity={activityOf(m)}
        highlighted={highlight === m.id}
        editor={editing === m.id ? <InlineEditor initial={text} left={left} onSave={saveEdit} onCancel={() => useApp.setState({ editing: null })} /> : undefined}
      >
        {text && <MentionText text={text} members={members} meId={me} onMention={(mm) => app.setPanel({ type: 'profile', id: mm.id })} />}
        {m.files.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: text ? 6 : 0 }}>
            {m.files.map((f) => (
              <Attachment key={f.id} f={f} code={code} />
            ))}
          </div>
        )}
      </ChatMessage>
      {m.approval && <Approval approval={m.approval} state={state} author={author} />}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { ChatMessage, MentionText, ApprovalCard, Button, Kbd, Icon, IconButton } from '@yurt/ui';
import { EDIT_WINDOW_MS, mentions, type Msg, type WsState, type WorkspacePeer, type FileRef } from '@yurt/protocol';
import { useApp } from '../store';
import { personFor, authorKey, type Person } from '../model';
import { blobsDb } from '../lib/db';
import { fmtTime, fmtBytes } from '../lib/format';

const pendingDeletes = new Set<string>();

function useBlobUrl(f: FileRef): { url: string | null; progress?: number } {
  const tick = useApp((s) => s.blobTick);
  const progress = useApp((s) => s.blobProgress[f.id]);
  const [url, setUrl] = useState<string | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    blobsDb.get(f.id).then((buf) => {
      if (!alive) return;
      if (buf) { u = URL.createObjectURL(new Blob([buf], { type: f.type })); setUrl(u); }
      else if (!asked.current) { asked.current = true; useApp.getState().fetchBlob(f.id); }
    });
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [f.id, tick]);
  return { url, progress };
}

function Attachment({ f }: { f: FileRef }) {
  const { url, progress } = useBlobUrl(f);
  const isImg = f.type.startsWith('image/');
  if (isImg && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-subtle)', maxWidth: 360, width: 'fit-content' }}>
        <img src={url} alt={f.name} style={{ display: 'block', maxWidth: '100%', maxHeight: 280, objectFit: 'cover' }} />
      </a>
    );
  }
  // Relay workspaces fetch sealed files from Blossom; Trystero ones need a member who has the file online.
  const note = url ? fmtBytes(f.size) : progress != null && progress < 1 ? 'Fetching · ' + Math.round(progress * 100) + '%'
    : fmtBytes(f.size) + (f.blob ? ' · downloading' : ' · waiting for a peer who has it');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 8px', borderRadius: 12, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', minWidth: 220, maxWidth: 360 }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}><Icon name={isImg ? 'image' : 'file-text'} size={16} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
        <span style={{ font: '400 11px/1.2 var(--font-mono)', color: 'var(--text-subtle)' }}>{note}</span>
      </span>
      {url
        ? <a href={url} download={f.name} aria-label={'Download ' + f.name} style={{ display: 'flex', color: 'var(--text-muted)', padding: 6 }}><Icon name="download" size={16} /></a>
        : <IconButton icon="refresh-cw" label={f.blob ? 'Try downloading again' : 'Ask peers again'} size="sm" onClick={() => useApp.getState().fetchBlob(f.id)} />}
    </div>
  );
}

export function InlineEditor({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} aria-label="Edit message" rows={2}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); v.trim() && onSave(v.trim()); } if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '8px 12px', borderRadius: 12, border: '1.5px solid var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft)', background: 'var(--surface-card)', color: 'var(--text-body)', font: '400 14.5px/1.5 var(--font-body)', outline: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-subtle)', flexWrap: 'wrap' }}>
        <Button size="sm" variant="primary" onClick={() => v.trim() && onSave(v.trim())}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Kbd keys="enter" size="sm" /> save <Kbd keys="esc" size="sm" /> cancel</span>
      </div>
    </div>
  );
}

export interface MsgCtx {
  state: WsState; peer?: WorkspacePeer; me: string; handle: string; roster: Person[]; code: string; inThread?: boolean;
  forceRender(): void;
}

export function MessageItem({ m, continued, ctx }: { m: Msg; continued: boolean; ctx: MsgCtx }) {
  const editing = useApp((s) => s.editing);
  const highlight = useApp((s) => s.highlight);
  const { state, peer, me, code } = ctx;
  const app = useApp.getState();
  if (pendingDeletes.has(m.id)) return null;
  if (m.deleted) {
    return <div data-mid={m.id} style={{ padding: '4px 16px 4px 58px', fontSize: 13, fontStyle: 'italic', color: 'var(--text-subtle)' }}>Message deleted{m.replies.length ? ' · ' + m.replies.length + ' replies' : ''}</div>;
  }
  const author = personFor(state, peer, authorKey(m), me);
  const mine = m.a === me && !m.ag;
  const canEdit = mine && Date.now() - m.ts < EDIT_WINDOW_MS;
  const text = m.text;
  const mentionsMe = !mine && mentions(text).includes(ctx.handle);
  const agentTalk = author.kind === 'agent' && mentions(text).some((h) => ctx.roster.some((p) => p.kind === 'agent' && p.handle.toLowerCase() === h));
  const pinned = !!state.pins.get(m.ch)?.has(m.id);
  const reactions = Object.entries(m.reactions).map(([icon, who]) => ({ icon: icon as any, count: who.length, mine: who.includes(me) }));
  const lastReply = m.replies.length ? state.msgs.get(m.replies[m.replies.length - 1]) : undefined;
  const replyPeople = [...new Set(m.replies.map((id) => { const r = state.msgs.get(id); return r ? authorKey(r) : ''; }).filter(Boolean))].slice(0, 3).map((k) => personFor(state, peer, k, me));
  const activity = m.trace?.length ? {
    summary: m.trace.length + (m.trace.length === 1 ? ' step' : ' steps'),
    meta: m.meta,
    steps: m.trace.map((s) => ({ status: s.status, title: s.title, tool: s.tool, meta: s.ms != null ? (s.ms / 1000).toFixed(1) + 's' : undefined, detail: s.detail })),
  } : undefined;
  const openThread = () => app.go({ code, ch: m.ch, thread: m.id });
  const onDelete = () => {
    pendingDeletes.add(m.id);
    ctx.forceRender();
    const t = setTimeout(() => { pendingDeletes.delete(m.id); app.publish(code, { t: 'del', b: { target: m.id }, ch: m.ch, to: m.to }); }, 5000);
    app.toast({ title: 'Message deleted', actionLabel: 'Undo', duration: 5000, onAction: () => { clearTimeout(t); pendingDeletes.delete(m.id); ctx.forceRender(); } });
  };
  const approval = m.approval;
  const decided = approval ? state.approvals.get(approval.req) : undefined;
  const decidedKind = approval && decided ? approval.options.find((o) => o.id === decided)?.kind || '' : '';
  return (
    <div data-mid={m.id}>
      <ChatMessage
        author={author as any} time={fmtTime(m.ts)} members={ctx.roster.map((p) => ({ id: p.id, handle: p.handle, kind: p.kind }))} meId={me}
        tone={mentionsMe ? 'mention' : agentTalk ? 'agent' : 'default'} continued={continued} edited={m.edited} pinned={pinned}
        status={peer?.queued.has(m.id) ? 'queued' : 'sent'} reactions={reactions}
        onReact={(icon) => app.publish(code, { t: 'react', ch: m.ch, to: m.to, b: { target: m.id, icon, on: !m.reactions[icon]?.includes(me) } })}
        onPin={m.ch.includes(':') ? undefined : () => app.publish(code, { t: 'pin', b: { target: m.id, on: !pinned } })}
        replies={!ctx.inThread && m.replies.length ? { count: m.replies.length, last: lastReply ? 'Last reply ' + fmtTime(lastReply.ts) : undefined, people: replyPeople as any } : undefined}
        onReplies={openThread} onReply={ctx.inThread ? undefined : openThread}
        onEdit={canEdit ? () => useApp.setState({ editing: m.id }) : undefined}
        onDelete={canEdit ? onDelete : undefined}
        onAuthor={() => app.setPanel({ type: 'profile', id: authorKey(m) })}
        onMention={(mm) => app.setPanel({ type: 'profile', id: mm.id })}
        activity={activity} highlighted={highlight === m.id}
        editor={editing === m.id ? <InlineEditor initial={text} onSave={(t) => { app.publish(code, { t: 'edit', ch: m.ch, to: m.to, b: { target: m.id, text: t } }); useApp.setState({ editing: null }); }} onCancel={() => useApp.setState({ editing: null })} /> : undefined}
      >
        {text && <MentionText text={text} members={ctx.roster.map((p) => ({ id: p.id, handle: p.handle, kind: p.kind }))} meId={me} onMention={(mm) => app.setPanel({ type: 'profile', id: mm.id })} />}
        {m.files.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: text ? 6 : 0 }}>{m.files.map((f) => <Attachment key={f.id} f={f} />)}</div>}
      </ChatMessage>
      {approval && (
        <div style={{ padding: '2px 16px 10px 58px', display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 640 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-subtle)' }}><Icon name="eye-off" size={12} />Only you see this · {author.name} is yours</span>
          <ApprovalCard title={approval.title} description={approval.kind ? 'Tool kind: ' + approval.kind + '. Not on the auto-approve list.' : undefined} risk={approval.kind === 'execute' || approval.kind === 'delete' ? 'high' : approval.kind === 'edit' ? 'medium' : 'low'}
            status={!decided ? 'pending' : decidedKind.startsWith('allow') ? 'approved' : 'rejected'} approveLabel="Allow once"
            onApprove={() => { const o = approval.options.find((x) => x.kind === 'allow_once') || approval.options.find((x) => x.kind.startsWith('allow')); o && app.approve(approval.req, o.id); }}
            onReject={() => { const o = approval.options.find((x) => x.kind.startsWith('reject')); o && app.approve(approval.req, o.id); }} />
        </div>
      )}
    </div>
  );
}

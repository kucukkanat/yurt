import { useEffect, useRef, useState } from 'react';
import { Avatar, Badge, Button, Icon, IconButton, Input } from '@yurt/ui';
import { boardNotes, docText, newId, NOTE_COLORS, type Doc, type Note, type Presence, type WorkspacePeer, type WsState } from '@yurt/protocol';
import { useApp } from '../store';
import { useCurrent, personFor, authorKey } from '../model';
import { agentsOn, lineAt, presenceList } from '../lib/collab';
import { Viewers } from './Collab';
import { must } from './must';

/** How long typing settles before it's sent as one op. */
const EDIT_MS = 400;
const DOC_ICON = { text: 'file-text', board: 'layers' } as const;

/** A doc or board in the side panel: title, who's in it (people and agents), and the content. */
export function DocPanel({ id, state }: { id: string; state: WsState }) {
  const { peer, identity } = useCurrent();
  const d = state.docs.get(id);
  if (!d) return <p style={{ padding: 16, color: 'var(--text-subtle)' }}>This doc hasn’t arrived yet.</p>;
  const presence = presenceList(peer);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <DocHeader d={d} state={state} peer={peer} me={identity.pub} presence={presence} />
      {d.kind === 'board' ? <Board d={d} me={identity.pub} /> : <TextDoc key={d.id} d={d} state={state} peer={peer} me={identity.pub} presence={presence} />}
    </div>
  );
}

interface DocProps {
  d: Doc;
  state: WsState;
  peer: WorkspacePeer | undefined;
  me: string;
  presence: Presence[];
}

function DocHeader({ d, state, peer, me, presence }: DocProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(d.title);
  const app = useApp.getState();
  const agents = agentsOn(presence, 'doc:' + d.id).map((k) => personFor(state, peer, k, me));
  const save = () => {
    setEditing(false);
    if (title.trim() !== d.title) app.renameDoc(d.id, title || d.title);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
      <Icon name={DOC_ICON[d.kind]} size={16} />
      {editing ? (
        <form
          style={{ flex: 1 }}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input aria-label="Title" size="sm" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onBlur={save} />
        </form>
      ) : (
        <button
          type="button"
          data-testid="doc-title"
          onClick={() => {
            setTitle(d.title);
            setEditing(true);
          }}
          title="Rename"
          style={{
            flex: 1,
            minWidth: 0,
            padding: 0,
            border: 0,
            background: 'none',
            textAlign: 'left',
            cursor: 'text',
            font: '700 15px var(--font-display)',
            color: 'var(--text-strong)',
          }}
        >
          {d.title}
        </button>
      )}
      {agents.map((a) => (
        <Badge key={a.id} tone="agent" live size="sm">
          {a.name} is working
        </Badge>
      ))}
      <Viewers view={'doc:' + d.id} testId="doc-viewers" />
      <IconButton icon="list-checks" size="sm" label="Back to docs" onClick={() => app.setPanel({ type: 'work', id: 'docs' })} />
      <IconButton icon="trash-2" size="sm" label="Archive" onClick={() => app.archiveDoc(d.id)} />
    </div>
  );
}

/** Others' carets in this doc: who, and on which line. */
const cursorsIn = (presence: Presence[], doc: string, me: string) =>
  presence.flatMap((p) => (!p.bridge && p.pub !== me && p.cur?.doc === doc ? [{ pub: p.pub, line: p.cur.line }] : []));

/**
 * A text doc everyone edits at once. Typing is sent as CRDT ops (only the changed span), so concurrent edits merge.
 * Others' changes replace the text unless I'm mid-edit; my caret stays where it was.
 */
function TextDoc({ d, state, peer, me, presence }: DocProps) {
  const remote = docText(d.ops);
  const [text, setText] = useState(remote);
  /** Typed here and not sent yet (it goes after EDIT_MS, on blur, or on leaving the doc). */
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(d);
  latest.current = d;
  const app = useApp.getState();
  useEffect(() => {
    if (pending.current !== null || remote === text) return;
    setText(remote);
    // A new value puts the browser's caret at the end; keep it where it was while I'm in the doc.
    const el = must(area.current, 'effects run with the textarea mounted');
    if (el === document.activeElement) {
      const [from, to] = [el.selectionStart, el.selectionEnd];
      requestAnimationFrame(() => el.setSelectionRange(from, to));
    }
  }, [remote, text]);
  const flush = () => {
    clearTimeout(timer.current);
    const v = pending.current;
    pending.current = null;
    if (v !== null) useApp.getState().editDoc(latest.current, v);
  };
  // Leaving the doc (or the panel) with typing still settling sends it, and takes my caret away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on leaving; flush reads refs only
  useEffect(
    () => () => {
      flush();
      useApp.getState().setCursor();
    },
    [],
  );
  const caret = (el: HTMLTextAreaElement) => app.setCursor({ doc: d.id, line: lineAt(el.value, el.selectionStart) });
  const cursors = cursorsIn(presence, d.id, me);
  const open = d.suggestions.filter((x) => x.status === 'open');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <textarea
        ref={area}
        aria-label={d.title}
        data-testid="doc-text"
        value={text}
        placeholder="Write together. Markdown works."
        onChange={(e) => {
          setText(e.target.value);
          pending.current = e.target.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, EDIT_MS);
          caret(e.target);
        }}
        onSelect={(e) => caret(e.currentTarget)}
        onBlur={flush}
        style={{
          flex: 1,
          minHeight: 200,
          margin: 0,
          padding: '14px 16px',
          border: 0,
          resize: 'none',
          outline: 'none',
          background: 'var(--surface-page)',
          color: 'var(--text-body)',
          font: '400 14.5px/1.6 var(--font-body)',
        }}
      />
      {cursors.length > 0 && (
        <div
          data-testid="doc-cursors"
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '6px 16px', borderTop: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--text-subtle)' }}
        >
          {cursors.map((c) => {
            const p = personFor(state, peer, c.pub, me);
            return (
              <span key={c.pub} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Avatar name={p.name} size={14} decorative />
                {p.name} · line {c.line + 1}
              </span>
            );
          })}
        </div>
      )}
      {open.length > 0 && (
        <section
          aria-label="Suggestions"
          style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderTop: '1px solid var(--border-subtle)', maxHeight: '40%', overflow: 'auto' }}
        >
          {open.map((x) => (
            <div
              key={x.id}
              data-testid="suggestion"
              style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 12, background: 'var(--surface-sunken)' }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                {personFor(state, peer, authorKey(x), me).name} suggests{x.note && ': ' + x.note}
              </span>
              <span style={{ fontSize: 13 }}>
                <del style={{ color: 'var(--danger-ink)' }}>{x.find}</del> <ins style={{ color: 'var(--success-ink)', textDecoration: 'none' }}>{x.replace}</ins>
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" variant="primary" data-testid="suggestion-accept" onClick={() => app.resolveSuggestion(d, x, true)}>
                  Accept
                </Button>
                <Button size="sm" variant="ghost" data-testid="suggestion-reject" onClick={() => app.resolveSuggestion(d, x, false)}>
                  Reject
                </Button>
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const NOTE_BG: Record<Note['color'], string> = {
  yellow: 'color-mix(in oklab, gold 30%, var(--surface-card))',
  pink: 'color-mix(in oklab, hotpink 22%, var(--surface-card))',
  blue: 'color-mix(in oklab, deepskyblue 22%, var(--surface-card))',
  green: 'color-mix(in oklab, mediumseagreen 24%, var(--surface-card))',
  purple: 'color-mix(in oklab, mediumpurple 26%, var(--surface-card))',
};
const NOTE_W = 160;

/** A board of sticky notes: add, drag, edit, recolor and remove; everyone's changes merge. */
function Board({ d, me }: { d: Doc; me: string }) {
  const notes = boardNotes(d.ops);
  const app = useApp.getState();
  const add = () => {
    const n = notes.length;
    app.putNote(d, { id: newId(), text: '', x: 20 + (n % 4) * (NOTE_W + 16), y: 20 + Math.floor(n / 4) * 140, color: 'yellow', by: me });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        <Button size="sm" variant="secondary" iconLeft="plus" onClick={add} data-testid="board-add">
          Add a note
        </Button>
      </div>
      <div data-testid="board" style={{ position: 'relative', flex: 1, overflow: 'auto', background: 'var(--surface-sunken)' }}>
        <div style={{ position: 'relative', minWidth: Math.max(0, ...notes.map((n) => n.x + NOTE_W + 20)), minHeight: Math.max(0, ...notes.map((n) => n.y + 160)) }}>
          {notes.map((n) => (
            <StickyNote key={n.id} n={n} d={d} />
          ))}
        </div>
        {!notes.length && (
          <p style={{ padding: 24, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>An empty board. Add notes, drag them around, and ask an agent to sort them.</p>
        )}
      </div>
    </div>
  );
}

/** Where a note is while it's dragged: the pointer's offset into it, and where it would land. */
interface Drag {
  dx: number;
  dy: number;
  x: number;
  y: number;
}

function StickyNote({ n, d }: { n: Note; d: Doc }) {
  const [text, setText] = useState(n.text);
  const [drag, setDrag] = useState<Drag | null>(null);
  const app = useApp.getState();
  const field = useRef<HTMLTextAreaElement>(null);
  // Someone else changed it: take theirs unless I'm typing in it.
  useEffect(() => {
    if (document.activeElement !== field.current) setText(n.text);
  }, [n.text]);
  const put = (p: Partial<Note>) => app.putNote(d, { ...n, text, ...p });
  const pos = drag ?? n;
  const end = () => {
    if (drag && (drag.x !== n.x || drag.y !== n.y)) put({ x: Math.round(drag.x), y: Math.round(drag.y) });
    setDrag(null);
  };
  return (
    <div
      data-testid={'note-' + n.id}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: NOTE_W,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10,
        background: NOTE_BG[n.color],
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div
        title="Drag to move"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ dx: e.clientX - n.x, dy: e.clientY - n.y, x: n.x, y: n.y });
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, x: Math.max(0, e.clientX - drag.dx), y: Math.max(0, e.clientY - drag.dy) })}
        onPointerUp={end}
        style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '2px 4px', cursor: 'grab', touchAction: 'none' }}
      >
        {NOTE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={'Color ' + c}
            aria-pressed={c === n.color}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => put({ color: c })}
            style={{
              width: 12,
              height: 12,
              padding: 0,
              borderRadius: 99,
              border: '1px solid var(--border-default)',
              outline: c === n.color ? '2px solid var(--text-strong)' : undefined,
              background: NOTE_BG[c],
              cursor: 'pointer',
            }}
          />
        ))}
        <span style={{ flex: 1 }} />
        <IconButton icon="x" size="sm" label="Remove note" onPointerDown={(e) => e.stopPropagation()} onClick={() => app.removeNote(d, n.id)} />
      </div>
      <textarea
        ref={field}
        aria-label="Note"
        value={text}
        placeholder="Write something"
        rows={4}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== n.text && put({})}
        style={{
          margin: 0,
          padding: '4px 10px 10px',
          border: 0,
          resize: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--text-body)',
          font: '400 13px/1.45 var(--font-body)',
        }}
      />
    </div>
  );
}

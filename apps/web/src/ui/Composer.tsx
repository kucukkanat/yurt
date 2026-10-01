import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { IconButton, Kbd, MemberRow, Tag } from '@yurt/ui';
import { editLeft, EDIT_CLOSED } from '../lib/editWindow';
import { useApp } from '../store';
import type { Person } from '../model';

interface Props {
  members: Person[];
  placeholder: string;
  note?: React.ReactNode;
  /** Resolves true once sent; on false the draft stays so nothing typed or attached is lost. */
  onSend(text: string, files: File[]): Promise<boolean>;
  onTyping?(): void;
  autoFocus?: boolean;
  dropFiles?: File[];
}

// Stable React keys for attached files: two attachments can share a name, and indexes shift on removal.
const fileKeys = new WeakMap<File, number>();
let nextFileKey = 0;
const fileKey = (f: File) => {
  const k = fileKeys.get(f) ?? nextFileKey++;
  fileKeys.set(f, k);
  return k;
};

/** Up-arrow in an empty composer: edit your last message here, or say why you can't. */
function editLastMessage(): boolean {
  const s = useApp.getState();
  const st = s.route.code ? s.states[s.route.code] : undefined;
  const ids = st && s.route.ch ? st.channelMsgs.get(s.route.ch) || [] : [];
  const mine = ids
    .map((id) => st?.msgs.get(id))
    .reverse()
    .find((m) => !!m && m.a === s.identity?.pub && !m.ag && !m.deleted);
  if (!mine) return false;
  if (editLeft(mine.ts, Date.now()) > 0) useApp.setState({ editing: mine.id });
  else s.toast({ ...EDIT_CLOSED, title: 'Your last message can’t be edited anymore', duration: 6000 });
  return true;
}

export function Composer({ members, placeholder, note, onSend, onTyping, autoFocus, dropFiles }: Props) {
  const [v, setV] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [focus, setFocus] = useState(false);
  const [sending, setSending] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dropFiles?.length) setFiles((f) => [...f, ...dropFiles]);
  }, [dropFiles]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measures the textarea whenever its text changes, however it changed
  useEffect(() => {
    const t = ta.current;
    if (t) {
      t.style.height = 'auto';
      t.style.height = Math.min(t.scrollHeight, 200) + 'px';
    }
  }, [v]);
  useEffect(() => {
    if (autoFocus && matchMedia('(pointer: fine)').matches) ta.current?.focus();
  }, [autoFocus]);
  const q = (pick || '').toLowerCase();
  const matches = pick == null ? [] : members.filter((m) => m.handle.toLowerCase().startsWith(q) || m.name.toLowerCase().startsWith(q)).slice(0, 6);
  const sync = (val: string, caret: number) => {
    const m = val.slice(0, caret).match(/@([\w-]*)$/);
    setPick(m ? m[1] : null);
    setIdx(0);
  };
  const insert = (m: Person) => {
    const t = ta.current;
    if (!t) return;
    const caret = t.selectionStart;
    const before = v.slice(0, caret).replace(/@([\w-]*)$/, '@' + m.handle + ' ');
    setV(before + v.slice(caret));
    setPick(null);
    requestAnimationFrame(() => {
      t.focus();
      t.selectionStart = t.selectionEnd = before.length;
    });
  };
  const send = async () => {
    if (sending || (!v.trim() && !files.length)) return;
    const [text, sent] = [v, files];
    setSending(true);
    const ok = await onSend(text.trim(), sent).finally(() => setSending(false));
    if (!ok) return;
    // Clear only what was sent: anything typed or attached during a slow upload stays.
    setV((cur) => (cur === text ? '' : cur));
    setFiles((cur) => cur.filter((f) => !sent.includes(f)));
    setPick(null);
  };
  /** Arrow keys, Enter/Tab and Escape drive the @-mention picker while it's open. True when the key was used. */
  const pickerKey = (e: React.KeyboardEvent): boolean => {
    const n = matches.length;
    const moves: Record<string, () => void> = {
      ArrowDown: () => setIdx((i) => (i + 1) % n),
      ArrowUp: () => setIdx((i) => (i - 1 + n) % n),
      Enter: () => insert(matches[idx]),
      Tab: () => insert(matches[idx]),
      Escape: () => {
        e.stopPropagation();
        setPick(null);
      },
    };
    const move = n ? moves[e.key] : undefined;
    if (!move) return false;
    e.preventDefault();
    move();
    return true;
  };
  const key = (e: React.KeyboardEvent) => {
    if (pickerKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
    // Edit your last message, like every chat app since forever.
    if (e.key === 'ArrowUp' && !v && editLastMessage()) e.preventDefault();
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const fs = Array.from(e.clipboardData.files || []);
    if (fs.length) {
      e.preventDefault();
      setFiles((f) => [...f, ...fs]);
    }
  };
  return (
    <div data-testid="composer" style={{ position: 'relative' }}>
      {matches.length > 0 && (
        <div
          role="listbox"
          aria-label="Mention someone"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 'calc(100% + 8px)',
            width: 320,
            maxWidth: '100%',
            padding: 6,
            borderRadius: 16,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 20,
            animation: 'ag-rise var(--dur-fast) var(--ease-out)',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle)', padding: '4px 8px 6px' }}>
            People and agents
          </div>
          {matches.map((m, i) => (
            <div
              key={m.id}
              role="option"
              aria-selected={i === idx}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(m);
              }}
              onMouseEnter={() => setIdx(i)}
            >
              <MemberRow member={m} active={i === idx} cutout="var(--surface-raised)" trailing={i === idx ? <Kbd keys="enter" size="sm" /> : null} />
            </div>
          ))}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '10px 10px 8px 14px',
          borderRadius: 18,
          background: 'var(--surface-card)',
          border: '1.5px solid ' + (focus ? 'var(--accent)' : 'var(--border-default)'),
          boxShadow: focus ? '0 0 0 3px var(--accent-soft)' : 'var(--shadow-sm)',
          transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
        }}
      >
        {files.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {files.map((f) => (
              <Tag key={fileKey(f)} icon={f.type.startsWith('image') ? 'image' : 'file-text'} onRemove={() => setFiles(files.filter((x) => x !== f))}>
                {f.name}
              </Tag>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          value={v}
          rows={1}
          aria-label={placeholder}
          placeholder={placeholder}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setFocus(false);
            setTimeout(() => setPick(null), 100);
          }}
          onChange={(e) => {
            setV(e.target.value);
            sync(e.target.value, e.target.selectionStart);
            if (e.target.value) onTyping?.();
          }}
          onKeyDown={key}
          onPaste={onPaste}
          style={{
            resize: 'none',
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: 'var(--text-body)',
            font: '400 14.5px/1.5 var(--font-body)',
            padding: '2px 0',
            boxShadow: 'none',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <input
            ref={fileIn}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              setFiles([...files, ...Array.from(e.target.files || [])]);
              e.target.value = '';
            }}
          />
          <IconButton icon="paperclip" label="Attach files (up to 25 MB)" size="sm" onClick={() => fileIn.current?.click()} />
          <IconButton
            icon="at-sign"
            label="Mention"
            size="sm"
            onClick={() => {
              const nv = v + (v && !v.endsWith(' ') ? ' @' : '@');
              setV(nv);
              sync(nv, nv.length);
              ta.current?.focus();
            }}
          />
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-subtle)', paddingLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {note}
          </span>
          <IconButton
            icon="arrow-up"
            label="Send"
            variant="primary"
            round
            size="sm"
            disabled={sending || (!v.trim() && !files.length)}
            onClick={send}
            data-testid="composer-send"
          />
        </div>
      </div>
    </div>
  );
}

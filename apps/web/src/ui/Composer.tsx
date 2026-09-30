import React, { useEffect, useRef, useState } from 'react';
import { IconButton, Kbd, MemberRow, Tag } from '@yurt/ui';
import { useApp } from '../store';
import type { Person } from '../model';

interface Props {
  members: Person[];
  placeholder: string;
  note?: React.ReactNode;
  onSend(text: string, files: File[]): void;
  onTyping?(): void;
  autoFocus?: boolean;
  dropFiles?: File[];
}

export function Composer({ members, placeholder, note, onSend, onTyping, autoFocus, dropFiles }: Props) {
  const [v, setV] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [focus, setFocus] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  useEffect(() => { if (dropFiles?.length) setFiles((f) => [...f, ...dropFiles]); }, [dropFiles]);
  useEffect(() => { const t = ta.current; if (t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 200) + 'px'; } }, [v]);
  useEffect(() => { if (autoFocus && matchMedia('(pointer: fine)').matches) ta.current?.focus(); }, [autoFocus, placeholder]);
  const q = (pick || '').toLowerCase();
  const matches = pick == null ? [] : members.filter((m) => m.handle.toLowerCase().startsWith(q) || m.name.toLowerCase().startsWith(q)).slice(0, 6);
  const sync = (val: string, caret: number) => { const m = val.slice(0, caret).match(/@([\w-]*)$/); setPick(m ? m[1] : null); setIdx(0); };
  const insert = (m: Person) => {
    const t = ta.current!;
    const caret = t.selectionStart;
    const before = v.slice(0, caret).replace(/@([\w-]*)$/, '@' + m.handle + ' ');
    setV(before + v.slice(caret));
    setPick(null);
    requestAnimationFrame(() => { t.focus(); t.selectionStart = t.selectionEnd = before.length; });
  };
  const send = () => { if (!v.trim() && !files.length) return; onSend(v.trim(), files); setV(''); setFiles([]); setPick(null); };
  const key = (e: React.KeyboardEvent) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matches[idx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPick(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'ArrowUp' && !v) {
      // Edit your last message, like every chat app since forever.
      const s = useApp.getState();
      const st = s.route.code ? s.states[s.route.code] : undefined;
      const ids = st && s.route.ch ? st.channelMsgs.get(s.route.ch) || [] : [];
      for (let i = ids.length - 1; i >= 0; i--) { const m = st!.msgs.get(ids[i])!; if (m.a === s.identity?.pub && !m.ag && !m.deleted) { if (Date.now() - m.ts < 15 * 60 * 1000) { e.preventDefault(); useApp.setState({ editing: m.id }); } break; } }
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const fs = Array.from(e.clipboardData.files || []);
    if (fs.length) { e.preventDefault(); setFiles((f) => [...f, ...fs]); }
  };
  return (
    <div style={{ position: 'relative' }}>
      {matches.length > 0 && (
        <div role="listbox" aria-label="Mention someone" style={{ position: 'absolute', left: 0, bottom: 'calc(100% + 8px)', width: 320, maxWidth: '100%', padding: 6, borderRadius: 16, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-lg)', zIndex: 20, animation: 'ag-rise var(--dur-fast) var(--ease-out)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle)', padding: '4px 8px 6px' }}>People and agents</div>
          {matches.map((m, i) => (
            <div key={m.id} role="option" aria-selected={i === idx} onMouseDown={(e) => { e.preventDefault(); insert(m); }} onMouseEnter={() => setIdx(i)}>
              <MemberRow member={m as any} active={i === idx} cutout="var(--surface-raised)" trailing={i === idx ? <Kbd keys="enter" size="sm" /> : null} />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 10px 8px 14px', borderRadius: 18, background: 'var(--surface-card)', border: '1.5px solid ' + (focus ? 'var(--accent)' : 'var(--border-default)'), boxShadow: focus ? '0 0 0 3px var(--accent-soft)' : 'var(--shadow-sm)', transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)' }}>
        {files.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {files.map((f, i) => <Tag key={f.name + i} icon={f.type.startsWith('image') ? 'image' : 'file-text'} onRemove={() => setFiles(files.filter((_, j) => j !== i))}>{f.name}</Tag>)}
          </div>
        )}
        <textarea ref={ta} value={v} rows={1} aria-label={placeholder} placeholder={placeholder}
          onFocus={() => setFocus(true)} onBlur={() => { setFocus(false); setTimeout(() => setPick(null), 100); }}
          onChange={(e) => { setV(e.target.value); sync(e.target.value, e.target.selectionStart); if (e.target.value) onTyping?.(); }} onKeyDown={key} onPaste={onPaste}
          style={{ resize: 'none', border: 0, outline: 'none', background: 'transparent', color: 'var(--text-body)', font: '400 14.5px/1.5 var(--font-body)', padding: '2px 0', boxShadow: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <input ref={fileIn} type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])]); e.target.value = ''; }} />
          <IconButton icon="paperclip" label="Attach files (up to 25 MB)" size="sm" onClick={() => fileIn.current?.click()} />
          <IconButton icon="at-sign" label="Mention" size="sm" onClick={() => { const nv = v + (v && !v.endsWith(' ') ? ' @' : '@'); setV(nv); sync(nv, nv.length); ta.current?.focus(); }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-subtle)', paddingLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</span>
          <IconButton icon="arrow-up" label="Send" variant="primary" round size="sm" disabled={!v.trim() && !files.length} onClick={send} />
        </div>
      </div>
    </div>
  );
}

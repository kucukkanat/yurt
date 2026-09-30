import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Kbd } from '../core/Kbd.jsx';
import { IconButton } from '../actions/IconButton.jsx';
import { Button } from '../actions/Button.jsx';

export function PromptComposer({
  value, defaultValue = '', onChange, onSubmit, running = false, onStop, placeholder = 'Ask, or describe what you want done…',
  context, toolbar, suggestions, onSuggestion, autoFocus = false, label = 'Message the agent', style,
}) {
  const [inner, setInner] = React.useState(defaultValue);
  const v = value !== undefined ? value : inner;
  const set = (x) => { setInner(x); onChange && onChange(x); };
  const [focus, setFocus] = React.useState(false);
  const ta = React.useRef(null);
  React.useLayoutEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 220) + 'px'; }, [v]);
  const submit = () => { if (!v.trim() || running) return; onSubmit && onSubmit(v.trim()); if (value === undefined) setInner(''); };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && running && onStop) { e.preventDefault(); onStop(); }
  };
  const has = v.trim().length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {suggestions && suggestions.length > 0 && !has && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {suggestions.map((s, i) => (
            <button key={i} type="button" onClick={() => (onSuggestion ? onSuggestion(s) : set(s))} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 99, border: '1px solid var(--border-default)',
              background: 'var(--surface-card)', color: 'var(--text-body)', font: 'inherit', fontSize: 13, cursor: 'pointer',
              animation: 'ag-rise var(--dur-slow) var(--ease-spring) ' + i * 50 + 'ms both',
            }}><Icon name="sparkle" size={13} color="var(--volt-700)" />{s}</button>
          ))}
        </div>
      )}
      <div style={{
        position: 'relative', background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)',
        border: '1.5px solid ' + (running ? 'var(--volt-500)' : focus ? 'var(--accent)' : 'var(--border-default)'),
        boxShadow: running ? 'var(--glow-agent)' : focus ? '0 0 0 4px var(--accent-soft), var(--shadow-md)' : 'var(--shadow-sm)',
        transition: 'border-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)',
      }}>
        {context && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '12px 14px 0' }}>{context}</div>}
        <textarea
          ref={ta} rows={1} value={v} onChange={(e) => set(e.target.value)} onKeyDown={onKey} aria-label={label}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder={placeholder} autoFocus={autoFocus}
          style={{
            display: 'block', width: '100%', resize: 'none', border: 0, outline: 'none', background: 'transparent', boxShadow: 'none',
            padding: '14px 16px 6px', font: 'inherit', fontSize: 16, lineHeight: 1.5, color: 'var(--text-strong)', minHeight: 50,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px 8px 10px' }}>
          {toolbar || (<><IconButton icon="paperclip" label="Attach" size="sm" /><IconButton icon="mic" label="Dictate" size="sm" /></>)}
          <div style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-subtle)', marginRight: 6, opacity: focus || running ? 1 : 0, transition: 'opacity var(--dur-base)' }}>
            {running ? <><Kbd keys="esc" size="sm" /> to stop</> : <><Kbd keys="enter" size="sm" /> send <Kbd keys="shift+enter" size="sm" /> new line</>}
          </span>
          {running
            ? <Button variant="inverse" size="sm" iconLeft="square" onClick={onStop} style={{ borderRadius: 99 }}>Stop</Button>
            : <IconButton icon="arrow-up" label="Send" variant={has ? 'primary' : 'secondary'} round disabled={!has} onClick={submit} style={{ transform: has ? 'scale(1)' : 'scale(.9)' }} />}
        </div>
      </div>
    </div>
  );
}

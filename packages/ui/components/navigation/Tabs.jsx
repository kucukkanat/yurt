import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { useFocusVisible } from '../core/useInteraction.js';

const edgeScale = (show, hover) => {
  if (!show) return 0.7;
  return hover ? 1.08 : 1;
};

function EdgeButton({ side, onClick, show, pill }) {
  const [h, setH] = React.useState(false);
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={onClick}
      onPointerEnter={() => setH(true)}
      onPointerLeave={() => setH(false)}
      style={{
        position: 'absolute',
        top: '50%',
        [side]: pill ? 3 : 0,
        zIndex: 2,
        width: 28,
        height: 28,
        padding: 0,
        borderRadius: 99,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        color: 'var(--text-strong)',
        boxShadow: 'var(--shadow-sm)',
        opacity: show ? 1 : 0,
        pointerEvents: show ? 'auto' : 'none',
        transform: 'translateY(-50%) scale(' + edgeScale(show, h) + ')',
        transition: 'opacity var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-spring)',
      }}
    >
      <Icon name={side === 'left' ? 'chevron-left' : 'chevron-right'} size={15} strokeWidth={2.5} />
    </button>
  );
}

const FADE = 36;

/** Fades whichever edge has more tabs beyond it, so the overflow reads as scrollable. */
function edgeMask(edge) {
  const left = edge.l ? 'transparent 0, #000 ' + FADE + 'px' : '#000 0';
  const right = edge.r ? '#000 calc(100% - ' + FADE + 'px), transparent 100%' : '#000 100%';
  return 'linear-gradient(90deg, ' + left + ', ' + right + ')';
}

/** Arrow keys wrap around the enabled tabs; Home and End jump to the ends. */
function nextTab(items, i, key) {
  const en = items.filter((t) => !t.disabled);
  const idx = en.findIndex((t) => t.id === items[i].id);
  if (key === 'ArrowRight') return en[(idx + 1) % en.length];
  if (key === 'ArrowLeft') return en[(idx - 1 + en.length) % en.length];
  if (key === 'Home') return en[0];
  if (key === 'End') return en[en.length - 1];
  return null;
}

/** Where to scroll so `el` is fully visible with a peek of its neighbour, or null when it already is. */
function scrollTarget(s, el) {
  const peek = 40;
  const l = el.offsetLeft;
  const r = l + el.offsetWidth;
  if (l - peek < s.scrollLeft) return Math.max(0, l - peek);
  if (r + peek > s.scrollLeft + s.clientWidth) return r + peek - s.clientWidth;
  return null;
}

/** The sliding highlight under (underline) or behind (pill) the active tab. */
function Indicator({ ind, pill }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        top: pill ? ind.y : undefined,
        bottom: pill ? undefined : 0,
        width: ind.w,
        height: pill ? ind.h : 2.5,
        transform: 'translateX(' + ind.x + 'px)',
        background: pill ? 'var(--surface-card)' : 'var(--text-strong)',
        borderRadius: pill ? 8 : 2,
        boxShadow: pill ? 'var(--shadow-sm)' : 'none',
        transition: 'transform var(--dur-slow) var(--ease-spring), width var(--dur-slow) var(--ease-spring)',
      }}
    />
  );
}

function Count({ on, children }) {
  return (
    <span
      style={{
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: on ? 'var(--text-strong)' : 'var(--border-default)',
        color: on ? 'var(--surface-card)' : 'var(--text-muted)',
        transition: 'all var(--dur-fast)',
      }}
    >
      {children}
    </span>
  );
}

function Tab({ t, on, pill, size, fullWidth, tabRef, onSelect, onKeyDown }) {
  const [fv, focusHandlers] = useFocusVisible();
  const h = size === 'sm' ? 30 : 36;
  return (
    <button
      ref={tabRef}
      role="tab"
      type="button"
      aria-selected={on}
      tabIndex={on ? 0 : -1}
      disabled={t.disabled}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      {...focusHandlers}
      style={{
        position: 'relative',
        zIndex: 1,
        flex: fullWidth ? '1 0 auto' : '0 0 auto',
        justifyContent: 'center',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: pill ? h : h + 4,
        whiteSpace: 'nowrap',
        padding: pill ? '0 12px' : '0 2px',
        border: 0,
        background: 'transparent',
        borderRadius: 8,
        cursor: t.disabled ? 'not-allowed' : 'pointer',
        font: 'inherit',
        fontSize: size === 'sm' ? 13 : 14,
        fontWeight: on ? 600 : 500,
        color: on ? 'var(--text-strong)' : 'var(--text-muted)',
        opacity: t.disabled ? 0.4 : 1,
        outline: 'none',
        boxShadow: fv ? 'var(--focus-ring-inset)' : 'none',
        transition: 'color var(--dur-fast)',
      }}
    >
      {t.icon && <Icon name={t.icon} size={16} />}
      {t.label}
      {t.count != null && <Count on={on}>{t.count}</Count>}
    </button>
  );
}

export function Tabs({ items = [], value, defaultValue, onChange, variant = 'pill', size = 'md', fullWidth = false, label = 'Tabs', style }) {
  const [inner, setInner] = React.useState(defaultValue ?? items[0]?.id);
  const cur = value !== undefined ? value : inner;
  const refs = React.useRef({});
  const scroller = React.useRef(null);
  const list = React.useRef(null);
  const [ind, setInd] = React.useState(null);
  const [edge, setEdge] = React.useState({ l: false, r: false });
  const select = (id) => {
    setInner(id);
    onChange?.(id);
  };

  const measure = React.useCallback(() => {
    const el = refs.current[cur];
    if (el) setInd({ x: el.offsetLeft, w: el.offsetWidth, h: el.offsetHeight, y: el.offsetTop });
    const s = scroller.current;
    if (s) setEdge({ l: s.scrollLeft > 1, r: s.scrollLeft + s.clientWidth < s.scrollWidth - 1 });
  }, [cur]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: measure reads the DOM, so it must re-run when these change the layout even though it doesn't read them
  React.useLayoutEffect(() => {
    measure();
  }, [measure, items.length, variant, size, fullWidth]);
  React.useEffect(() => {
    const s = scroller.current;
    if (!s || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    if (list.current) ro.observe(list.current);
    return () => ro.disconnect();
  }, [measure]);
  React.useEffect(() => {
    document.fonts?.ready.then(measure);
  }, [measure]);

  // Keep the active tab fully visible, with a peek of its neighbour so the overflow reads as scrollable.
  React.useEffect(() => {
    const s = scroller.current;
    const el = refs.current[cur];
    const to = s && el ? scrollTarget(s, el) : null;
    if (to !== null) s.scrollTo({ left: to, behavior: 'smooth' });
  }, [cur]);

  const page = (dir) => {
    const s = scroller.current;
    s?.scrollBy({ left: dir * s.clientWidth * 0.7, behavior: 'smooth' });
  };

  const onKey = (e, i) => {
    const n = nextTab(items, i, e.key);
    if (!n) return;
    e.preventDefault();
    select(n.id);
    refs.current[n.id]?.focus({ preventScroll: true });
  };

  const pill = variant === 'pill';
  const mask = edgeMask(edge);

  return (
    <div
      style={{
        position: 'relative',
        display: fullWidth ? 'flex' : 'inline-flex',
        width: fullWidth ? '100%' : undefined,
        maxWidth: '100%',
        minWidth: 0,
        padding: pill ? 3 : 0,
        background: pill ? 'var(--surface-sunken)' : 'transparent',
        borderRadius: pill ? 'var(--radius-sm)' : 0,
        boxShadow: pill ? 'none' : 'inset 0 -1px 0 var(--border-subtle)',
        ...style,
      }}
    >
      <EdgeButton side="left" pill={pill} show={edge.l} onClick={() => page(-1)} />
      <div
        ref={scroller}
        onScroll={measure}
        style={{
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitMaskImage: mask,
          maskImage: mask,
          overscrollBehaviorX: 'contain',
        }}
      >
        <div
          ref={list}
          role="tablist"
          aria-label={label}
          aria-orientation="horizontal"
          style={{
            position: 'relative',
            display: 'flex',
            width: fullWidth ? '100%' : 'max-content',
            minWidth: '100%',
            gap: pill ? 2 : 20,
          }}
        >
          {ind && <Indicator ind={ind} pill={pill} />}
          {items.map((t, i) => (
            <Tab
              key={t.id}
              t={t}
              on={t.id === cur}
              pill={pill}
              size={size}
              fullWidth={fullWidth}
              tabRef={(el) => {
                refs.current[t.id] = el;
              }}
              onSelect={() => select(t.id)}
              onKeyDown={(e) => onKey(e, i)}
            />
          ))}
        </div>
      </div>
      <EdgeButton side="right" pill={pill} show={edge.r} onClick={() => page(1)} />
    </div>
  );
}

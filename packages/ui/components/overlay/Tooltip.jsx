import React from 'react';
import { Kbd } from '../core/Kbd.jsx';

export function Tooltip({ content, kbd, placement = 'top', delay = 350, children, forceOpen = false }) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef(null);
  const id = React.useId();
  const show = (now) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), now ? 0 : delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const vis = open || forceOpen;
  const top = placement === 'top';
  const child = React.isValidElement(children) ? React.cloneElement(children, { 'aria-describedby': vis ? id : undefined }) : children;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: listens to events bubbling from the trigger inside; the wrapper itself is never focused or clicked
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onPointerEnter={() => show(false)}
      onPointerLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide();
      }}
    >
      {child}
      <span
        role="tooltip"
        id={id}
        style={{
          position: 'absolute',
          left: '50%',
          [top ? 'bottom' : 'top']: 'calc(100% + 8px)',
          zIndex: 'var(--z-tooltip)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          padding: '6px 8px 6px 10px',
          borderRadius: 8,
          background: 'var(--ink-900)',
          color: '#fff',
          fontSize: 12.5,
          fontWeight: 500,
          lineHeight: 1.2,
          boxShadow: 'var(--shadow-md)',
          opacity: vis ? 1 : 0,
          transform: 'translateX(-50%) translateY(' + (vis ? 0 : top ? 4 : -4) + 'px) scale(' + (vis ? 1 : 0.96) + ')',
          transition: 'opacity var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-spring)',
          visibility: vis ? 'visible' : 'hidden',
        }}
      >
        {content}
        {kbd && <Kbd keys={kbd} tone="inverse" size="sm" />}
      </span>
    </span>
  );
}

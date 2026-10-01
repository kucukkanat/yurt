import React from 'react';

// Tracks hover / press / keyboard-focus so inline-styled components can render
// every state (inline box-shadow would otherwise swallow the global :focus-visible ring).
export function useInteraction(disabled) {
  const [s, set] = React.useState({ hover: false, press: false, focus: false });
  const up = (patch) => set((p) => ({ ...p, ...patch }));
  const handlers = {
    onPointerEnter: () => !disabled && up({ hover: true }),
    onPointerLeave: () => up({ hover: false, press: false }),
    onPointerDown: () => !disabled && up({ press: true }),
    onPointerUp: () => up({ press: false }),
    onFocus: (e) => {
      let fv = true;
      try {
        fv = e.currentTarget.matches(':focus-visible');
      } catch (_) {}
      up({ focus: fv });
    },
    onBlur: () => up({ focus: false, press: false }),
    onKeyDown: (e) => {
      if (!disabled && (e.key === ' ' || e.key === 'Enter')) up({ press: true });
    },
    onKeyUp: () => up({ press: false }),
  };
  return [s, handlers];
}

// Calls ours, then the consumer's handler of the same name.
export function mergeHandlers(ours, theirs) {
  const out = { ...ours };
  for (const k in theirs) {
    if (typeof theirs[k] === 'function' && ours[k])
      out[k] = (e) => {
        ours[k](e);
        theirs[k](e);
      };
  }
  return out;
}

export function shadows(...list) {
  const v = list.filter(Boolean).join(', ');
  return v || 'none';
}

// Keyboard-focus only (not mouse focus), for controls that draw their own focus ring.
export function useFocusVisible() {
  const [focus, setFocus] = React.useState(false);
  const handlers = {
    onFocus: (e) => {
      let fv = true;
      try {
        fv = e.target.matches(':focus-visible');
      } catch (_) {}
      setFocus(fv);
    },
    onBlur: () => setFocus(false),
  };
  return [focus, handlers];
}

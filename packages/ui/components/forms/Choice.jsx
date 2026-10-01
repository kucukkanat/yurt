import React from 'react';
import { useFocusVisible } from '../core/useInteraction.js';

// Internal pieces shared by Checkbox, Radio and Switch (not exported from the package).

// The native input stays in the tree for keyboard, forms and screen readers; the drawn box sits under it.
export const HIDDEN_INPUT = { position: 'absolute', inset: 0, margin: 0, opacity: 0, cursor: 'inherit' };

/** The label and description next to a control. With `idBase`, they get ids a control can reference (`-label`, `-desc`). */
export function ChoiceText({ label, description, lineHeight = '22px', idBase }) {
  return (
    <>
      {label && (
        <span id={idBase && idBase + '-label'} style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-strong)', lineHeight }}>
          {label}
        </span>
      )}
      {description && (
        <span id={idBase && idBase + '-desc'} style={{ fontSize: 13, color: 'var(--text-subtle)', lineHeight: 1.4 }}>
          {description}
        </span>
      )}
    </>
  );
}

/** A clickable label wrapping a 20px control (`children`: the hidden input and its drawn box) and its text. */
export function ChoiceLabel({ disabled, style, label, description, children }) {
  return (
    // Wrapping the input labels it; a `for` pointing at the same input would be redundant.
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is `children` (each caller passes its native input), which the rule can't see
    <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}>
      <span style={{ position: 'relative', width: 20, height: 20, marginTop: 1, flexShrink: 0 }}>{children}</span>
      {(label || description) && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <ChoiceText label={label} description={description} />
        </span>
      )}
    </label>
  );
}

/** Id, value (controlled when `checked` is given) and keyboard focus for a two-state control. */
export function useChoice({ id, checked, defaultChecked }) {
  const auto = React.useId();
  const [inner, setInner] = React.useState(!!defaultChecked);
  const [focus, focusHandlers] = useFocusVisible();
  return { fid: id || auto, on: checked !== undefined ? checked : inner, setInner, focus, focusHandlers };
}

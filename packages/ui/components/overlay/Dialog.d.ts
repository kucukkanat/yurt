/** Modal dialog. Focus moves in (first focusable or [data-autofocus]), is trapped, and returns on close. Esc and backdrop dismiss. Rises on a spring. */
export interface DialogProps {
  open: boolean;
  onClose?: (() => void) | undefined;
  title?: React.ReactNode | undefined;
  /** Accessible name when there's no visible title (every dialog needs one) */
  label?: string | undefined;
  description?: React.ReactNode | undefined;
  children?: React.ReactNode | undefined;
  /** Right-aligned action row */
  footer?: React.ReactNode | undefined;
  width?: number | undefined;
  /** Position absolute inside the nearest positioned parent (for previews/cards) */
  inline?: boolean | undefined;
  /** false = no close button, Esc or backdrop dismissal */
  dismissible?: boolean | undefined;
}
export declare function Dialog(props: DialogProps): JSX.Element | null;

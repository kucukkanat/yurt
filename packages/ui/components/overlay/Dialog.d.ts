/** Modal dialog. Focus moves in (first focusable or [data-autofocus]), is trapped, and returns on close. Esc and backdrop dismiss. Rises on a spring. */
export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Right-aligned action row */
  footer?: React.ReactNode;
  width?: number;
  /** Position absolute inside the nearest positioned parent (for previews/cards) */
  inline?: boolean;
  /** false = no close button, Esc or backdrop dismissal */
  dismissible?: boolean;
}
export declare function Dialog(props: DialogProps): JSX.Element | null;

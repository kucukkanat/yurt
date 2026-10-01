/** Hover/focus label with optional shortcut. Opens instantly on keyboard focus, after `delay` on hover; Esc hides. */
export interface TooltipProps {
  content: React.ReactNode;
  /** Shortcut shown after the label, e.g. "mod+enter" */
  kbd?: string | undefined;
  placement?: 'top' | 'bottom' | undefined;
  delay?: number | undefined;
  /** For specimens/docs */
  forceOpen?: boolean | undefined;
  children: React.ReactElement;
}
export declare function Tooltip(props: TooltipProps): JSX.Element;

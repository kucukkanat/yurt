/** Hover/focus label with optional shortcut. Opens instantly on keyboard focus, after `delay` on hover; Esc hides. */
export interface TooltipProps {
  content: React.ReactNode;
  /** Shortcut shown after the label, e.g. "mod+enter" */
  kbd?: string;
  placement?: 'top' | 'bottom';
  delay?: number;
  /** For specimens/docs */
  forceOpen?: boolean;
  children: React.ReactElement;
}
export declare function Tooltip(props: TooltipProps): JSX.Element;

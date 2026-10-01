import type { IconName } from '../core/Icon';

/** Transient confirmation, bottom-center. Dark chip on any theme. Countdown bar pauses on hover/focus; action slot is usually Undo. */
export interface ToastProps {
  tone?: 'neutral' | 'success' | 'agent' | 'human' | 'danger' | undefined;
  title: React.ReactNode;
  description?: React.ReactNode | undefined;
  /** "Undo" gets an undo icon automatically */
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  /** ms; 0 = sticky. Calls onClose when the bar runs out. */
  duration?: number | undefined;
  icon?: IconName | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function Toast(props: ToastProps): JSX.Element;

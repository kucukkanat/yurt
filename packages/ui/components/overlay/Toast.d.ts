import type { IconName } from '../core/Icon';

/** Transient confirmation, bottom-center. Dark chip on any theme. Countdown bar pauses on hover/focus; action slot is usually Undo. */
export interface ToastProps {
  tone?: 'neutral' | 'success' | 'agent' | 'human' | 'danger';
  title: React.ReactNode;
  description?: React.ReactNode;
  /** "Undo" gets an undo icon automatically */
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
  /** ms; 0 = sticky. Calls onClose when the bar runs out. */
  duration?: number;
  icon?: IconName;
  style?: React.CSSProperties;
}
export declare function Toast(props: ToastProps): JSX.Element;

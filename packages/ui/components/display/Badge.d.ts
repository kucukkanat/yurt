import type { IconName } from '../core/Icon';

/** Compact status label. Tone carries meaning: agent = AI is doing it, human = needs a person. */
export interface BadgeProps {
  tone?: 'neutral' | 'accent' | 'agent' | 'human' | 'success' | 'warning' | 'danger';
  variant?: 'soft' | 'solid' | 'outline';
  /** Static leading dot */
  dot?: boolean;
  /** Pulsing dot — only for things happening right now */
  live?: boolean;
  icon?: IconName;
  size?: 'sm' | 'md';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Badge(props: BadgeProps): JSX.Element;

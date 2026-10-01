import type { IconName } from '../core/Icon';

/** Compact status label. Tone carries meaning: agent = AI is doing it, human = needs a person. */
export interface BadgeProps {
  tone?: 'neutral' | 'accent' | 'agent' | 'human' | 'success' | 'warning' | 'danger' | undefined;
  variant?: 'soft' | 'solid' | 'outline' | undefined;
  /** Static leading dot */
  dot?: boolean | undefined;
  /** Pulsing dot — only for things happening right now */
  live?: boolean | undefined;
  icon?: IconName | undefined;
  size?: 'sm' | 'md' | undefined;
  children?: React.ReactNode | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function Badge(props: BadgeProps): JSX.Element;

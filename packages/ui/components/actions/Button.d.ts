import * as React from 'react';
import type { IconName } from '../core/Icon';

/**
 * Pressable action. Springs up 1px on hover, sinks on press, keeps its width while loading.
 * @startingPoint section="Actions" subtitle="Primary, agent, secondary, ghost buttons with shortcut hints" viewport="700x300"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = user intent (cobalt). agent = hand work to the AI (volt). */
  variant?: 'primary' | 'agent' | 'secondary' | 'ghost' | 'inverse' | 'danger' | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  iconLeft?: IconName | undefined;
  /** Nudges right on hover. Use for forward motion ("Continue →"). */
  iconRight?: IconName | undefined;
  /** Replaces the left icon with a spinner; sets aria-busy. */
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Shortcut hint rendered inside the button, e.g. "mod+enter". */
  kbd?: string | undefined;
  fullWidth?: boolean | undefined;
  children?: React.ReactNode | undefined;
  /** Forwarded to the element, e.g. `data-testid`. */
  [attr: `data-${string}`]: string | undefined;
}
export declare function Button(props: ButtonProps): JSX.Element;

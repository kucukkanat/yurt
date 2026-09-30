import * as React from 'react';
import type { IconName } from '../core/Icon';

/**
 * Pressable action. Springs up 1px on hover, sinks on press, keeps its width while loading.
 * @startingPoint section="Actions" subtitle="Primary, agent, secondary, ghost buttons with shortcut hints" viewport="700x300"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = user intent (cobalt). agent = hand work to the AI (volt). */
  variant?: 'primary' | 'agent' | 'secondary' | 'ghost' | 'inverse' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  iconLeft?: IconName;
  /** Nudges right on hover. Use for forward motion ("Continue →"). */
  iconRight?: IconName;
  /** Replaces the left icon with a spinner; sets aria-busy. */
  loading?: boolean;
  disabled?: boolean;
  /** Shortcut hint rendered inside the button, e.g. "mod+enter". */
  kbd?: string;
  fullWidth?: boolean;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;

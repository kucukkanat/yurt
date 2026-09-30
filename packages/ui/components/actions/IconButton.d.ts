import * as React from 'react';
import type { IconName } from '../core/Icon';

/** Square icon-only action. `label` is required — it becomes aria-label and the native tooltip. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: 'primary' | 'agent' | 'secondary' | 'ghost' | 'inverse' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Toggled-on state (sets aria-pressed). */
  active?: boolean;
  round?: boolean;
  disabled?: boolean;
  /** Forwarded to the element, e.g. `data-testid`. */
  [attr: `data-${string}`]: string | undefined;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;

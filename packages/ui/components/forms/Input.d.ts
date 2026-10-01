import * as React from 'react';
import type { IconName } from '../core/Icon';

/** Text field with label, hint and inline error. Focus = cobalt border + 3px soft halo; error slides in with an icon. */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string | undefined;
  hint?: string | undefined;
  /** Replaces hint, sets aria-invalid, announced via role=alert */
  error?: string | undefined;
  optional?: boolean | undefined;
  iconLeft?: IconName | undefined;
  /** Trailing slot — a Kbd, unit, or IconButton */
  suffix?: React.ReactNode | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
}
export declare function Input(props: InputProps): JSX.Element;

export interface FieldShellProps { id: string; label?: string; hint?: string; error?: string; optional?: boolean; children: React.ReactNode }
export declare function FieldShell(props: FieldShellProps): JSX.Element;

import * as React from 'react';

/** Native checkbox under a custom box; the check stroke draws itself in 240ms. */
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  indeterminate?: boolean;
}
export declare function Checkbox(props: CheckboxProps): JSX.Element;

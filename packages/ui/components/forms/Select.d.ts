import * as React from 'react';

/** Native select, restyled. Keeps OS pickers + full keyboard/screen-reader support; chevron flips on focus. */
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  options: Array<string | { value: string; label: string }>;
  placeholder?: string | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
}
export declare function Select(props: SelectProps): JSX.Element;

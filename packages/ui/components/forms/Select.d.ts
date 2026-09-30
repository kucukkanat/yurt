import * as React from 'react';

/** Native select, restyled. Keeps OS pickers + full keyboard/screen-reader support; chevron flips on focus. */
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  options: Array<string | { value: string; label: string }>;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
}
export declare function Select(props: SelectProps): JSX.Element;

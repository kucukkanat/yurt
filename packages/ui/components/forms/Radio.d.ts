import * as React from 'react';

/** Native radio (arrow keys move within a `name` group) with a spring-snapping dot. */
export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode | undefined;
  description?: React.ReactNode | undefined;
  name: string;
  value: string;
}
export declare function Radio(props: RadioProps): JSX.Element;

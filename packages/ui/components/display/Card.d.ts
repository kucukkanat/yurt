/** Surface container. 20px radius, 1px hairline, soft warm shadow. Interactive cards lift 2px on hover. */
export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  variant?: 'default' | 'outline' | 'sunken' | 'inverse' | 'agent';
  padding?: 'none' | 'sm' | 'md' | 'lg' | number;
  /** Renders a <button> with hover lift + focus ring */
  interactive?: boolean;
  as?: keyof JSX.IntrinsicElements;
  children?: React.ReactNode;
}
export declare function Card(props: CardProps): JSX.Element;

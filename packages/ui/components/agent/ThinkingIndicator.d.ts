/** The agent's "I'm working" signal: volt dots bouncing in an ink capsule + shimmering label. Announced politely to screen readers. */
export interface ThinkingIndicatorProps {
  /** Say what it's doing, not just "Thinking": "Reading 4 files" */
  label?: string;
  /** Secondary, e.g. elapsed time "12s" */
  detail?: string;
  variant?: 'dots' | 'orb';
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
}
export declare function ThinkingIndicator(props: ThinkingIndicatorProps): JSX.Element;

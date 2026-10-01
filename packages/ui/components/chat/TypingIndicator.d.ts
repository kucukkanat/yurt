/** "Priya is typing" / "Scout is writing" above the composer. Volt dots when an agent is among them. Reserves its height when empty so the composer never jumps. */
export interface TypingIndicatorProps {
  people?: Array<{ name: string; kind: 'human' | 'agent' }> | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function TypingIndicator(props: TypingIndicatorProps): JSX.Element;

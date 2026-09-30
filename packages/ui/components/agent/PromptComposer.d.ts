/**
 * The agent input. Auto-growing textarea, context chips, suggestion starters, send/stop.
 * Enter sends, Shift+Enter new line, Esc stops a running agent. Border glows volt while the agent works.
 * @startingPoint section="Agent" subtitle="Prompt composer with context chips, suggestions and stop" viewport="700x260"
 */
export interface PromptComposerProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** Agent is working: shows Stop, glow, Esc hint */
  running?: boolean;
  onStop?: () => void;
  placeholder?: string;
  /** Tag elements for attached files/links */
  context?: React.ReactNode;
  /** Replaces the default attach/dictate buttons */
  toolbar?: React.ReactNode;
  /** Starter prompts, shown while empty */
  suggestions?: string[];
  onSuggestion?: (s: string) => void;
  autoFocus?: boolean;
  label?: string;
  style?: React.CSSProperties;
}
export declare function PromptComposer(props: PromptComposerProps): JSX.Element;

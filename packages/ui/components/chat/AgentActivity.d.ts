import type { AgentStepProps } from '../agent/AgentStep';
/** Compact summary of what an agent did to produce a message ("Read 3 files · 4.2s"). Expands to the full AgentStep trace. Keeps rooms scannable while staying transparent. */
export interface AgentActivityProps {
  summary?: string;
  /** Mono timing / cost */
  meta?: string;
  steps?: AgentStepProps[];
  defaultOpen?: boolean;
  /** Spinner instead of checklist icon */
  running?: boolean;
  style?: React.CSSProperties;
}
export declare function AgentActivity(props: AgentActivityProps): JSX.Element;

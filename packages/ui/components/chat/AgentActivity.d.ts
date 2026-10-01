import type { AgentStepProps } from '../agent/AgentStep';
/** Compact summary of what an agent did to produce a message ("Read 3 files · 4.2s"). Expands to the full AgentStep trace. Keeps rooms scannable while staying transparent. */
export interface AgentActivityProps {
  summary?: string | undefined;
  /** Mono timing / cost */
  meta?: string | undefined;
  steps?: AgentStepProps[] | undefined;
  defaultOpen?: boolean | undefined;
  /** Spinner instead of checklist icon */
  running?: boolean | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function AgentActivity(props: AgentActivityProps): JSX.Element;

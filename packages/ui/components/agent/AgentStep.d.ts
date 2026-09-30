/**
 * One row of the agent's visible trace. Stack them to show the plan: node on a rail, title, tool, timing, expandable evidence.
 * Rail turns ink as steps complete, so progress reads at a glance.
 * @startingPoint section="Agent" subtitle="Live agent trace — plan, running, needs-you, done" viewport="700x420"
 */
export interface AgentStepProps {
  status?: 'queued' | 'running' | 'done' | 'waiting' | 'error' | 'skipped';
  title: React.ReactNode;
  /** One line: result, reason, or what's needed from the user */
  detail?: React.ReactNode;
  /** Tool id in mono, e.g. "web.search" */
  tool?: string;
  /** Timing/cost in mono, e.g. "1.4s" */
  meta?: string;
  /** Expandable evidence: sources, diff, logs */
  children?: React.ReactNode;
  defaultOpen?: boolean;
  /** Hides the rail below the node */
  last?: boolean;
  style?: React.CSSProperties;
}
export declare function AgentStep(props: AgentStepProps): JSX.Element;

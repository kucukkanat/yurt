/**
 * One row of the agent's visible trace. Stack them to show the plan: node on a rail, title, tool, timing, expandable evidence.
 * Rail turns ink as steps complete, so progress reads at a glance.
 * @startingPoint section="Agent" subtitle="Live agent trace — plan, running, needs-you, done" viewport="700x420"
 */
export interface AgentStepProps {
  status?: 'queued' | 'running' | 'done' | 'waiting' | 'error' | 'skipped' | undefined;
  title: React.ReactNode;
  /** One line: result, reason, or what's needed from the user */
  detail?: React.ReactNode | undefined;
  /** Tool id in mono, e.g. "web.search" */
  tool?: string | undefined;
  /** Timing/cost in mono, e.g. "1.4s" */
  meta?: string | undefined;
  /** Expandable evidence: sources, diff, logs */
  children?: React.ReactNode | undefined;
  defaultOpen?: boolean | undefined;
  /** Hides the rail below the node */
  last?: boolean | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function AgentStep(props: AgentStepProps): JSX.Element;

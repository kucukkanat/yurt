export interface ApprovalChange { label: string; before?: string; after: string }

/**
 * Human-in-the-loop checkpoint. The agent stops and shows exactly what will change before acting.
 * Coral border + halo, risk badge, before→after diff, ⌘↵ approve / Esc decline. Collapses to a result row with Undo.
 * @startingPoint section="Agent" subtitle="Approve an agent action with a before/after diff" viewport="700x380"
 */
export interface ApprovalCardProps {
  /** Phrase as the action: "Send invoice to Acme" */
  title: React.ReactNode;
  description?: React.ReactNode | undefined;
  risk?: 'low' | 'medium' | 'high' | undefined;
  changes?: ApprovalChange[] | undefined;
  status?: 'pending' | 'approved' | 'rejected' | undefined;
  onApprove?: (() => void) | undefined;
  onReject?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onUndo?: (() => void) | undefined;
  approveLabel?: string | undefined;
  /** ⌘↵ / Esc while focus is inside the card */
  shortcuts?: boolean | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function ApprovalCard(props: ApprovalCardProps): JSX.Element;

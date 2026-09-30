export interface ApprovalChange { label: string; before?: string; after: string }

/**
 * Human-in-the-loop checkpoint. The agent stops and shows exactly what will change before acting.
 * Coral border + halo, risk badge, before→after diff, ⌘↵ approve / Esc decline. Collapses to a result row with Undo.
 * @startingPoint section="Agent" subtitle="Approve an agent action with a before/after diff" viewport="700x380"
 */
export interface ApprovalCardProps {
  /** Phrase as the action: "Send invoice to Acme" */
  title: React.ReactNode;
  description?: React.ReactNode;
  risk?: 'low' | 'medium' | 'high';
  changes?: ApprovalChange[];
  status?: 'pending' | 'approved' | 'rejected';
  onApprove?: () => void;
  onReject?: () => void;
  onEdit?: () => void;
  onUndo?: () => void;
  approveLabel?: string;
  /** ⌘↵ / Esc while focus is inside the card */
  shortcuts?: boolean;
  style?: React.CSSProperties;
}
export declare function ApprovalCard(props: ApprovalCardProps): JSX.Element;

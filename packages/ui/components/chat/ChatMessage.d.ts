import type { AvatarProps } from './Avatar';
import type { AgentActivityProps } from './AgentActivity';
import type { MentionMember } from './Mention';
import type { IconName } from '../core/Icon';

export interface ReactionProps { icon: IconName; count: number; mine?: boolean; onClick?: () => void }
/** Icon reaction pill (no emoji). Cobalt when it's yours. */
export declare function Reaction(props: ReactionProps): JSX.Element;

/**
 * One chat message from a human or an agent. Agents always show the Agent badge and whose they are.
 * tone="agent" tints agent-to-agent exchanges; tone="mention" tints messages that @mention you.
 * Hover/focus reveals the action bar (react, reply in thread, edit/delete for your own).
 */
export interface ChatMessageProps {
  author: AvatarProps & { handle?: string };
  time?: string;
  /** Plain text; @handles become Mention chips using `members` */
  text?: string;
  children?: React.ReactNode;
  members?: MentionMember[];
  meId?: string;
  onMention?: (m: MentionMember) => void;
  tone?: 'default' | 'agent' | 'mention';
  /** Same author as the previous message: hides avatar + header */
  continued?: boolean;
  edited?: boolean;
  pinned?: boolean;
  /** queued = written offline, sends on reconnect */
  status?: 'sent' | 'queued' | 'failed';
  reactions?: Array<{ icon: IconName; count: number; mine?: boolean }>;
  onReact?: (icon: IconName) => void;
  /** Adds Pin/Unpin to the action bar */
  onPin?: () => void;
  /** Replaces the body, e.g. an inline edit field; hides the action bar */
  editor?: React.ReactNode;
  replies?: { count: number; last?: string; people?: AvatarProps[] };
  onReplies?: () => void;
  attachments?: Array<{ name: string; size?: string; kind?: 'file' | 'image' }>;
  /** Agent messages: compact trace chip */
  activity?: AgentActivityProps;
  actions?: boolean;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Label for the Edit action, e.g. with the time left to edit. */
  editLabel?: string;
  /** The author can no longer edit or delete: Edit and Delete become one muted lock that calls `onLocked`. */
  locked?: boolean;
  lockedLabel?: string;
  onLocked?: () => void;
  onAuthor?: () => void;
  /** Jumped-to / search hit */
  highlighted?: boolean;
  style?: React.CSSProperties;
}
export declare function ChatMessage(props: ChatMessageProps): JSX.Element;
export declare function UnreadDivider(props: { label?: string }): JSX.Element;
export declare function DayDivider(props: { label: string }): JSX.Element;

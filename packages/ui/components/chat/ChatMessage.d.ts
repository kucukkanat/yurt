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
  author: AvatarProps & { handle?: string | undefined };
  time?: string | undefined;
  /** Plain text; @handles become Mention chips using `members` */
  text?: string | undefined;
  children?: React.ReactNode | undefined;
  members?: MentionMember[] | undefined;
  meId?: string | undefined;
  onMention?: ((m: MentionMember) => void) | undefined;
  tone?: 'default' | 'agent' | 'mention' | undefined;
  /** Same author as the previous message: hides avatar + header */
  continued?: boolean | undefined;
  edited?: boolean | undefined;
  pinned?: boolean | undefined;
  /** queued = written offline, sends on reconnect */
  status?: 'sent' | 'queued' | 'failed' | undefined;
  reactions?: Array<{ icon: IconName; count: number; mine?: boolean | undefined }> | undefined;
  onReact?: ((icon: IconName) => void) | undefined;
  /** Adds Pin/Unpin to the action bar */
  onPin?: (() => void) | undefined;
  /** More actions for the action bar (after Pin), e.g. save or make a task; each gets data-testid `msg-<id>` */
  more?: Array<{ id: string; icon: IconName; label: string; onSelect: () => void }> | undefined;
  /** Replaces the body, e.g. an inline edit field; hides the action bar */
  editor?: React.ReactNode | undefined;
  replies?: { count: number; last?: string | undefined; people?: AvatarProps[] | undefined } | undefined;
  onReplies?: (() => void) | undefined;
  attachments?: Array<{ name: string; size?: string | undefined; kind?: 'file' | 'image' | undefined }> | undefined;
  /** Agent messages: compact trace chip */
  activity?: AgentActivityProps | undefined;
  actions?: boolean | undefined;
  onReply?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  /** Label for the Edit action, e.g. with the time left to edit. */
  editLabel?: string | undefined;
  /** The author can no longer edit or delete: Edit and Delete become one muted lock that calls `onLocked`. */
  locked?: boolean | undefined;
  lockedLabel?: string | undefined;
  onLocked?: (() => void) | undefined;
  onAuthor?: (() => void) | undefined;
  /** Jumped-to / search hit */
  highlighted?: boolean | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function ChatMessage(props: ChatMessageProps): JSX.Element;
export declare function UnreadDivider(props: { label?: string }): JSX.Element;
export declare function DayDivider(props: { label: string }): JSX.Element;
/** The quick reactions offered on a message. */
export declare const REACTIONS: readonly IconName[];

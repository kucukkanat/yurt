/** Inline @handle. Coral when it's you (needs you), volt tint for agents, neutral for other humans, cobalt for @room / @here. */
export interface MentionProps {
  handle: string;
  kind?: 'human' | 'agent' | 'room';
  self?: boolean;
  /** Makes it a button — open the profile card */
  onClick?: () => void;
  style?: React.CSSProperties;
}
export declare function Mention(props: MentionProps): JSX.Element;

export interface MentionMember { id: string; handle: string; kind: 'human' | 'agent' }
/** Renders a text string, turning known @handles into Mention chips. */
export interface MentionTextProps {
  text: string;
  members: MentionMember[];
  meId?: string;
  onMention?: (m: MentionMember) => void;
}
export declare function MentionText(props: MentionTextProps): JSX.Element;

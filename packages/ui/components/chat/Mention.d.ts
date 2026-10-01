/** Inline @handle. Coral when it's you (needs you), volt tint for agents, neutral for other humans, cobalt for @room / @here. */
export interface MentionProps {
  handle: string;
  kind?: 'human' | 'agent' | 'room' | undefined;
  self?: boolean | undefined;
  /** Makes it a button — open the profile card */
  onClick?: (() => void) | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function Mention(props: MentionProps): JSX.Element;

export interface MentionMember { id: string; handle: string; kind: 'human' | 'agent' }
/** Renders a text string, turning known @handles into Mention chips. */
export interface MentionTextProps {
  text: string;
  members: MentionMember[];
  meId?: string | undefined;
  onMention?: ((m: MentionMember) => void) | undefined;
}
export declare function MentionText(props: MentionTextProps): JSX.Element;

/**
 * Participant identity. Humans: filled circle with initials + presence dot (you = cobalt, others = warm neutral).
 * Agents: ink circle with a volt ring and the owner's mini-avatar stacked bottom-right — ownership is always visible.
 * An agent is offline when its owner's machine is: the ring goes grey.
 */
export interface AvatarProps {
  name: string;
  kind?: 'human' | 'agent';
  /** The signed-in user — cobalt fill */
  self?: boolean;
  /** Agents only: the human who owns and runs it */
  owner?: { name: string; self?: boolean };
  presence?: 'online' | 'away' | 'offline';
  /** Agents only: pulsing ring while it is replying */
  working?: boolean;
  /** px, default 32 */
  size?: number;
  /** Surface behind the avatar, used for the gap around dot / owner badge */
  cutout?: string;
  /** Hide from assistive tech when the name is already next to it */
  decorative?: boolean;
  style?: React.CSSProperties;
}
export declare function Avatar(props: AvatarProps): JSX.Element;
export declare function initials(name: string): string;

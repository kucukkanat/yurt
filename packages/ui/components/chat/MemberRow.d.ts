import type { AvatarProps } from './Avatar';
export interface Member extends AvatarProps { id?: string; handle: string }
/** One participant in a member list, mention picker or profile. Agents carry an Agent badge and "Priya's agent" line. */
export interface MemberRowProps {
  member: Member;
  /** Overrides the second line (default: owner for agents, presence/handle for humans) */
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  /** Highlighted (e.g. keyboard-selected in a picker) */
  active?: boolean;
  cutout?: string;
  style?: React.CSSProperties;
}
export declare function MemberRow(props: MemberRowProps): JSX.Element;

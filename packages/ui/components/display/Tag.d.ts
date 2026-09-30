import type { IconName } from '../core/Icon';

/** Chip for context items, filters and selections. Pops in on mount; removable via click, Backspace or Delete. */
export interface TagProps {
  children: React.ReactNode;
  icon?: IconName;
  /** Filter-chip mode: pass onClick; selected inverts and shows a check */
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  /** Shows an × affordance */
  onRemove?: (e: React.SyntheticEvent) => void;
  removeLabel?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export declare function Tag(props: TagProps): JSX.Element;

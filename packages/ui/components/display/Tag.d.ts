import type { IconName } from '../core/Icon';

/** Chip for context items, filters and selections. Pops in on mount; removable via click, Backspace or Delete. */
export interface TagProps {
  children: React.ReactNode;
  icon?: IconName | undefined;
  /** Filter-chip mode: pass onClick; selected inverts and shows a check */
  selected?: boolean | undefined;
  onClick?: ((e: React.MouseEvent) => void) | undefined;
  /** Shows an × affordance */
  onRemove?: ((e: React.SyntheticEvent) => void) | undefined;
  removeLabel?: string | undefined;
  disabled?: boolean | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function Tag(props: TagProps): JSX.Element;

import type { IconName } from '../core/Icon';

export interface TabItem { id: string; label: React.ReactNode; icon?: IconName; count?: number; disabled?: boolean }

/**
 * Segmented tabs with a spring-sliding indicator. Roving tabindex; ←/→/Home/End move and select.
 * Overflow: when tabs exceed the container they scroll horizontally (no scrollbar), edges fade,
 * chevron buttons appear for pointer users, and the active tab auto-scrolls into view with a peek of its neighbour.
 */
export interface TabsProps {
  items: TabItem[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onChange?: ((id: string) => void) | undefined;
  /** pill = segmented control on sunken track; underline = page-level section tabs */
  variant?: 'pill' | 'underline' | undefined;
  size?: 'sm' | 'md' | undefined;
  /** Stretch tabs to fill the container (still scrolls if they can't fit) */
  fullWidth?: boolean | undefined;
  /** aria-label for the tablist */
  label?: string | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function Tabs(props: TabsProps): JSX.Element;

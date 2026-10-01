import type { IconName } from '../core/Icon';

export interface SheetAction {
  id: string;
  label: string;
  icon: IconName;
  tone?: 'danger' | undefined;
  onSelect(): void;
}
/** Bottom sheet of actions for touch (a long-pressed message, say). Every action closes it; Cancel is added last. */
export interface ActionSheetProps {
  open: boolean;
  onClose(): void;
  /** Accessible name of the sheet */
  label: string;
  /** Shown above the actions, e.g. quick reactions */
  header?: React.ReactNode | undefined;
  actions: SheetAction[];
}
export declare function ActionSheet(props: ActionSheetProps): JSX.Element | null;

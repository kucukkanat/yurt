/** Instant on/off (role=switch). Thumb stretches while pressed and springs across; shows ✓/× so state never relies on color alone. */
export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** agent = volt track, for AI autonomy toggles */
  tone?: 'accent' | 'agent';
  size?: 'sm' | 'md';
  disabled?: boolean;
  id?: string;
  style?: React.CSSProperties;
}
export declare function Switch(props: SwitchProps): JSX.Element;

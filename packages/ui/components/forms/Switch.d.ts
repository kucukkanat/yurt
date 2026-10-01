/** Instant on/off (role=switch). Thumb stretches while pressed and springs across; shows ✓/× so state never relies on color alone. */
export interface SwitchProps {
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  onChange?: ((checked: boolean) => void) | undefined;
  label?: React.ReactNode | undefined;
  description?: React.ReactNode | undefined;
  /** agent = volt track, for AI autonomy toggles */
  tone?: 'accent' | 'agent' | undefined;
  size?: 'sm' | 'md' | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  style?: React.CSSProperties | undefined;
  /** Forwarded to the switch button, e.g. `data-testid`. */
  [attr: `data-${string}`]: string | undefined;
}
export declare function Switch(props: SwitchProps): JSX.Element;

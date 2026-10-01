/** Keycap hint. Keyboard-first means every primary action shows its shortcut. */
export interface KbdProps {
  /** "mod+enter", "esc", or ['⌘','K']. Aliases: mod/cmd, shift, alt, enter, esc, tab, up/down/left/right. */
  keys: string | string[];
  /** Match the surface it sits on. */
  tone?: 'default' | 'onAccent' | 'onAgent' | 'inverse' | undefined;
  size?: 'sm' | 'md' | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function Kbd(props: KbdProps): JSX.Element;

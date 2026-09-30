import * as React from 'react';

export type IconName =
  | 'arrow-right' | 'arrow-up' | 'arrow-left' | 'check' | 'x' | 'plus' | 'minus' | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'chevron-up'
  | 'search' | 'sparkles' | 'sparkle' | 'bot' | 'user' | 'settings' | 'command' | 'corner-down-left' | 'pause' | 'play' | 'square'
  | 'rotate-ccw' | 'undo-2' | 'circle-alert' | 'triangle-alert' | 'circle-check' | 'info' | 'lock' | 'eye' | 'eye-off' | 'file-text'
  | 'globe' | 'link' | 'paperclip' | 'mic' | 'copy' | 'thumbs-up' | 'thumbs-down' | 'git-branch' | 'history' | 'zap' | 'shield-check'
  | 'layers' | 'inbox' | 'calendar' | 'mail' | 'folder' | 'terminal' | 'pencil' | 'trash-2' | 'external-link' | 'loader'
  | 'wand-sparkles' | 'list-checks' | 'hand' | 'keyboard' | 'bell' | 'sun' | 'moon' | 'panel-left' | 'ellipsis' | 'flag' | 'gauge'
  | 'database' | 'coins'
  | 'hash' | 'at-sign' | 'message-square' | 'messages-square' | 'smile-plus' | 'pin' | 'users' | 'user-plus' | 'wifi-off' | 'refresh-cw' | 'cpu' | 'laptop' | 'key-round' | 'reply' | 'image' | 'plug' | 'arrow-down' | 'wrench' | 'heart' | 'clock' | 'log-in'
  | 'mic-off' | 'video' | 'video-off' | 'monitor-up' | 'headphones' | 'phone-off' | 'download' | 'log-out' | 'ban' | 'crown' | 'menu' | 'qr-code';

/** Lucide stroke icon (copied set, 24px grid, 2px stroke). Decorative unless `label` is set. */
export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  name: IconName;
  /** px, default 20 */
  size?: number;
  /** default 2 — use 1.75 at 24px+, 2.25 at 14px */
  strokeWidth?: number;
  /** Accessible name. Omit for decorative icons next to text. */
  label?: string;
  color?: string;
}
export declare function Icon(props: IconProps): JSX.Element;

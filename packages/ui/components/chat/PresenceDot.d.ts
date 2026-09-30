/** Presence for humans: green online, amber away, hollow ring offline (shape differs, not just color). Agents show presence through their Avatar ring instead. */
export interface PresenceDotProps {
  status?: 'online' | 'away' | 'offline';
  /** px, default 10 */
  size?: number;
  /** Color of the gap ring — match the surface behind it. '' for none. */
  cutout?: string;
  style?: React.CSSProperties;
}
export declare function PresenceDot(props: PresenceDotProps): JSX.Element;
export declare const PRESENCE: Record<'online' | 'away' | 'offline', { color: string; label: string }>;

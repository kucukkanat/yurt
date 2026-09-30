/** Thin bar under the room header when sync is interrupted. The room stays usable; messages queue locally. Renders nothing when online. */
export interface ConnectionBannerProps {
  state?: 'online' | 'reconnecting' | 'offline';
  /** Messages waiting to send */
  queued?: number;
  /** Peers being reconnected to */
  peers?: number;
  onRetry?: () => void;
  style?: React.CSSProperties;
}
export declare function ConnectionBanner(props: ConnectionBannerProps): JSX.Element | null;

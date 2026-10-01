/** Thin bar under the room header when sync is interrupted. The room stays usable; messages queue locally. Renders nothing when online. */
export interface ConnectionBannerProps {
  state?: 'online' | 'reconnecting' | 'offline' | undefined;
  /** Messages waiting to send */
  queued?: number | undefined;
  /** Peers being reconnected to */
  peers?: number | undefined;
  onRetry?: (() => void) | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function ConnectionBanner(props: ConnectionBannerProps): JSX.Element | null;

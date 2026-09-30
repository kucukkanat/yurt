/** Sidebar-footer pill for the local agent daemon (the HTTP bridge between the web app and ACP agent CLIs on this machine). Chat works without it; agents don't. */
export interface DaemonStatusProps {
  status?: 'connected' | 'connecting' | 'missing';
  version?: string;
  port?: number | string;
  /** e.g. "2 running" */
  agents?: string;
  /** Open daemon settings or the setup wizard */
  onClick?: () => void;
  style?: React.CSSProperties;
}
export declare function DaemonStatus(props: DaemonStatusProps): JSX.Element;

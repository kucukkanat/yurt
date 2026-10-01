/** Sidebar-footer pill for the local agent daemon (the HTTP bridge between the web app and ACP agent CLIs on this machine). Chat works without it; agents don't. */
export interface DaemonStatusProps {
  status?: 'connected' | 'connecting' | 'missing' | undefined;
  version?: string | undefined;
  port?: number | string | undefined;
  /** e.g. "2 running" */
  agents?: string | undefined;
  /** Open daemon settings or the setup wizard */
  onClick?: (() => void) | undefined;
  style?: React.CSSProperties | undefined;
}
export declare function DaemonStatus(props: DaemonStatusProps): JSX.Element;

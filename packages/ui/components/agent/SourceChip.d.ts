/** Inline numbered citation. Every factual claim the agent makes links to where it came from. */
export interface SourceChipProps {
  index: number;
  /** Full page title (native tooltip + aria) */
  title?: string;
  domain: string;
  href?: string;
  /** Green dot: agent opened and read the page, not just the snippet */
  verified?: boolean;
  style?: React.CSSProperties;
}
export declare function SourceChip(props: SourceChipProps): JSX.Element;

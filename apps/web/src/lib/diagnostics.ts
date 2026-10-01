/**
 * Recent connection problems, newest last: refused WebRTC handshakes (a banned member, someone on an old key) and
 * peer errors. They go to the console too; keeping the last few here makes them inspectable without devtools.
 */
export interface Diagnostic {
  at: number;
  code: string;
  kind: 'join' | 'error';
  detail: string;
}

const MAX = 50;
const recent: Diagnostic[] = [];

export function report(code: string, kind: Diagnostic['kind'], detail: unknown) {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  recent.push({ at: Date.now(), code, kind, detail: text });
  if (recent.length > MAX) recent.shift();
  (kind === 'error' ? console.error : console.warn)('[yurt]', code, text);
}

/** The recorded problems, oldest first. */
export const recentDiagnostics = (): readonly Diagnostic[] => [...recent];

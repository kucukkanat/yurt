/**
 * A value the caller's position guarantees, e.g. a view that only mounts inside a workspace route. Missing means a
 * bug in how it's mounted, so it fails loudly instead of rendering something half-empty.
 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(what);
  return value;
}

/** What to show for a caught error: its message, or the thrown value as text (code can throw anything). */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

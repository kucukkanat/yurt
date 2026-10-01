// Shared inside this package (not exported from index). Untrusted input is checked by schemas.ts.

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

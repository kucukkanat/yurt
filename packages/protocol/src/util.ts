// Small helpers for handling untrusted input, shared inside this package (not exported from index).

export const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

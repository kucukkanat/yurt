/** `T` with every key whose value may be `undefined` turned into an optional key that is absent instead. */
export type Compact<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/**
 * Drops keys whose value is `undefined`. With `exactOptionalPropertyTypes`, an optional field must be absent rather
 * than `undefined`; this keeps call sites readable (`compact({ a, b: maybe })`) instead of a conditional spread per key.
 */
export function compact<T extends object>(o: T): Compact<T> {
  // Object.fromEntries loses the key types; the filter makes the result match Compact<T> exactly.
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Compact<T>;
}

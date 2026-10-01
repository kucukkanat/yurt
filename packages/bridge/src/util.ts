/** The message of anything thrown: an Error's own message, anything else as text. */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The list stored under `key`, or an empty one. */
export const listAt = <K, V>(m: ReadonlyMap<K, readonly V[]>, key: K): readonly V[] => m.get(key) ?? [];

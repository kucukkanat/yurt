import fc from 'fast-check';

// Property tests are reproducible: a fixed seed, so a failure names the exact input and reruns the same way.
fc.configureGlobal({ seed: 0x59757274, numRuns: 300 });

/** Any JSON-ish value, including hostile shapes (deep nesting, prototype keys, odd numbers). */
export const anything = fc.anything({
  withBigInt: false,
  withNullPrototype: true,
  withObjectString: true,
  withSparseArray: true,
  withTypedArray: true,
  withMap: true,
  withSet: true,
  withDate: true,
  maxDepth: 4,
});

export { fc };

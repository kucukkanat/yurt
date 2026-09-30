// Single source for the bridge version: esbuild/tsup inline this JSON import, tsx reads it in dev.
import pkg from '../package.json';

export const VERSION: string = pkg.version;

// The process entry: arguments, the UI folder, exit codes and signals. Everything else is main.ts (unit tested);
// this file is exercised by the smoke test of the built CLI (test/cli.smoke.test.ts).
import './polyfill';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main } from './main';

// Built: dist/cli.js next to dist/ui. From source (tsx src/cli.ts): the UI built into dist/ui.
const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = [path.join(here, 'ui'), path.join(here, '..', 'dist', 'ui')].find((d) => fs.existsSync(path.join(d, 'index.html'))) || path.join(here, 'ui');

const r = await main(process.argv.slice(2), path.resolve(uiDir));
if ('exit' in r) process.exit(r.exit);
const bye = () => {
  for (const p of r.workspaces.peers.values()) p.leave();
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);

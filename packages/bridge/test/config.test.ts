import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers';

// config.ts reads YURT_HOME on import, so it's imported after pointing it at a temp folder.
const home = tempDir('yurt-home-');
let loadConfig: typeof import('../src/config').loadConfig;
beforeAll(async () => {
  process.env.YURT_HOME = home;
  ({ loadConfig } = await import('../src/config'));
});

const write = (c: object) => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(c));

describe('loadConfig', () => {
  it('defaults allowed origins when never set', () => {
    write({});
    expect(loadConfig().allowedOrigins).toContain('http://localhost:5173');
  });

  it('respects an explicitly empty origin list', () => {
    write({ allowedOrigins: [] });
    expect(loadConfig().allowedOrigins).toEqual([]);
  });
});

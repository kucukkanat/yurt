import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { saveEnv, tempDir } from './helpers';

// Without YURT_HOME, the bridge keeps its data in ~/.yurt (HOME points at a temp folder here).
describe('data folder', () => {
  it('defaults to ~/.yurt', async () => {
    const home = tempDir('yurt-userhome-');
    const restoreEnv = saveEnv('HOME', 'YURT_HOME');
    process.env.HOME = home;
    delete process.env.YURT_HOME;
    try {
      const config = await import('../src/config');
      expect(config.HOME).toBe(path.join(home, '.yurt'));
      config.loadConfig();
      expect(fs.existsSync(path.join(home, '.yurt', 'config.json'))).toBe(true);
    } finally {
      restoreEnv();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

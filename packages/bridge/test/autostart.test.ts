import { describe, it, expect } from 'vitest';
import { startCommand } from '../src/autostart';
import { whichPath } from '../src/runtimes';

describe('start on login command', () => {
  it('runs a stable install directly with this Node', () => {
    expect(startCommand('/usr/local/lib/node_modules/yurt-bridge/dist/cli.js', '/usr/bin/node'))
      .toEqual({ exe: '/usr/bin/node', args: ['/usr/local/lib/node_modules/yurt-bridge/dist/cli.js', '--no-open'] });
  });

  it('goes through the runner again for npx and bunx caches, which get wiped', () => {
    const npx = whichPath('npx');
    const bunx = whichPath('bunx');
    for (const script of ['/home/u/.npm/_npx/1a2b/node_modules/yurt-bridge/dist/cli.js', '/private/tmp/bunx-501-yurt-bridge@latest/node_modules/yurt-bridge/dist/cli.js']) {
      if (npx) expect(startCommand(script, '/usr/bin/node')).toEqual({ exe: npx, args: ['-y', 'yurt-bridge', '--no-open'] });
      else if (bunx) expect(startCommand(script, '/usr/bin/node')).toEqual({ exe: bunx, args: ['yurt-bridge', '--no-open'] });
    }
  });

  it('refuses a source checkout, which has no stable entry point', () => {
    expect(() => startCommand('/repo/packages/bridge/src/cli.ts', '/usr/bin/node')).toThrow(/built bridge/);
  });
});

// Static, so Vite's dependency scan sees react-dom/client before main.tsx is imported dynamically; discovering it
// mid-run would re-optimise and reload the page with a second copy of React.
import 'react-dom/client';
import { expect, it } from 'vitest';
import { resetDb } from './harness';

it('fails clearly when the page has no #root to render into', async () => {
  await resetDb();
  await expect(import('../../../src/main')).rejects.toThrow('index.html has no #root element');
});

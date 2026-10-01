// Static, so Vite's dependency scan sees react-dom/client before main.tsx is imported dynamically; discovering it
// mid-run would re-optimise and reload the page with a second copy of React.
import 'react-dom/client';
import { afterAll, beforeAll, it } from 'vitest';
import { newRecoveryPhrase } from '@yurt/protocol';
import { kv } from '../../../src/lib/db';
import { getPeer } from '../../../src/lib/net';
import { useApp } from '../../../src/store';
import { resetDb, until } from './harness';

// The real entry point: starts the store, keeps the tab icon in step, and renders the app into #root.
beforeAll(async () => {
  await resetDb();
  await kv.set('identity', { phrase: newRecoveryPhrase(), name: 'Ada', handle: 'ada' }); // a returning user
  for (const l of document.querySelectorAll('link[rel~="icon"]')) l.remove(); // the test runner page's own icon
  const icon = document.createElement('link');
  icon.rel = 'icon';
  icon.href = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>');
  document.head.append(icon);
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
});

afterAll(() => {
  for (const w of useApp.getState().workspaces) getPeer(w.code)?.leave();
});

it('starts the app, renders it, and updates the tab icon on changes', async () => {
  await import('../../../src/main');
  await until(() => useApp.getState().ready, 'the store');
  await until(() => !!document.getElementById('root')?.textContent, 'the first screen', 8_000);
  useApp.setState({ online: false }); // any store change re-checks the icon
  await new Promise((r) => setTimeout(r, 500));
  await until(() => document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href.startsWith('data:image/png') === true, 'the offline icon');
  useApp.setState({ online: true });
  document.dispatchEvent(new Event('visibilitychange')); // and so does the tab's visibility changing
  await until(() => document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href.startsWith('data:image/svg') === true, 'the plain icon');
});

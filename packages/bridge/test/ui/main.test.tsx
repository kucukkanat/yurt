import { expect, test } from 'vitest';

// The page's entry: it mounts into #root (talking to the bridge that served it), and refuses a page without one.
test('mounts the page into #root, and explains a page without one', async () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  const { mount } = await import('../../ui/src/main');
  await expect.poll(() => root.textContent, { timeout: 10_000 }).toContain('Connecting to the bridge');
  const empty = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
  expect(() => mount(empty)).toThrow('index.html has no #root element');
});

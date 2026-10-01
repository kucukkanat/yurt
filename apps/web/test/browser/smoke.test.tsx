import { expect, inject, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { Button } from '@yurt/ui';

test('renders a UI kit component in a real browser, with the local relay available', async () => {
  const screen = await render(<Button data-testid="b">Hello</Button>);
  await expect.element(screen.getByTestId('b')).toHaveTextContent('Hello');
  expect(inject('relayUrl')).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
});

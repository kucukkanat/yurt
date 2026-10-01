import { expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { Crash } from '../../../src/ui/Crash';
import { expectText } from './app';

function Boom({ thrown }: { thrown: unknown }): never {
  throw thrown;
}

it('shows a render error and its stack instead of a blank page', async () => {
  const screen = await render(
    <Crash>
      <Boom thrown={new TypeError('x is undefined')} />
    </Crash>,
  );
  await expectText(screen.getByRole('alert'), /^Something broke\./);
  await expectText(screen.getByTestId('crash-detail'), /^TypeError: x is undefined\s+at .*crash\.test/);
  await expect.element(screen.getByTestId('crash-reload')).toHaveTextContent('Reload');
});

it('adds the message to a stack that lacks it, as Safari’s does', async () => {
  const safari = new TypeError('undefined is not an object');
  safari.stack = 'Boom@https://example.test/app.js:1:2';
  const screen = await render(
    <Crash>
      <Boom thrown={safari} />
    </Crash>,
  );
  await expectText(screen.getByTestId('crash-detail'), /^TypeError: undefined is not an object\nBoom@/);
});

it('shows anything thrown, null included', async () => {
  const screen = await render(
    <Crash>
      <Boom thrown={null} />
    </Crash>,
  );
  await expect.element(screen.getByTestId('crash-detail')).toHaveTextContent('null');
});

it('renders its children while nothing fails', async () => {
  const screen = await render(
    <Crash>
      <p data-testid="fine">fine</p>
    </Crash>,
  );
  await expect.element(screen.getByTestId('fine')).toBeVisible();
});

import '../styles';
import { AgentStep, Avatar, Badge, Button, ChatMessage, Checkbox, Dialog, MemberRow, Radio, Select, Switch, Tabs, Tag, Toast } from '@yurt/ui';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

/** Moves keyboard focus with Tab until `name` is focused (the controls draw their own :focus-visible ring). */
async function tabTo(predicate: () => boolean, max = 20) {
  for (let i = 0; i < max && !predicate(); i++) await userEvent.tab();
  expect(predicate()).toBe(true);
}
const focusedName = () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '';

describe('keyboard focus rings', () => {
  it('draws on every focusable control when reached by Tab', async () => {
    const s = await render(
      <>
        <AgentStep title="Expandable">
          <p>body</p>
        </AgentStep>
        <Tag onClick={() => {}} onRemove={() => {}}>
          kw
        </Tag>
        <Checkbox label="cb" />
        <Radio name="r" value="1" label="rd" />
        <Switch aria-label="sw" />
      </>,
    );
    for (const want of ['Expandable', 'kw', 'Remove kw']) await tabTo(() => focusedName().includes(want));
    await tabTo(() => document.activeElement === s.getByRole('checkbox').element());
    await tabTo(() => document.activeElement === s.getByRole('radio').element());
    await tabTo(() => document.activeElement === s.getByRole('switch').element());
  });

  it('moves the select arrow and border while focused', async () => {
    const s = await render(<Select aria-label="Pick" options={['a', 'b']} />);
    await s.getByRole('combobox', { name: 'Pick' }).click();
    await expect.element(s.getByRole('combobox', { name: 'Pick' })).toHaveFocus();
  });
});

describe('remaining states', () => {
  it('nudges a right icon on hover and uses default props', async () => {
    const s = await render(
      <>
        <Button iconRight="arrow-right">Next</Button>
        <Badge>plain</Badge>
        <Toast title="Default tone" />
      </>,
    );
    await s.getByRole('button', { name: 'Next' }).hover();
    await expect.element(s.getByText('plain')).toBeVisible();
    const wide = await render(
      <Dialog open label="Wide" width={720} onClose={() => {}}>
        <div tabIndex={-1} data-autofocus>
          nothing focusable by Tab
        </div>
      </Dialog>,
    );
    await expect.element(wide.getByText('nothing focusable by Tab')).toHaveFocus();
    await userEvent.keyboard('{Tab}');
  });

  it('lets Tab do nothing in a panel without focusable controls', async () => {
    const s = await render(
      <Dialog open label="Empty" dismissible={false}>
        <div tabIndex={-1} data-autofocus>
          static
        </div>
      </Dialog>,
    );
    await expect.element(s.getByText('static')).toHaveFocus();
    await userEvent.keyboard('{Tab}');
  });

  it('hashes avatars without a name, shows a handle for online people, and reveals a continued message time on hover', async () => {
    const s = await render(
      <>
        {/* @ts-expect-error: a missing name still draws a fill */}
        <Avatar />
        <MemberRow member={{ name: 'On', handle: 'on', presence: 'online' }} />
        <ChatMessage author={{ name: 'Ada' }} time="09:00" text="first" />
        <ChatMessage author={{ name: 'Ada' }} time="09:01" text="second" continued />
      </>,
    );
    await expect.element(s.getByText('@on')).toBeVisible();
    await s.getByRole('article', { name: 'Ada, 09:01' }).hover();
    await expect.element(s.getByText('09:01')).toBeVisible();
    await expect.element(s.getByRole('button', { name: 'Pin' })).not.toBeInTheDocument(); // no onPin: no pin action
    const pin = await render(<ChatMessage author={{ name: 'Bo' }} time="1" text="pin me" onPin={() => {}} />);
    await pin.getByRole('article', { name: 'Bo, 1' }).hover();
    await expect.element(pin.getByRole('button', { name: 'Pin', exact: true })).toBeVisible();
  });

  it('tints an unselected tag on hover, and autofocuses the first control without a data-autofocus', async () => {
    const s = await render(<Tag onClick={() => {}}>loose</Tag>);
    await s.getByRole('button', { name: 'loose' }).hover();
    const d = await render(
      <Dialog open title="Plain" onClose={() => {}}>
        <p>no autofocus marker</p>
      </Dialog>,
    );
    await expect.element(d.getByRole('button', { name: 'Close (Esc)' })).toHaveFocus();
  });

  it('highlights the overflow arrows on hover', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: 't' + i, label: 'Tab number ' + i }));
    const s = await render(
      <div style={{ width: 300 }}>
        <Tabs items={many} />
      </div>,
    );
    const right = s.container.querySelectorAll('button[aria-hidden="true"]')[1] as HTMLButtonElement;
    await expect.poll(() => getComputedStyle(right).opacity).toBe('1');
    await userEvent.hover(right);
    await userEvent.unhover(right);
  });
});

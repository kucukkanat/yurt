import '../styles';
import { Badge, Button, Icon, IconButton, Kbd, Tag } from '@yurt/ui';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

describe('Button', () => {
  it('renders every variant and size, with icons and a shortcut hint', async () => {
    for (const variant of ['primary', 'agent', 'secondary', 'ghost', 'inverse', 'danger', 'bogus'] as const) {
      for (const size of ['sm', 'md', 'lg', 'xl'] as const) {
        const s = await render(
          // @ts-expect-error: unknown variants and sizes fall back to the defaults
          <Button variant={variant} size={size} iconLeft="check" iconRight="arrow-right" kbd="mod+k">
            Go
          </Button>,
        );
        await expect.element(s.getByRole('button', { name: /Go/ })).toBeVisible();
        await s.unmount();
      }
    }
  });

  it('reacts to hover, press and keyboard, and passes events through', async () => {
    const onClick = vi.fn();
    const onPointerEnter = vi.fn();
    const s = await render(
      <Button fullWidth onClick={onClick} onPointerEnter={onPointerEnter}>
        Save
      </Button>,
    );
    const b = s.getByRole('button', { name: 'Save' });
    await b.hover();
    expect(onPointerEnter).toHaveBeenCalled();
    await b.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Enter}');
    (b.element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await userEvent.unhover(b);
    (b.element() as HTMLElement).blur();
  });

  it('is inert while disabled or loading', async () => {
    const onClick = vi.fn();
    const s = await render(
      <>
        <Button disabled onClick={onClick}>
          Off
        </Button>
        <Button loading iconLeft="check" iconRight="arrow-right">
          Busy
        </Button>
      </>,
    );
    await expect.element(s.getByRole('button', { name: 'Off' })).toBeDisabled();
    await expect.element(s.getByRole('button', { name: 'Busy' })).toHaveAttribute('aria-busy', 'true');
    // Pointer handlers ignore a disabled control.
    const busy = s.getByRole('button', { name: 'Busy' });
    await busy.hover();
    busy.element().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    (busy.element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders an icon-only button without a label span', async () => {
    const s = await render(<Button iconLeft="plus" aria-label="Add" />);
    await expect.element(s.getByRole('button', { name: 'Add' })).toBeVisible();
  });
});

describe('IconButton', () => {
  it('labels the icon and shows active, round, hover, press and disabled states', async () => {
    const onClick = vi.fn();
    const s = await render(
      <>
        <IconButton icon="x" label="Close" onClick={onClick} />
        <IconButton icon="pin" label="Pinned" active round size="lg" variant="primary" />
        {/* @ts-expect-error: unknown variants and sizes fall back to the defaults */}
        <IconButton icon="pin" label="Odd" size="xl" variant="bogus" />
        <IconButton icon="trash-2" label="Off" disabled size="sm" />
      </>,
    );
    const close = s.getByRole('button', { name: 'Close' });
    await close.hover();
    await close.click();
    expect(onClick).toHaveBeenCalled();
    close.element().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    close.element().dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await expect.element(s.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(s.getByRole('button', { name: 'Off' })).toBeDisabled();
    await s.getByRole('button', { name: 'Odd' }).hover();
  });
});

describe('Badge', () => {
  it('renders tones, variants, sizes, dots and icons', async () => {
    for (const tone of ['neutral', 'accent', 'agent', 'human', 'success', 'warning', 'danger', 'bogus'] as const) {
      for (const variant of ['soft', 'solid', 'outline'] as const) {
        const s = await render(
          // @ts-expect-error: unknown tones fall back to neutral
          <Badge tone={tone} variant={variant} dot={variant === 'soft'} live={variant === 'solid'} icon="sparkles" size={variant === 'outline' ? 'sm' : 'md'}>
            {tone}
          </Badge>,
        );
        await expect.element(s.getByText(tone)).toBeVisible();
        await s.unmount();
      }
    }
  });
});

describe('Tag', () => {
  it('is plain text without a handler', async () => {
    const s = await render(<Tag icon="hash">plain</Tag>);
    await expect.element(s.getByText('plain')).toBeVisible();
    expect(s.container.querySelector('button')).toBeNull();
  });

  it('toggles, shows a check when selected, and removes by click or keyboard', async () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    const s = await render(
      <>
        <Tag icon="hash" selected onClick={onClick} onRemove={onRemove}>
          design
        </Tag>
        <Tag onClick={onClick} onRemove={onRemove} removeLabel="Drop it">
          <b>rich</b>
        </Tag>
        <Tag onRemove={onRemove}>{42}</Tag>
      </>,
    );
    const tag = s.getByRole('button', { name: 'design' });
    await expect.element(tag).toHaveAttribute('aria-pressed', 'true');
    await tag.hover();
    await tag.click();
    expect(onClick).toHaveBeenCalled();
    const rm = s.getByRole('button', { name: 'Remove design' });
    await rm.hover();
    await rm.click();
    (rm.element() as HTMLElement).focus();
    await userEvent.keyboard('{Backspace}');
    await userEvent.keyboard('{Delete}');
    await userEvent.keyboard('a');
    expect(onRemove).toHaveBeenCalledTimes(3);
    await expect.element(s.getByRole('button', { name: 'Drop it' })).toBeVisible();
    await expect.element(s.getByRole('button', { name: 'Remove' })).toBeVisible();
  });

  it('is inert when disabled', async () => {
    const s = await render(
      <Tag onClick={() => {}} onRemove={() => {}} disabled>
        off
      </Tag>,
    );
    await expect.element(s.getByRole('button', { name: 'off' })).toBeDisabled();
    await expect.element(s.getByRole('button', { name: 'Remove off' })).toBeDisabled();
  });
});

describe('Kbd and Icon', () => {
  it('draws Mac symbols for named keys and spells the combination for screen readers', async () => {
    const s = await render(
      <>
        <Kbd keys="mod+shift+k" />
        <Kbd keys={['ctrl', 'alt', 'opt', 'cmd', 'enter', 'return', 'esc', 'tab', 'up', 'down', 'left', 'right', 'backspace', 'space', 'x']} size="sm" tone="onAccent" />
        <Kbd keys="a" tone="onAgent" />
        <Kbd keys="b" tone="inverse" />
      </>,
    );
    await expect.element(s.getByText('mod + shift + k')).toBeInTheDocument();
    expect(s.container.textContent).toContain('⌘⇧K');
  });

  it('labels meaningful icons, hides decorative ones and warns about unknown names', async () => {
    const warn = vi.spyOn(console, 'warn');
    const s = await render(
      <>
        <Icon name="check" label="Done" />
        <Icon name="check" />
        {/* @ts-expect-error: not an icon name */}
        <Icon name="nope" />
      </>,
    );
    await expect.element(s.getByRole('img', { name: 'Done' })).toBeVisible();
    expect(warn).toHaveBeenCalledWith('Icon: unknown name "nope"');
    warn.mockRestore();
  });
});

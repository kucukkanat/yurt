import '../styles';
import { Checkbox, Dialog, Input, Radio, Select, Switch, Tabs, Toast, Tooltip } from '@yurt/ui';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

describe('Checkbox', () => {
  it('toggles uncontrolled, reports changes, shows label, description and indeterminate', async () => {
    const onChange = vi.fn();
    const s = await render(
      <>
        <Checkbox label="Mentions" description="When someone @mentions it" onChange={onChange} />
        <Checkbox label="Mixed" indeterminate />
        <Checkbox aria-label="Bare" defaultChecked />
        <Checkbox label="Off" disabled />
      </>,
    );
    const box = s.getByRole('checkbox', { name: /Mentions/ });
    await box.click();
    await expect.element(box).toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(1);
    await box.click();
    await expect.element(box).not.toBeChecked();
    expect((s.getByRole('checkbox', { name: 'Mixed' }).element() as HTMLInputElement).indeterminate).toBe(true);
    await expect.element(s.getByRole('checkbox', { name: 'Bare' })).toBeChecked();
    await expect.element(s.getByRole('checkbox', { name: 'Off' })).toBeDisabled();
    await userEvent.tab();
    await userEvent.tab();
  });

  it('follows its controlled value and clears indeterminate', async () => {
    function Controlled() {
      const [on, setOn] = useState(false);
      const [mixed, setMixed] = useState(true);
      return (
        <>
          <Checkbox label="Ctl" checked={on} indeterminate={mixed} onChange={(e) => setOn(e.target.checked)} />
          <button type="button" onClick={() => setMixed(false)}>
            settle
          </button>
        </>
      );
    }
    const s = await render(<Controlled />);
    const box = s.getByRole('checkbox', { name: 'Ctl' });
    await s.getByRole('button', { name: 'settle' }).click();
    expect((box.element() as HTMLInputElement).indeterminate).toBe(false);
    await box.click();
    await expect.element(box).toBeChecked();
    await s.unmount();
  });
});

describe('Radio', () => {
  it('re-reads siblings in an uncontrolled group and reports changes', async () => {
    const onChange = vi.fn();
    const s = await render(
      <>
        <Radio name="where" value="thread" label="Thread" defaultChecked onChange={onChange} />
        <Radio name="where" value="channel" label="Channel" description="Top level" />
        {/* @ts-expect-error: no group name (a JS caller): it doesn't listen for siblings */}
        <Radio value="lonely" label="No group" />
        <Radio name="where" value="x" label="Locked" disabled />
      </>,
    );
    await s.getByRole('radio', { name: /Channel/ }).click();
    await expect.element(s.getByRole('radio', { name: /Channel/ })).toBeChecked();
    await expect.element(s.getByRole('radio', { name: 'Thread' })).not.toBeChecked();
    await s.getByRole('radio', { name: 'Thread' }).click();
    expect(onChange).toHaveBeenCalledTimes(1);
    await s.getByRole('radio', { name: 'No group' }).click();
    await expect.element(s.getByRole('radio', { name: 'Locked' })).toBeDisabled();
  });

  it('follows its controlled value', async () => {
    function Controlled() {
      const [v, setV] = useState('a');
      return (
        <>
          {['a', 'b'].map((x) => (
            <Radio key={x} name="ctl" value={x} label={x.toUpperCase()} checked={v === x} onChange={() => setV(x)} />
          ))}
        </>
      );
    }
    const s = await render(<Controlled />);
    await s.getByRole('radio', { name: 'B' }).click();
    await expect.element(s.getByRole('radio', { name: 'B' })).toBeChecked();
    await s.unmount();
  });
});

describe('Switch', () => {
  it('toggles, presses, labels and describes, in both sizes and tones', async () => {
    const onChange = vi.fn();
    const s = await render(
      <>
        <Switch label="Calls" description="Voice and video" onChange={onChange} />
        <Switch aria-label="Small agent" size="sm" tone="agent" defaultChecked />
        {/* @ts-expect-error: unknown sizes fall back to md */}
        <Switch aria-label="Odd size" size="xl" />
        <Switch label="Locked" disabled />
      </>,
    );
    const sw = s.getByRole('switch', { name: 'Calls' });
    await expect.element(sw).toHaveAccessibleDescription('Voice and video');
    sw.element().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    sw.element().dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    sw.element().dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    await sw.click();
    await expect.element(sw).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenCalledWith(true);
    await s.getByText('Calls').click(); // the label toggles it too
    await expect.element(sw).toHaveAttribute('aria-checked', 'false');
    await expect.element(s.getByRole('switch', { name: 'Small agent' })).toHaveAttribute('aria-checked', 'true');
    const locked = s.getByRole('switch', { name: 'Locked' });
    (locked.element() as HTMLButtonElement).click();
    await expect.element(locked).toHaveAttribute('aria-checked', 'false');
  });

  it('follows its controlled value', async () => {
    const s = await render(<Switch aria-label="Ctl" checked onChange={() => {}} />);
    await s.getByRole('switch', { name: 'Ctl' }).click();
    await expect.element(s.getByRole('switch', { name: 'Ctl' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Input and Select', () => {
  it('shows label, optional mark, hint, error, icon and suffix, and tracks focus', async () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const s = await render(
      <>
        <Input label="Name" optional hint="Shown to others" iconLeft="user" suffix={<span>sfx</span>} onFocus={onFocus} onBlur={onBlur} size="lg" />
        <Input label="Handle" error="Taken" />
        <Input aria-label="Bare" disabled size="sm" />
        <Input aria-label="Plain" />
      </>,
    );
    const name = s.getByRole('textbox', { name: /^Name/ });
    await expect.element(name).toHaveAccessibleDescription('Shown to others');
    await name.click();
    await name.fill('Ada');
    await s.getByRole('textbox', { name: 'Plain' }).click();
    expect(onFocus).toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalled();
    await expect.element(s.getByRole('alert')).toHaveTextContent('Taken');
    await s.getByRole('textbox', { name: 'Handle' }).click();
    await expect.element(s.getByRole('textbox', { name: 'Bare' })).toBeDisabled();
    await expect.element(s.getByText('Optional')).toBeVisible();
  });

  it('lists string and object options with a placeholder and reports changes', async () => {
    const onChange = vi.fn();
    const s = await render(
      <>
        <Select label="Runtime" placeholder="Pick one" options={['copilot', { value: 'claude', label: 'Claude Code' }]} defaultValue="" onChange={onChange} hint="Installed CLIs" />
        <Select aria-label="Broken" error="Required" options={[]} disabled size="lg" />
        {/* @ts-expect-error: the JS default for missing options */}
        <Select aria-label="Bare" />
      </>,
    );
    const sel = s.getByRole('combobox', { name: 'Runtime' });
    await sel.selectOptions('claude');
    expect(onChange).toHaveBeenCalled();
    (sel.element() as HTMLSelectElement).focus();
    (sel.element() as HTMLSelectElement).blur();
    await expect.element(s.getByRole('alert')).toHaveTextContent('Required');
  });
});

describe('Dialog', () => {
  function Host({ dismissible = true, named = true, empty = false }) {
    const title = named ? 'Settings' : undefined;
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          open
        </button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title={title}
          label="Jump to"
          description={title ? 'Everything in one place' : undefined}
          footer={empty ? undefined : <button type="button">Done</button>}
          dismissible={dismissible}
          inline={!dismissible}
        >
          {empty ? undefined : (
            <>
              <input aria-label="first" data-autofocus />
              <button type="button">middle</button>
            </>
          )}
        </Dialog>
      </>
    );
  }

  it('focuses the autofocus field, traps Tab, and closes on Escape, the close button and the backdrop', async () => {
    const s = await render(<Host />);
    const dlg = s.getByRole('dialog', { name: 'Settings' });
    await expect.element(dlg).toBeVisible();
    await expect.element(s.getByRole('textbox', { name: 'first' })).toHaveFocus();
    await userEvent.keyboard('{Tab}{Tab}'); // input → middle → Done, the last focusable
    await expect.element(s.getByRole('button', { name: 'Done' })).toHaveFocus();
    await userEvent.keyboard('{Tab}'); // last → wraps to the first (the close button)
    await expect.element(s.getByRole('button', { name: 'Close (Esc)' })).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}'); // first → wraps to the last
    await expect.element(s.getByRole('button', { name: 'Done' })).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}'); // an inner step is left to the browser
    await userEvent.keyboard('a');
    await userEvent.keyboard('{Escape}');
    await expect.element(dlg).not.toBeInTheDocument();
    await s.getByRole('button', { name: 'open' }).click();
    await s.getByRole('button', { name: 'Close (Esc)' }).click();
    await expect.element(s.getByRole('dialog')).not.toBeInTheDocument();
    await s.getByRole('button', { name: 'open' }).click();
    // Escape from outside the panel (focus still on the page) closes it too.
    (s.getByRole('button', { name: 'open' }).element() as HTMLElement).focus();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect.element(s.getByRole('dialog')).not.toBeInTheDocument();
    await s.getByRole('button', { name: 'open' }).click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    const backdrop = s.getByRole('dialog').element().parentElement as HTMLElement;
    s.getByRole('dialog')
      .element()
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await expect.element(s.getByRole('dialog')).toBeVisible();
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await expect.element(s.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('can be undismissable and unnamed, and tolerates a panel with nothing to focus', async () => {
    const s = await render(<Host dismissible={false} named={false} empty />);
    const dlg = s.getByRole('dialog', { name: 'Jump to' });
    await expect.element(dlg).toBeVisible();
    (dlg.element() as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Tab}');
    (dlg.element().parentElement as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await expect.element(dlg).toBeVisible();
  });
});

describe('Toast', () => {
  it('shows tones, an action with an undo icon, and closes by button or timer (paused on hover and focus)', async () => {
    const onClose = vi.fn();
    const onAction = vi.fn();
    const s = await render(
      <>
        <Toast tone="success" title="Saved" description="All good" actionLabel="Undo" onAction={onAction} onClose={onClose} duration={1500} />
        <Toast tone="agent" title="Agent" icon="sparkles" actionLabel="Open" />
        {/* @ts-expect-error: unknown tones fall back to neutral */}
        <Toast tone="bogus" title="Plain" />
        <Toast tone="human" title="Human" />
        <Toast tone="danger" title="Danger" />
      </>,
    );
    const saved = s.getByRole('status').filter({ hasText: 'Saved' });
    await saved.hover(); // paused while hovered
    await s.getByRole('button', { name: 'Undo' }).click();
    expect(onAction).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 1700));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.unhover(saved);
    saved.element().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    saved.element().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await expect.poll(() => onClose.mock.calls.length, { timeout: 4000 }).toBeGreaterThan(0);
    await s.getByRole('button', { name: 'Dismiss' }).click();
  });
});

describe('Tooltip', () => {
  it('opens after a delay on hover, at once on focus, and closes on leave, blur and Escape', async () => {
    const s = await render(
      <div style={{ padding: 60 }}>
        <Tooltip content="Search" kbd="mod+f">
          <button type="button">find</button>
        </Tooltip>
        {/* @ts-expect-error: plain text children (a JS caller) get no aria-describedby but still show the tip */}
        <Tooltip content="Below" placement="bottom" delay={0}>
          text only
        </Tooltip>
        <Tooltip content="Pinned open" forceOpen>
          <span>pin</span>
        </Tooltip>
      </div>,
    );
    const btn = s.getByRole('button', { name: 'find' });
    await btn.hover();
    await expect.element(s.getByRole('tooltip').nth(0)).toBeVisible();
    await expect.element(btn).toHaveAccessibleDescription(/Search/);
    await userEvent.unhover(btn);
    await expect.element(btn).not.toHaveAttribute('aria-describedby');
    (btn.element() as HTMLElement).focus();
    await expect.element(s.getByRole('tooltip').nth(0)).toBeVisible();
    await userEvent.keyboard('a');
    await userEvent.keyboard('{Escape}');
    await expect.element(btn).not.toHaveAttribute('aria-describedby');
    (btn.element() as HTMLElement).blur();
    await s.getByText(/text only/).hover();
    // "Below" (hovered) and "Pinned open" (forced) are showing; "Search" is not.
    await expect
      .poll(() =>
        s
          .getByRole('tooltip')
          .elements()
          .map((e) => e.textContent),
      )
      .toEqual(['Below', 'Pinned open']);
    await s.unmount();
  });
});

describe('Tabs', () => {
  const items = [
    { id: 'all', label: 'All', icon: 'list-checks' as const, count: 3 },
    { id: 'off', label: 'Disabled', disabled: true },
    { id: 'mine', label: 'Mine', count: 0 },
    { id: 'more', label: 'More' },
  ];

  it('selects by click and by arrows, Home and End, skipping disabled tabs', async () => {
    const onChange = vi.fn();
    const s = await render(<Tabs items={items} onChange={onChange} label="Filter" />);
    await expect.element(s.getByRole('tablist', { name: 'Filter' })).toBeVisible();
    await s.getByRole('tab', { name: /^Mine/ }).click();
    expect(onChange).toHaveBeenLastCalledWith('mine');
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(s.getByRole('tab', { name: 'More' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}'); // wraps past the disabled tab
    await expect.element(s.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{Home}');
    await userEvent.keyboard('{End}');
    await userEvent.keyboard('x');
    await expect.element(s.getByRole('tab', { name: 'More' })).toHaveAttribute('aria-selected', 'true');
  });

  it('underlines in the underline variant, fills the width, and follows a controlled value', async () => {
    const s = await render(<Tabs items={items} value="mine" variant="underline" size="sm" fullWidth />);
    await s.getByRole('tab', { name: 'More' }).click();
    await expect.element(s.getByRole('tab', { name: /^Mine/ })).toHaveAttribute('aria-selected', 'true');
    await s.rerender(<Tabs items={items} value="more" variant="underline" size="sm" fullWidth />);
    await expect.element(s.getByRole('tab', { name: 'More' })).toHaveAttribute('aria-selected', 'true');
  });

  it('scrolls overflowing tabs with the edge buttons and keeps the active one in view', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: 't' + i, label: 'Tab number ' + i }));
    const s = await render(
      <div style={{ width: 300 }}>
        <Tabs items={many} defaultValue="t0" />
      </div>,
    );
    const right = s.container.querySelectorAll('button[aria-hidden="true"]')[1] as HTMLButtonElement;
    const left = s.container.querySelectorAll('button[aria-hidden="true"]')[0] as HTMLButtonElement;
    await expect.poll(() => getComputedStyle(right).opacity).toBe('1');
    right.dispatchEvent(new PointerEvent('pointerenter'));
    right.dispatchEvent(new PointerEvent('pointerleave'));
    right.click();
    const scroller = s.getByRole('tablist').element().parentElement as HTMLElement;
    await expect.poll(() => scroller.scrollLeft).toBeGreaterThan(0);
    left.click();
    await s.getByRole('tab', { name: 'Tab number 0' }).click();
    await userEvent.keyboard('{End}'); // far right: scrolls it into view
    await expect.poll(() => scroller.scrollLeft).toBeGreaterThan(200);
    await userEvent.keyboard('{Home}'); // back to the left edge
    await expect.poll(() => scroller.scrollLeft).toBe(0);
    await s.unmount();
  });

  it('renders nothing selectable without items', async () => {
    // @ts-expect-error: the JS default for missing items
    const s = await render(<Tabs />);
    await expect.element(s.getByRole('tablist', { name: 'Tabs' })).toBeInTheDocument();
  });
});

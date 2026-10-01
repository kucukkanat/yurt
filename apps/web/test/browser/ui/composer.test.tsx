import './styles';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Composer } from '../../../src/ui/Composer';

describe('Composer on its own', () => {
  it('keeps what was typed while a send was in flight, and doesn’t grab focus unless asked', async () => {
    let finish: (ok: boolean) => void = () => {};
    const sent: string[] = [];
    const onSend = (text: string) =>
      new Promise<boolean>((resolve) => {
        sent.push(text);
        finish = resolve;
      });
    const s = await render(<Composer members={[]} placeholder="Say something" onSend={onSend} />);
    const box = s.getByRole('textbox', { name: 'Say something' });
    await expect.element(box).not.toHaveFocus();
    await box.fill('first');
    await userEvent.keyboard('{Enter}'); // not focused: nothing sent
    await box.click();
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => sent).toEqual(['first']);
    await expect.element(s.getByTestId('composer-send')).toBeDisabled(); // while sending
    await box.fill('second, typed while the first was sending');
    finish(true);
    await expect.element(box).toHaveValue('second, typed while the first was sending');
    await s.getByTestId('composer-send').click();
    finish(false); // not sent: the draft stays
    await expect.element(box).toHaveValue('second, typed while the first was sending');
    await userEvent.keyboard('{ArrowUp}'); // no handler for Up here (e.g. a thread): the caret just moves
    await box.fill('');
    await userEvent.keyboard('{ArrowUp}');
  });

  it('opens the file picker from the paperclip', async () => {
    const s = await render(<Composer members={[]} placeholder="Files" onSend={async () => true} autoFocus />);
    await expect.element(s.getByRole('textbox', { name: 'Files' })).toHaveFocus();
    const input = s.container.querySelector('input[type=file]') as HTMLInputElement;
    let opened = false;
    input.addEventListener('click', (e) => {
      opened = true;
      e.preventDefault(); // a test can't drive the OS file chooser
    });
    await s.getByRole('button', { name: 'Attach files (up to 25 MB)' }).click();
    expect(opened).toBe(true);
  });
});

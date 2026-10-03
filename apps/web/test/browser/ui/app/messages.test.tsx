import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { EDIT_WINDOW_MS, sha256Buf, uploadFile } from '@yurt/protocol';
import { blossomUrl, createWorkspace, expectText, getPeer, me, member, startApp, until, useApp } from '../app';

let code = '';
let bo: Awaited<ReturnType<typeof member>>;
const composer = () => page.getByRole('textbox', { name: 'Message #general' });
const msg = (text: string | RegExp) => page.getByRole('article').filter({ hasText: text });
/** Hovers a message to show its toolbar, centred first so the toolbar (drawn just above it) isn't clipped by the log. */
async function hover(text: string | RegExp) {
  const m = msg(text);
  await expect.element(m).toBeVisible();
  m.element().scrollIntoView({ block: 'center' });
  await m.hover();
  return m;
}
const state = () => useApp.getState().states[code];
const textMsgs = () => [...(state()?.msgs.values() ?? [])];
const lastMine = () =>
  textMsgs()
    .filter((m) => m.a === me().pub && !m.ag)
    .at(-1);

describe('a channel conversation', () => {
  it('starts empty, with invite and agent shortcuts', async () => {
    await startApp({ as: 'Ada' });
    code = await createWorkspace('Northwind');
    await expect.element(page.getByText('#general is ready')).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Invite people' }).first().click();
    await page.getByTestId('invite-create').click();
    await expect.element(page.getByTestId('invite-link')).toBeVisible();
    await page.getByTestId('invite-link').click(); // selects the link for copying by hand
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect.element(page.getByText('Couldn’t copy link')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await page.getByRole('main').getByRole('button', { name: 'Add agent' }).last().click();
    await expect.element(page.getByTestId('ws-agents-nobridge')).toBeVisible();
    await page.getByRole('button', { name: 'Set up the bridge' }).click();
    await expect.element(page.getByTestId('bridge-install')).toBeVisible();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect.element(page.getByText('Couldn’t copy command')).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });

  it('sends with Enter, keeps Shift+Enter as a newline, and won’t send nothing', async () => {
    bo = await member(code, 'Bo');
    await expect.element(page.getByTestId('composer-send')).toBeDisabled();
    await composer().click();
    await userEvent.keyboard('{Enter}'); // empty: nothing happens
    await userEvent.keyboard('first line{Shift>}{Enter}{/Shift}second line');
    await userEvent.keyboard('{Enter}');
    await expect.element(msg(/first line\s*second line/)).toBeVisible();
    await expect.element(composer()).toHaveValue('');
    await composer().fill('via the button');
    await page.getByTestId('composer-send').click();
    await expect.element(msg('via the button')).toBeVisible();
    await until(() => !!bo.state.msgs.size);
  });

  it('picks a mention by keyboard and by mouse, and closes the picker with Escape', async () => {
    await composer().click();
    await userEvent.keyboard('hi @b');
    const picker = page.getByRole('listbox', { name: 'Mention someone' });
    await expect.element(picker).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    await expect.element(composer()).toHaveValue('hi @bo ');
    await userEvent.keyboard('and @');
    await expect.element(picker).toBeVisible();
    await userEvent.keyboard('{Tab}');
    await expect.element(composer()).toHaveValue('hi @bo and @bo ');
    await userEvent.keyboard('@zz'); // no match: no picker, keys behave normally
    await expect.element(picker).not.toBeInTheDocument();
    await userEvent.keyboard('{Backspace}{Backspace}');
    await expect.element(picker).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(picker).not.toBeInTheDocument();
    await composer().fill('');
    // The @ button opens the picker; a mouse pick inserts the handle.
    await page.getByRole('button', { name: 'Mention', exact: true }).click();
    await expect.element(composer()).toHaveValue('@');
    await page.getByRole('option', { name: /Bo/ }).hover();
    await page.getByRole('option', { name: /Bo/ }).click();
    await expect.element(composer()).toHaveValue('@bo ');
    await page.getByRole('button', { name: 'Mention', exact: true }).click();
    await expect.element(composer()).toHaveValue('@bo @');
    await composer().fill('x');
    await page.getByRole('button', { name: 'Mention', exact: true }).click();
    await expect.element(composer()).toHaveValue('x @');
    // Leaving the field closes the picker shortly after.
    (composer().element() as HTMLElement).blur();
    await expect.element(picker).not.toBeInTheDocument();
    await composer().fill('');
  });

  it('attaches, removes and sends files, by picker and by paste; refuses files over 25 MB', async () => {
    await userEvent.upload(page.getByLabelText('Attach files (up to 25 MB)').element().parentElement?.querySelector('input[type=file]') as HTMLElement, [
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
      new File([new Uint8Array([137, 80, 78, 71])], 'pic.png', { type: 'image/png' }),
    ]);
    await expect.element(page.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove pic.png' }).click();
    // Paste a file into the composer; plain-text paste is left to the browser.
    const dt = new DataTransfer();
    dt.items.add(new File(['pasted'], 'pasted.txt', { type: 'text/plain' }));
    composer()
      .element()
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    composer()
      .element()
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
    await expect.element(page.getByRole('button', { name: 'Remove pasted.txt' })).toBeVisible();
    await page.getByTestId('composer-send').click();
    await expect.element(page.getByRole('link', { name: 'Download notes.txt' })).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Download pasted.txt' })).toBeVisible();
    // Too big: refused with a toast, and the draft stays.
    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'huge.bin');
    const dt2 = new DataTransfer();
    dt2.items.add(big);
    composer()
      .element()
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true }));
    await composer().fill('with a huge file');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('huge.bin is over 25 MB')).toBeVisible();
    await expect.element(composer()).toHaveValue('with a huge file');
    await page.getByRole('button', { name: 'Remove huge.bin' }).click();
    await composer().fill('');
  });

  it('shows images inline and fetches others’ files from the file server, with a retry when it can’t', async () => {
    const png = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).arrayBuffer();
    const blob = await uploadFile([blossomUrl()], new Uint8Array(png));
    const id = await sha256Buf(png); // a file's id is the hash of its plaintext
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'look', files: [{ id, name: 'dot.png', size: png.byteLength, type: 'image/png', blob }] } });
    await expect.element(page.getByRole('img', { name: 'dot.png' })).toBeVisible();
    // A file no member or server has: it can't be fetched, and says so.
    await bo.say({ t: 'msg', ch: 'general', b: { text: '', files: [{ id: 'f'.repeat(64), name: 'gone.txt', size: 2048, type: 'text/plain' }] } });
    const status = page.getByTestId('attachment-status');
    await expectText(status.last(), /Couldn’t download · retry|waiting for a peer who has it/);
    await page.getByTestId('attachment-retry').last().click();
    await expectText(status.last(), /Couldn’t download · retry/);
  });

  it('groups messages, marks mentions and tints agent talk', async () => {
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'one' } });
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'two, @ada' } });
    await expect.element(msg('two, @ada')).toBeVisible();
    // An agent mentioning another agent is "agent talk".
    bo.publish({ t: 'agent', b: { id: 'scout', name: 'Scout', handle: 'scout', runtime: 'copilot', replyIn: 'thread' } });
    bo.publish({ t: 'agent', b: { id: 'rex', name: 'Rex', handle: 'rex', runtime: 'copilot', replyIn: 'thread' } });
    await until(() => (state()?.agents.size ?? 0) === 2);
    await bo.say({
      t: 'msg',
      ch: 'general',
      ag: 'scout',
      b: {
        text: 'over to you @rex',
        trace: [
          { title: 'Read', status: 'done', ms: 1200 },
          { title: 'Write', status: 'running' },
        ],
        meta: '2 tools · 3s',
      },
    });
    await expect.element(page.getByRole('button', { name: /2 steps/ })).toBeVisible();
    await bo.say({ t: 'msg', ch: 'general', ag: 'scout', b: { text: 'single step', trace: [{ title: 'Only', status: 'done' }] } });
    await expect.element(page.getByRole('button', { name: /1 step/ })).toBeVisible();
  });

  it('reacts, pins, and opens the author’s profile and mentioned people', async () => {
    const m = await hover('two, @ada');
    await m.getByRole('button', { name: 'React', exact: true }).click();
    await expect.element(m.getByRole('button', { name: 'thumbs-up 1' })).toHaveAttribute('aria-pressed', 'true');
    await m.getByRole('button', { name: 'thumbs-up 1' }).click(); // toggles mine off
    await expect.element(m.getByRole('button', { name: /thumbs-up/ })).not.toBeInTheDocument();
    await hover('two, @ada');
    await m.getByRole('button', { name: 'Pin', exact: true }).click();
    await expect.poll(() => [state()?.pins.get('general')?.size ?? 0, m.element().outerHTML.includes('Pinned')]).toEqual([1, true]);
    await composer().hover(); // away from the message (unhover lands mid-page, on the log). Grouped under "one", so the pin is marked in the gutter (where the time shows on hover)
    await expect.element(m.getByRole('img', { name: 'Pinned' })).toBeVisible();
    await hover('two, @ada');
    await m.getByRole('button', { name: 'Unpin' }).click();
    // An icon the app can't draw (from another client) is left out rather than breaking the message.
    const target = textMsgs().find((x) => x.text === 'one');
    await bo.say({ t: 'react', ch: 'general', b: { target: target?.id, icon: 'not-an-icon', on: true } });
    await msg('look').getByRole('button', { name: 'Open profile: Bo' }).click(); // Bo's first message carries the avatar
    await expect.element(page.getByRole('complementary', { name: 'Profile' })).toBeVisible();
    await m.getByRole('button', { name: '@ada' }).click();
    await expect.element(page.getByRole('button', { name: 'Notes to self' })).toBeVisible();
    await page.getByRole('complementary', { name: 'Profile' }).getByRole('button', { name: 'Close (Esc)' }).click();
  });

  it('edits my message inline, cancels, and saves', async () => {
    await composer().fill('typo here');
    await userEvent.keyboard('{Enter}');
    await expect.element(msg('typo here')).toBeVisible();
    // Up-arrow in an empty composer edits my last message.
    await composer().click();
    await userEvent.keyboard('{ArrowUp}');
    const editor = page.getByRole('textbox', { name: 'Edit message' });
    await expect.element(editor).toHaveFocus();
    await expectText(page.getByTestId('edit-time-left'), /min left/);
    await userEvent.keyboard('{Escape}');
    await expect.element(editor).not.toBeInTheDocument();
    await hover('typo here');
    await page.getByTestId('msg-edit').click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await hover('typo here');
    await page.getByTestId('msg-edit').click();
    await editor.fill('   ');
    await userEvent.keyboard('{Enter}'); // blank: not saved
    await page.getByRole('button', { name: 'Save', exact: true }).click(); // blank: not saved
    await editor.fill('fixed text');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.element(msg(/fixed text/)).toBeVisible();
    await expect.element(msg(/fixed text/).getByText('edited')).toBeVisible();
    await hover(/fixed text/);
    await page.getByTestId('msg-edit').click();
    await editor.fill('fixed again');
    await userEvent.keyboard('{Enter}');
    await expect.element(msg('fixed again')).toBeVisible();
  });

  it('deletes with an undo, and deletes for real when the toast goes away', async () => {
    await hover('fixed again');
    await page.getByTestId('msg-delete').click();
    await expect.element(msg('fixed again')).not.toBeInTheDocument();
    await page.getByRole('button', { name: /Undo/ }).click();
    await expect.element(msg('fixed again')).toBeVisible();
    await hover('fixed again');
    await page.getByTestId('msg-delete').click();
    await page.getByRole('button', { name: 'Dismiss' }).last().click();
    await until(() => !!lastMine()?.deleted || textMsgs().some((m) => m.text === 'fixed again' && m.deleted));
    await expect.element(page.getByText('Message deleted', { exact: true })).toBeVisible();
  });

  it('explains when the edit window has closed, and when it closes while editing', async () => {
    const p = getPeer(code);
    if (!p) throw new Error('no peer');
    // Written earlier on another of my devices, past the edit window (in a channel that already existed then).
    p.publish({ t: 'ch.create', b: { id: 'archive', name: 'archive' }, ts: Date.now() - EDIT_WINDOW_MS - 120_000 });
    p.publish({ t: 'msg', ch: 'archive', b: { text: 'long ago' }, ts: Date.now() - EDIT_WINDOW_MS - 60_000 });
    useApp.getState().go({ code, ch: 'archive' });
    await expect.element(msg('long ago')).toBeVisible();
    await hover('long ago');
    await page.getByTestId('msg-edit-locked').click();
    await expect.element(page.getByText('This message can’t be changed anymore')).toBeVisible();
    await page.getByRole('button', { name: 'Reply in thread' }).last().click(); // the toast's action opens its thread
    await expect.element(page.getByRole('complementary', { name: 'Thread' })).toBeVisible();
    await page.getByRole('complementary', { name: 'Thread' }).getByRole('button', { name: 'Close (Esc)' }).click();
    // Up-arrow on a message past the window explains instead of opening the editor.
    await page.getByRole('textbox', { name: 'Message #archive' }).click();
    await userEvent.keyboard('{ArrowUp}');
    await expect.element(page.getByText('Your last message can’t be edited anymore')).toBeVisible();
    // Opened with seconds to go: the warning colour, then saving after it closed explains instead.
    p.publish({ t: 'msg', ch: 'archive', b: { text: 'almost too late' }, ts: Date.now() - EDIT_WINDOW_MS + 1500 });
    await hover('almost too late');
    await page.getByTestId('msg-edit').click();
    await expect.element(page.getByTestId('edit-time-left')).toHaveTextContent('less than a minute left');
    await new Promise((r) => setTimeout(r, 1700));
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => page.getByText('This message can’t be changed anymore').elements().length).toBeGreaterThan(0);
  });
});

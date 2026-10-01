import { afterAll, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { EDIT_WINDOW_MS } from '@yurt/protocol';
import { createWorkspace, expectText, getPeer, me, member, startApp, until, useApp } from '../app';

// A phone: Chromium's touch emulation (so `(pointer: coarse)` matches) and touch pointer events on the real UI.

let code = '';
let bo: Awaited<ReturnType<typeof member>>;
const msg = (text: string | RegExp) => page.getByRole('article').filter({ hasText: text });
const sheet = () => page.getByRole('dialog', { name: 'Message actions' });
const state = () => useApp.getState().states[code];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The message's element, once it's on screen (`.element()` alone doesn't wait). */
async function shown(text: string) {
  await expect.element(msg(text)).toBeVisible();
  return msg(text).element();
}

/** A touch pointer event, as a finger on a touch screen produces it. */
function touch(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number, pointerType = 'touch') {
  el.dispatchEvent(new PointerEvent(type, { pointerType, pointerId: 7, isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
}
/** A finger dragged from `from` to `to` over about `ms`, then lifted. */
async function swipe(el: Element, from: [number, number], to: [number, number], ms = 160, pointerType = 'touch') {
  touch(el, 'pointerdown', ...from, pointerType);
  for (let i = 1; i <= 6; i++) {
    await wait(ms / 6);
    touch(el, 'pointermove', from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6, pointerType);
  }
  touch(el, 'pointerup', ...to, pointerType);
}
/** A finger held still on `el`. */
async function hold(el: Element, ms = 600) {
  const r = el.getBoundingClientRect();
  touch(el, 'pointerdown', r.left + 40, r.top + 10);
  await wait(ms / 3);
  touch(el, 'pointermove', r.left + 43, r.top + 11); // a finger never holds perfectly still
  await wait((ms * 2) / 3);
  touch(el, 'pointerup', r.left + 40, r.top + 10);
}
async function longPress(text: string | RegExp) {
  const m = msg(text);
  await expect.element(m).toBeVisible();
  await hold(m.element());
  await expect.element(sheet()).toBeVisible();
}

afterAll(() => commands.emulateTouch(false));

describe('on a touch screen', () => {
  it('long-pressing a message opens its actions instead of the hover bar', async () => {
    await commands.emulateTouch(true);
    await startApp({ as: 'Ada' });
    await until(() => matchMedia('(pointer: coarse)').matches, 10_000, 'touch emulation');
    await userEvent.click(document.body); // a person touched the page: vibration is allowed from here on
    code = await createWorkspace('Northwind');
    bo = await member(code, 'Bo');
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'hello from Bo' } });
    await longPress('hello from Bo');
    // Someone else's message: react, reply, copy and pin, but never edit or delete.
    for (const id of ['reply', 'copy', 'pin', 'cancel']) await expect.element(page.getByTestId('sheet-' + id)).toBeVisible();
    await expect.element(page.getByTestId('sheet-edit')).not.toBeInTheDocument();
    await page.getByTestId('sheet-react-heart').click();
    await expect.element(sheet()).not.toBeInTheDocument();
    await until(() => [...(state()?.msgs.values() ?? [])].some((m) => m.reactions.heart?.includes(me().pub)), 10_000, 'the reaction');
  });

  it('closes with Cancel, Escape or a tap beside it', async () => {
    await longPress('hello from Bo');
    await page.getByTestId('sheet-cancel').click();
    await expect.element(sheet()).not.toBeInTheDocument();
    await longPress('hello from Bo');
    await userEvent.keyboard('{Shift}'); // only Escape closes it
    await expect.element(sheet()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(sheet()).not.toBeInTheDocument();
    await longPress('hello from Bo');
    const backdrop = sheet().element().parentElement;
    backdrop?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect.element(sheet()).not.toBeInTheDocument();
  });

  it('pins, copies (or says why it couldn’t) and replies in the thread from the sheet', async () => {
    await longPress('hello from Bo');
    await page.getByTestId('sheet-pin').click();
    await until(() => !!state()?.pins.get('general')?.size, 10_000, 'the pin');
    await longPress('hello from Bo');
    await page.getByTestId('sheet-copy').click();
    await expect.element(page.getByText('Couldn’t copy message')).toBeVisible(); // no clipboard permission here
    await longPress('hello from Bo');
    await page.getByTestId('sheet-reply').click();
    await until(() => !!useApp.getState().route.thread, 10_000, 'the thread');
    useApp.getState().go({ code, ch: 'general' });
  });

  it('edits and deletes my own messages while I still may, and says when I can’t', async () => {
    await page.getByRole('textbox', { name: 'Message #general' }).fill('mine to change');
    await page.getByTestId('composer-send').click();
    await longPress('mine to change');
    await page.getByTestId('sheet-edit').click();
    await expect.element(page.getByRole('textbox', { name: 'Edit message' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await longPress('mine to change');
    await page.getByTestId('sheet-delete').click();
    await expect.element(page.getByText('Message deleted').first()).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).last().click(); // the undo toast would cover the next sheet
    // Written earlier on another of my devices, past the edit window (in a channel that already existed then).
    const p = getPeer(code);
    p?.publish({ t: 'ch.create', b: { id: 'archive', name: 'archive' }, ts: Date.now() - EDIT_WINDOW_MS - 120_000 });
    p?.publish({ t: 'msg', ch: 'archive', b: { text: 'from long ago' }, ts: Date.now() - EDIT_WINDOW_MS - 60_000 });
    useApp.getState().go({ code, ch: 'archive' });
    await longPress('from long ago');
    await page.getByTestId('sheet-locked').click();
    await expect.element(page.getByText('This message can’t be changed anymore')).toBeVisible();
    useApp.getState().go({ code, ch: 'general' });
  });

  it('swipes a message right to reply in its thread; a mouse drag or a scroll doesn’t', async () => {
    const m = await shown('hello from Bo');
    const r = m.getBoundingClientRect();
    const y = r.top + 10;
    await swipe(m, [r.left + 60, y], [r.left + 200, y], 160, 'mouse');
    await swipe(m, [r.left + 60, y], [r.left + 70, y + 120]); // mostly vertical: a scroll
    m.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch', bubbles: true })); // the browser took it over
    expect(useApp.getState().route.thread).toBeUndefined();
    await swipe(m, [r.left + 60, y], [r.left + 200, y]);
    await until(() => !!useApp.getState().route.thread, 10_000, 'the thread');
  });

  it('swipes the thread panel away, back to the channel', async () => {
    await page.viewport(390, 760); // a phone: the panel covers the screen
    const panel = page.getByRole('complementary', { name: 'Thread' });
    await expect.element(panel).toBeVisible();
    await until(() => getComputedStyle(panel.element()).position === 'fixed', 10_000, 'the full-screen panel');
    // Inside a thread, a message swipe isn't a reply: it's the panel's swipe.
    const reply = panel.getByRole('article').first().element();
    const r = reply.getBoundingClientRect();
    await swipe(reply, [r.left + 40, r.top + 10], [r.left + 220, r.top + 10]);
    await expect.element(panel).not.toBeInTheDocument();
    await until(() => !useApp.getState().route.thread, 10_000, 'back in the channel');
  });

  it('pulls the sidebar out from the left edge, and pushes it back', async () => {
    const main = page.getByTestId('main').element();
    await swipe(main, [120, 400], [330, 400]); // not from the edge: nothing
    expect(useApp.getState().drawer).toBe(false);
    await swipe(main, [10, 400], [260, 400]);
    await until(() => useApp.getState().drawer, 10_000, 'the drawer');
    await swipe(page.getByTestId('drawer').element(), [300, 400], [60, 400]);
    await until(() => !useApp.getState().drawer, 10_000, 'the drawer closed');
  });

  it('keeps the page’s own long-press menu away once the sheet opened, and only then', async () => {
    const m = await shown('hello from Bo');
    const menu = () => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      m.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(menu()).toBe(false);
    await hold(m);
    expect(menu()).toBe(true);
    await userEvent.keyboard('{Escape}');
    await expectText(page.getByRole('main'), /hello from Bo/);
  });
});

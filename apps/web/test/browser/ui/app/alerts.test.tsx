import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { dmChannel } from '@yurt/protocol';
import { createWorkspace, expectText, me, member, startApp, until, useApp } from '../app';

// Signals inside the app for messages that alert me in conversations I'm not looking at: a toast that opens the
// conversation, and the narrow screen's menu button counting what waits elsewhere.
let code = '';
let bo: Awaited<ReturnType<typeof member>>;
const go = (ch: string) => useApp.getState().go({ code, ch });
const toasts = () => page.getByTestId('message-toast');
const dm = () => dmChannel(me().pub, bo.who.pub);
const notes = () => dmChannel(me().pub, me().pub); // somewhere else to be

describe('new message alerts', () => {
  it('toast a DM or mention elsewhere, one toast per conversation, and open it', async () => {
    await startApp({ as: 'Ada' });
    code = await createWorkspace('Alerts');
    bo = await member(code, 'Bo');
    await useApp.getState().updateSettings({ sound: false }); // the chime has its own test (core/device.test.ts)
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'just chatting' } }); // on screen and not for me: nothing
    await bo.say({ t: 'msg', ch: dm(), to: me().pub, b: { text: 'first' } });
    await bo.say({ t: 'msg', ch: dm(), to: me().pub, b: { text: 'second' } });
    const toast = toasts().first().getByRole('status');
    await expect.element(toast).toBeVisible();
    await expectText(toast, /^Bosecond/);
    expect(toasts().elements()).toHaveLength(1); // the newer message replaced the older one's toast
    go(notes());
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'hey @ada' } });
    await until(() => toasts().elements().length === 2);
    await expectText(toasts().nth(1), /Bo in #general/);
    await toast.getByRole('button', { name: 'Open' }).click();
    await until(() => useApp.getState().route.ch === dm());
    await until(() => toasts().elements().length === 1); // acted on
    go('general'); // reading a conversation clears its toast
    await until(() => !toasts().query());
  });

  it('stay quiet in Focus mode', async () => {
    useApp.setState({ focus: true });
    go(notes());
    await bo.say({ t: 'msg', ch: dm(), to: me().pub, b: { text: 'while focusing' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(toasts().query()).toBeNull();
    useApp.setState({ focus: false });
  });

  it('count what waits elsewhere on the narrow screen’s menu button', async () => {
    await page.viewport(400, 800);
    go(notes());
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'chatter' } });
    const button = page.getByTestId('menu-button');
    // The DM sent while focusing is unread and alerts: counted; the chatter isn't.
    await expect.element(button).toHaveAccessibleName('Open sidebar, 1 unread');
    await expect.element(page.getByTestId('menu-unread')).toHaveTextContent('1');
    go(dm()); // the conversation on screen doesn't count; #general's chatter shows as a dot
    await expect.element(button).toHaveAccessibleName('Open sidebar, new messages');
    await expect.element(page.getByTestId('menu-unread')).toHaveTextContent('');
    go('general');
    await expect.element(button).toHaveAccessibleName('Open sidebar');
    expect(page.getByTestId('menu-unread').query()).toBeNull();
    await page.viewport(1280, 860);
  });
});

import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { agentDmChannel, dmChannel, EDIT_WINDOW_MS } from '@yurt/protocol';
import { createWorkspace, expectText, getPeer, me, member, startApp, until, useApp } from '../app';

let code = '';
let bo: Awaited<ReturnType<typeof member>>;
const main = () => page.getByRole('main');
const panel = (name: string) => page.getByRole('complementary', { name });
const msgs = () => [...(useApp.getState().states[code]?.msgs.values() ?? [])];

describe('message details', () => {
  it('starts from the empty channel’s own buttons', async () => {
    await startApp({ as: 'Ada' });
    code = await createWorkspace('Northwind');
    await main().getByRole('button', { name: 'Invite people' }).last().click(); // the intro's, not the header's
    await expect.element(page.getByRole('dialog', { name: 'Invite to Northwind' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await main().getByRole('button', { name: 'Add agent' }).first().click(); // the header's
    await expect.element(page.getByTestId('settings-section-ws-agents')).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });

  it('links a thread reply shown in the channel back to a file-only parent', async () => {
    bo = await member(code, 'Bo');
    const root = await bo.say({ t: 'msg', ch: 'general', b: { files: [{ id: 'a'.repeat(64), name: 'report.pdf', size: 10, type: 'application/pdf' }] } });
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'see the report', parent: root.id, alsoInChannel: true } });
    await expectText(page.getByTestId('also-in-channel'), /replied in a thread: view thread/);
    // Search finds the file-only message by its file name, and shows the name in place of text.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search this workspace' }).fill('report.pdf');
    await expectText(panel('Search'), /report\.pdf/);
    useApp.getState().setPanel({ type: null });
  });

  it('shows deleted thread roots with their reply count, and deletes from inside a thread', async () => {
    await page.getByRole('textbox', { name: 'Message #general' }).fill('my root');
    await userEvent.keyboard('{Enter}');
    await until(() => msgs().some((m) => m.text === 'my root'));
    const root = msgs().find((m) => m.text === 'my root');
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'reply one', parent: root?.id } });
    useApp.getState().go({ code, ch: 'general', thread: root?.id });
    const t = panel('Thread');
    await t.getByRole('textbox', { name: 'Reply in thread' }).fill('my reply');
    await userEvent.keyboard('{Enter}');
    await expect.element(t.getByText('my reply')).toBeVisible();
    const mine = t.getByRole('article').filter({ hasText: 'my reply' });
    mine.element().scrollIntoView({ block: 'center' });
    await mine.hover();
    await mine.getByTestId('msg-delete').click();
    await expect.element(t.getByText('my reply')).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Dismiss' }).last().click();
    // The root itself, deleted: a placeholder keeps the count.
    const rootMsg = t.getByRole('article').filter({ hasText: 'my root' });
    await rootMsg.hover();
    await rootMsg.getByTestId('msg-delete').click();
    await page.getByRole('button', { name: 'Dismiss' }).last().click();
    await until(() => !!msgs().find((m) => m.id === root?.id)?.deleted); // deleting clears the text, so by id
    await expect.element(main().getByText('Message deleted · 2 replies').first()).toBeVisible(); // in the channel and atop the thread
    await t.getByRole('button', { name: 'Close (Esc)' }).click();
  });

  it('explains the closed edit window inside a thread without offering another thread', async () => {
    const p = getPeer(code);
    p?.publish({ t: 'ch.create', b: { id: 'old', name: 'old' }, ts: Date.now() - EDIT_WINDOW_MS - 120_000 });
    const old = p?.publish({ t: 'msg', ch: 'old', b: { text: 'old root' }, ts: Date.now() - EDIT_WINDOW_MS - 60_000 });
    useApp.getState().go({ code, ch: 'old', thread: old?.id });
    const t = panel('Thread');
    const m = t.getByRole('article').filter({ hasText: 'old root' });
    await m.hover();
    await m.getByTestId('msg-edit-locked').click();
    await expect.element(page.getByText('This message can’t be changed anymore')).toBeVisible();
    // Inside a thread the toast has no "Reply in thread" action.
    await expect
      .element(page.getByRole('status').filter({ hasText: 'This message can’t be changed anymore' }).getByRole('button', { name: 'Reply in thread' }))
      .not.toBeInTheDocument();
    await t.getByRole('button', { name: 'Close (Esc)' }).click();
  });

  it('shows a DM in search results under its title, and treats an unknown approval answer as declined', async () => {
    await bo.say({ t: 'msg', ch: dmChannel(me().pub, bo.who.pub), to: me().pub, b: { text: 'secret plan' } });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search this workspace' }).fill('secret');
    await expectText(panel('Search'), /Bo · .*secret plan/);
    useApp.getState().setPanel({ type: null });
    const adm = agentDmChannel(me().pub, 'mine');
    const bridge = await member(code, 'bridge', me(), { profile: false });
    bridge.publish({ t: 'agent', b: { id: 'mine', name: 'Mine', handle: 'mine', runtime: 'copilot', replyIn: 'thread' } });
    await bridge.say({
      t: 'msg',
      ch: adm,
      to: me().pub,
      ag: 'mine',
      b: { text: 'ok?', approval: { req: 'rq', title: 'Write file', kind: 'edit', options: [{ id: 'y', name: 'Allow', kind: 'allow_once' }] } },
    });
    useApp.getState().go({ code, ch: adm });
    getPeer(code)?.publish({ t: 'approve', ch: adm, to: me().pub, b: { req: 'rq', option: 'not-offered' } });
    await expect.element(page.getByText('Declined · Write file')).toBeVisible();
  });

  it('opens a search result whose delete can still be undone without jumping anywhere', async () => {
    useApp.getState().go({ code, ch: 'general' });
    await page.getByRole('textbox', { name: 'Message #general' }).fill('regrettable words');
    await userEvent.keyboard('{Enter}');
    const m = page.getByRole('article').filter({ hasText: 'regrettable words' });
    await m.hover();
    await m.getByTestId('msg-delete').click(); // hidden now, deleted for real only when its toast goes
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search this workspace' }).fill('regrettable');
    await panel('Search').getByRole('button').filter({ hasText: 'regrettable words' }).click();
    await until(() => !!useApp.getState().highlight);
    await page.getByRole('button', { name: /Undo/ }).click();
    useApp.getState().setPanel({ type: null });
  });

  it('forgets files dropped on one conversation when another opens', async () => {
    useApp.getState().go({ code, ch: 'general' });
    const section = page.getByRole('region', { name: '#general' });
    await expect.element(section).toBeVisible();
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'for-general.txt', { type: 'text/plain' }));
    section.element().dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await expect.element(page.getByRole('button', { name: 'Remove for-general.txt' })).toBeVisible();
    useApp.getState().go({ code, ch: 'old' });
    await expect.element(page.getByRole('textbox', { name: 'Message #old' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Remove for-general.txt' })).not.toBeInTheDocument();
  });

  it('opens the sidebar from the home screen on a narrow screen, and jumps to a channel', async () => {
    useApp.getState().setDialog('jump');
    await page.getByRole('textbox', { name: 'Jump to' }).fill('general');
    await userEvent.keyboard('{Enter}');
    await until(() => useApp.getState().route.ch === 'general');
    useApp.getState().go({});
    await page.viewport(400, 800);
    await main().getByRole('button', { name: 'Open sidebar' }).click();
    await expect.element(page.getByRole('navigation', { name: 'Workspaces' })).toBeVisible();
    await page.viewport(1280, 860);
  });

  it('says when nobody else is around, and explains its invite', async () => {
    const solo = await useApp.getState().createWorkspace('Solo', { relays: ['ws://127.0.0.1:9'], blossom: [] });
    await until(() => useApp.getState().route.code === solo);
    await page.getByTestId('ws-menu-button').click();
    await expectText(page.getByTestId('ws-online'), /No other members online/);
    await page.getByTestId('menu-settings').click();
    await page.getByTestId('invite-create').click();
    await expect.element(page.getByText(/the link alone doesn’t open the workspace/)).toBeVisible();
    await expect.element(page.getByText(/history then comes back from the relays/)).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });
});

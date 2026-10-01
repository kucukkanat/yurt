import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { agentDmChannel, dmChannel, guestDmChannel } from '@yurt/protocol';
import { createWorkspace, expectText, getPeer, me, member, startApp, until, useApp } from '../app';

let code = '';
let bo: Awaited<ReturnType<typeof member>>;
let bridge: Awaited<ReturnType<typeof member>>;
const state = () => useApp.getState().states[code];
const go = (ch: string) => useApp.getState().go({ code, ch });
const agentBody = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, handle: id, runtime: 'copilot', replyIn: 'thread', ...extra });
const subtitle = (re: RegExp) => expectText(page.getByRole('main'), re);

describe('private conversations', () => {
  it('DMs another member, with presence in the header', async () => {
    await startApp({ as: 'Ada' });
    code = await createWorkspace('Northwind');
    bo = await member(code, 'Bo');
    go(dmChannel(me().pub, bo.who.pub));
    await expect.element(page.getByText('You and Bo')).toBeVisible();
    await expect.element(page.getByText(/Only the two of you can read this conversation/)).toBeVisible();
    await subtitle(/Online/);
    await expect.element(page.getByText('Private between you two')).toBeVisible();
    await page.getByRole('textbox', { name: 'Message Bo' }).fill('psst');
    await userEvent.keyboard('{Enter}');
    await until(() => [...bo.state.msgs.values()].some((m) => m.text === 'psst'));
    // Bo reacts back and edits; the DM shows in the sidebar.
    const mine = [...bo.state.msgs.values()].find((m) => m.text === 'psst');
    await bo.say({ t: 'msg', ch: dmChannel(me().pub, bo.who.pub), to: me().pub, b: { text: 'hey back' } });
    bo.publish({ t: 'react', ch: dmChannel(me().pub, bo.who.pub), to: me().pub, b: { target: mine?.id, icon: 'heart', on: true } });
    await expect.element(page.getByRole('button', { name: 'heart 1' })).toBeVisible();
    await expect.element(page.getByRole('navigation', { name: 'Channels and messages' }).getByRole('button', { name: 'Bo' })).toBeVisible();
    // Away, then gone.
    bo.setPresence({ st: 'away' });
    await subtitle(/Away/);
  });

  it('keeps notes to yourself', async () => {
    go(dmChannel(me().pub, me().pub));
    await expect.element(page.getByText('Notes to yourself')).toBeVisible();
    await expect.element(page.getByText('Drafts, links, reminders. Only you see these.')).toBeVisible();
    await page.getByRole('textbox', { name: /^Message Ada/ }).fill('remember milk');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('navigation', { name: 'Channels and messages' }).getByRole('button', { name: 'Ada (you)' })).toBeVisible();
  });

  it('chats privately with my own agent, which asks before using tools', async () => {
    const adm = agentDmChannel(me().pub, 'mine');
    go(adm);
    await expect.element(page.getByText('You and mine')).toBeVisible(); // not announced yet: its id stands in
    bridge = await member(code, 'bridge', me(), { profile: false });
    bridge.publish({ t: 'agent', b: agentBody('mine', 'Mine') });
    await until(() => !!state()?.agents.size);
    await expect.element(page.getByText('mine is off. Start yurt-bridge to get replies.')).not.toBeInTheDocument();
    await expect.element(page.getByText('Mine is off. Start yurt-bridge to get replies.')).toBeVisible();
    await expect.element(page.getByText(/runs copilot on your machine through yurt-bridge/)).toBeVisible();
    bridge.setPresence({ st: 'online', bridge: true, agents: { mine: { working: adm } } });
    await expect.element(page.getByText('Only you and Mine see this')).toBeVisible();
    await subtitle(/Private · copilot on your machine/);
    await page.getByRole('textbox', { name: 'Message Mine privately' }).fill('do the thing');
    await userEvent.keyboard('{Enter}');
    // The agent (my bridge, signing as me with the agent's id) asks for approval.
    const ask = (req: string, kind: string) =>
      bridge.say({
        t: 'msg',
        ch: adm,
        to: me().pub,
        ag: 'mine',
        b: {
          text: 'I need your OK to ' + req + '.',
          approval: {
            req,
            title: 'Run ' + req,
            kind,
            options: [
              { id: 'y', name: 'Allow once', kind: 'allow_once' },
              { id: 'a', name: 'Always', kind: 'allow_always' },
              { id: 'n', name: 'Reject', kind: 'reject_once' },
            ],
          },
        },
      });
    await ask('r1', 'execute');
    await expect.element(page.getByText('Only you see this · Mine is yours')).toBeVisible();
    await expect.element(page.getByText('Can’t be undone')).toBeVisible();
    await page.getByRole('button', { name: /Allow once/ }).click();
    await expect.element(page.getByText('Approved · Run r1')).toBeVisible();
    await ask('r2', 'edit');
    await page.getByRole('button', { name: /Not now/ }).click();
    await expect.element(page.getByText('Declined · Run r2')).toBeVisible();
    await bridge.say({
      t: 'msg',
      ch: adm,
      to: me().pub,
      ag: 'mine',
      b: { text: 'no kind', approval: { req: 'r3', title: 'Read', options: [{ id: 'a', name: 'Always', kind: 'allow_always' }] } },
    });
    await page
      .getByRole('button', { name: /Allow once/ })
      .last()
      .click(); // no allow_once: the first "allow" option
    await expect.element(page.getByText('Approved · Read')).toBeVisible();
    await bridge.say({
      t: 'msg',
      ch: adm,
      to: me().pub,
      ag: 'mine',
      b: { text: 'odd answer', approval: { req: 'r4', title: 'Fetch', kind: 'fetch', options: [{ id: 'q', name: 'Ask', kind: 'other' }] } },
    });
    await expect.element(page.getByText('Low risk')).toBeVisible();
    await page
      .getByRole('button', { name: /Allow once/ })
      .last()
      .click(); // nothing to allow with: no answer
    await page
      .getByRole('button', { name: /Not now/ })
      .last()
      .click(); // nothing to reject with either
    getPeer(code)?.publish({ t: 'approve', ch: adm, to: me().pub, b: { req: 'r4', option: 'q' } });
    await expect.element(page.getByText('Declined · Fetch')).toBeVisible(); // an answer that isn't "allow"
  });

  it('shows a guest DM to a member, with a visibility notice', async () => {
    // Bo's discoverable agent; Bo's bridge keeps it online.
    const boBridge = await member(code, 'bo-bridge', bo.who, { profile: false });
    boBridge.publish({ t: 'agent', b: agentBody('harvey', 'Harvey', { discoverable: true }) });
    await until(() => state()?.agents.size === 2);
    const gdm = guestDmChannel(me().pub, bo.who.pub, 'harvey');
    go(gdm);
    await expect.element(page.getByTestId('guest-dm-notice')).toHaveTextContent('Conversations with Harvey are visible to Bo, who runs it.');
    await expect.element(page.getByText('Harvey answers when Bo’s machine is on')).toBeVisible();
    await expect.element(page.getByText('You and Harvey')).toBeVisible();
    await expect.element(page.getByTestId('guest-dm-subtitle')).toHaveTextContent('Bo’s agent');
    boBridge.setPresence({ st: 'online', bridge: true, agents: { harvey: { working: null } } });
    await expect.element(page.getByText('Only you and Bo, who runs Harvey, see this')).toBeVisible();
    await page.getByRole('textbox', { name: 'Message Harvey' }).fill('hi harvey');
    await userEvent.keyboard('{Enter}');
    await until(() => [...bo.state.msgs.values()].some((m) => m.text === 'hi harvey'));
    await expect.element(page.getByRole('navigation', { name: 'Channels and messages' }).getByRole('button', { name: 'Harvey (Bo’s agent)' })).toBeVisible();
  });

  it('shows the owner a member’s chat with their agent, read-only', async () => {
    const gdm = guestDmChannel(bo.who.pub, me().pub, 'mine');
    await bo.say({ t: 'msg', ch: gdm, to: me().pub, b: { text: 'hello your agent' } });
    await expect.element(page.getByTestId('guest-chat-row')).toHaveTextContent('Bo');
    await page.getByTestId('guest-chat-row').click();
    await expect.element(page.getByTestId('guest-dm-notice')).toHaveTextContent('Bo is talking to your agent Mine. Only the two of you see this.');
    await expect.element(page.getByTestId('guest-dm-subtitle')).toHaveTextContent('Your agent · Bo started this chat');
    await expect.element(page.getByTestId('guest-dm-readonly')).toBeVisible();
    await expect.element(page.getByRole('heading', { name: /Bo ↔ Mine/ })).toBeVisible();
    // A fresh guest chat (no messages yet) shows the owner's intro.
    go(guestDmChannel(bo.who.pub, me().pub, 'other'));
    await expect.element(page.getByText(/is your agent\. It runs an agent CLI on your machine/)).toBeVisible();
  });
});

import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createWorkspace, expectText, me, member, startApp, until, useApp } from '../app';

let code = '';
let bo: Awaited<ReturnType<typeof member>>;
let cy: Awaited<ReturnType<typeof member>>;
let bridge: Awaited<ReturnType<typeof member>>;
const state = () => useApp.getState().states[code];
const panel = (name: string) => page.getByRole('complementary', { name });
const members = () => page.getByRole('button', { name: /^Members: / });
const agentBody = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, handle: id, runtime: 'copilot', replyIn: 'thread', ...extra });

describe('side panels', () => {
  it('lists people and agents in the members panel', async () => {
    await startApp({ as: 'Ada' });
    code = await createWorkspace('Northwind');
    bo = await member(code, 'Bo');
    cy = await member(code, 'Cy');
    // My own agent, announced and kept online by my bridge (another peer signing as me).
    bridge = await member(code, 'bridge', me(), { profile: false });
    bridge.publish({ t: 'agent', b: agentBody('mine', 'Mine') });
    bridge.setPresence({ st: 'online', bridge: true, agents: { mine: { working: 'general' } } });
    bo.publish({ t: 'agent', b: agentBody('scout', 'Scout') });
    cy.publish({ t: 'agent', b: agentBody('harvey', 'Harvey', { discoverable: true, respondTo: { mentions: true, replies: true }, postIn: { thread: true, channel: true } }) });
    await until(() => state()?.agents.size === 3);
    await members().click();
    const p = panel('Members');
    await expect.element(p).toBeVisible();
    await expectText(p, /People · 3/);
    await expectText(p, /Agents · 3/);
    await expect.element(p.getByText('Creator')).toBeVisible();
    await expect.element(p.getByText('Yours · working')).toBeVisible();
    await expect.element(p.getByText('Bo’s · machine off')).toBeVisible();
    await p.getByRole('button', { name: 'Invite people' }).click();
    await expect.element(page.getByTestId('invite-link')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await members().click(); // toggles the panel closed
    await expect.element(p).not.toBeInTheDocument();
  });

  it('shows profiles and what you can do from them', async () => {
    await members().click();
    // A person: message them; me: notes to self.
    await panel('Members').getByRole('button', { name: /Bo/ }).first().click();
    await expectText(panel('Profile'), /@bo · Online/);
    await panel('Profile').getByRole('button', { name: 'Message' }).click();
    await until(() => useApp.getState().route.ch?.startsWith('dm:') === true);
    useApp.getState().go({ code, ch: 'general' });
    useApp.getState().setPanel({ type: 'profile', id: me().pub });
    await expect.element(panel('Profile').getByRole('button', { name: 'Notes to self' })).toBeVisible();
    await expect.element(panel('Profile').getByText('Creator')).toBeVisible();
    // My agent: message it privately.
    useApp.getState().setPanel({ type: 'profile', id: me().pub + '/mine' });
    await expectText(panel('Profile'), /Owner\s*You/);
    await expectText(panel('Profile'), /Runs on\s*Your machine/);
    await panel('Profile').getByRole('button', { name: 'Message privately' }).click();
    await until(() => useApp.getState().route.ch === 'adm:' + me().pub + ':mine');
    useApp.getState().go({ code, ch: 'general' });
    // Someone else's agents: discoverable or not.
    useApp.getState().setPanel({ type: 'profile', id: bo.who.pub + '/scout' });
    await expect.element(page.getByTestId('agent-not-discoverable')).toBeVisible();
    await expectText(page.getByTestId('agent-prefs'), /answers @mentions · posts in thread/);
    useApp.getState().setPanel({ type: 'profile', id: cy.who.pub + '/harvey' });
    await expectText(page.getByTestId('agent-prefs'), /discoverable/);
    await page.getByTestId('agent-message').click();
    await until(() => useApp.getState().route.ch?.startsWith('gdm:') === true);
    useApp.getState().go({ code, ch: 'general' });
    // An agent the workspace hasn't heard of: its id stands in for a name, with no runtime or settings.
    useApp.getState().setPanel({ type: 'profile', id: bo.who.pub + '/ghost' });
    await expectText(panel('Profile'), /Runtime\s*—/);
  });

  it('lets the creator make admins, remove them, and ban (with a key rotation) or unban', async () => {
    // Dee gets banned: the rotation leaves Dee out of the new key for good, so the others stay unaffected.
    const dee = await member(code, 'Dee');
    useApp.getState().setPanel({ type: 'profile', id: dee.who.pub });
    const p = panel('Profile');
    await p.getByRole('button', { name: 'Make admin' }).click();
    await expect.element(p.getByText('Admin', { exact: true })).toBeVisible();
    await p.getByRole('button', { name: 'Remove admin' }).click();
    await expect.element(p.getByRole('button', { name: 'Make admin' })).toBeVisible();
    await page.getByTestId('ban-button').click();
    await expect.element(page.getByTestId('ban-warning')).toBeVisible();
    const key = useApp.getState().workspaces.find((w) => w.code === code)?.transport.key;
    await page.getByTestId('ban-confirm').click();
    await expect.element(page.getByText('Dee was removed')).toBeVisible();
    await expect.element(p.getByText('Banned')).toBeVisible();
    await until(() => useApp.getState().workspaces.find((w) => w.code === code)?.transport.key !== key);
    await p.getByRole('button', { name: 'Unban' }).click();
    await expect.element(page.getByTestId('ban-button')).toBeVisible();
    // Profiles of the creator don't offer moderation.
    useApp.getState().setPanel({ type: 'profile', id: me().pub });
    await expect.element(page.getByText('Moderation')).not.toBeInTheDocument();
  });

  it('opens threads, shows replies and who is typing, and replies there', async () => {
    useApp.getState().setPanel({ type: null });
    const root = await bo.say({ t: 'msg', ch: 'general', b: { text: 'thread root' } });
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'first reply', parent: root.id } });
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'second reply', parent: root.id } });
    await cy.say({ t: 'msg', ch: 'general', b: { text: 'also in channel', parent: root.id, alsoInChannel: true } });
    await page.getByRole('button', { name: /3 replies/ }).click();
    const t = panel('Thread');
    await expect.element(t.getByText('3 replies')).toBeVisible();
    await expect.element(t.getByText('second reply')).toBeVisible();
    bo.setPresence({ typing: 'general' });
    cy.setPresence({ typing: 'general' });
    // My agent is still working in #general, so it's writing here too.
    await expectText(t, /Bo, Cy, Mine are typing…|Cy, Bo, Mine are typing…/);
    cy.setPresence({ typing: null });
    bridge.setPresence({ agents: { mine: { working: null } } });
    await expectText(t, /Bo is typing…/);
    bo.setPresence({ typing: null });
    await t.getByRole('textbox', { name: 'Reply in thread' }).fill('my reply');
    await userEvent.keyboard('{Enter}');
    await expect.element(t.getByText('my reply')).toBeVisible();
    // The channel shows the also-in-channel reply with a link back to the thread.
    await page.getByTestId('also-in-channel').click();
    await expect.element(t).toBeVisible();
    // A one-reply thread, and Escape closes the panel (leaving the thread route).
    const solo = await bo.say({ t: 'msg', ch: 'general', b: { text: 'solo root' } });
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'only reply', parent: solo.id } });
    useApp.getState().go({ code, ch: 'general', thread: solo.id });
    await expect.element(t.getByText('1 reply')).toBeVisible();
    await t.getByRole('button', { name: 'Close (Esc)' }).click();
    await expect.element(t).not.toBeInTheDocument();
    // A thread this device doesn't have yet.
    useApp.getState().go({ code, ch: 'general', thread: 'f'.repeat(64) });
    await expect.element(t.getByText('This thread shows up once it arrives from the workspace’s relays.')).toBeVisible();
    useApp.getState().go({ code, ch: 'general' });
  });

  it('lists pinned messages and jumps to them', async () => {
    await page.getByRole('button', { name: /^Pinned, / }).click();
    await expect.element(panel('Pinned').getByText('Hover a message and pin it to keep it here.')).toBeVisible();
    const root = [...(state()?.msgs.values() ?? [])].find((m) => m.text === 'thread root');
    const reply = [...(state()?.msgs.values() ?? [])].find((m) => m.text === 'first reply');
    useApp.getState().publish(code, { t: 'pin', b: { target: root?.id, on: true } });
    useApp.getState().publish(code, { t: 'pin', b: { target: reply?.id, on: true } });
    const rows = panel('Pinned')
      .getByRole('button')
      .filter({ hasText: /reply|root/ });
    await expect.poll(() => rows.elements().length).toBe(2);
    await panel('Pinned').getByRole('button').filter({ hasText: 'thread root' }).click();
    await until(() => useApp.getState().highlight === root?.id); // the panel stays open
    await panel('Pinned').getByRole('button').filter({ hasText: 'first reply' }).click(); // a reply opens its thread
    await expect.element(panel('Thread')).toBeVisible();
    useApp.getState().go({ code, ch: 'general' });
  });

  it('searches this workspace’s history', async () => {
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const box = page.getByRole('textbox', { name: 'Search this workspace' });
    await box.fill('r');
    await expect.element(panel('Search').getByText(/Nothing on this device/)).not.toBeInTheDocument(); // too short to search
    await box.fill('zzzz');
    await expect.element(panel('Search').getByText('Nothing on this device matches “zzzz”. Search covers history synced here.')).toBeVisible();
    await box.fill('reply');
    await expect.poll(() => panel('Search').getByRole('button').filter({ hasText: /reply/ }).elements().length).toBeGreaterThan(2);
    await panel('Search').getByRole('button').filter({ hasText: 'only reply' }).hover();
    await panel('Search').getByRole('button').filter({ hasText: 'only reply' }).click();
    await expect.element(panel('Thread')).toBeVisible();
  });
});

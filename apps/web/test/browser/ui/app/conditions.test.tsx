import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { dmChannel, inviteHash, keyFromPhrase, newInviteCode, newNostrTransport, newRecoveryPhrase, newTrysteroTransport } from '@yurt/protocol';
import { createWorkspace, me, member, startApp, until, useApp } from '../app';

let code = '';
let bo: Awaited<ReturnType<typeof member>>;
const main = () => page.getByRole('main');
const note = (text: string) => expect.element(main().getByText(text, { exact: true })).toBeVisible();
const go = (ch?: string, c = code) => useApp.getState().go(ch ? { code: c, ch } : { code: c });
const DEAD = 'ws://127.0.0.1:9'; // a closed local port: nothing ever answers

describe('conditions a conversation can be in', () => {
  it('says what happens offline, and when relays are unreachable', async () => {
    await startApp({ as: 'Ada' });
    code = await createWorkspace('Northwind');
    bo = await member(code, 'Bo');
    await note('Type @ to mention a person or agent');
    window.dispatchEvent(new Event('offline'));
    await note('Offline · sends when a relay is reachable');
    await expect.element(main().getByText('You’re offline')).toBeVisible();
    window.dispatchEvent(new Event('online'));
    await note('Type @ to mention a person or agent');
    // A relay workspace whose relays can't be reached: queued sends, reconnecting.
    const dead = await useApp.getState().createWorkspace('Unreachable', { kind: 'nostr', relays: [DEAD], blossom: [] });
    await note('Relays unreachable · sends when one is back');
    await expect.element(main().getByText(/^Reconnecting/)).toBeVisible();
    await page.getByRole('textbox', { name: 'Message #general' }).fill('stuck in the queue');
    await userEvent.keyboard('{Enter}');
    await expect.element(main().getByText('Sends when you reconnect')).toBeVisible();
    go('nowhere', dead);
    await expect.element(main().getByText('It shows up once it arrives from the workspace’s relays.')).toBeVisible();
    go('general');
  });

  it('describes peer-to-peer workspaces, where members must be online together', async () => {
    const p2p = await useApp.getState().createWorkspace('Live', { kind: 'trystero', signal: { kind: 'nostr', urls: [DEAD] } });
    await until(() => useApp.getState().route.code === p2p);
    await note('No one else is online · sends when someone joins');
    window.dispatchEvent(new Event('offline'));
    await note('Offline · sends when a member is reachable');
    window.dispatchEvent(new Event('online'));
    go('nowhere', p2p);
    await expect.element(main().getByText('It shows up once a member who has it comes online.')).toBeVisible();
    // A DM with someone this device has never heard from: offline, synced directly.
    const stranger = keyFromPhrase(newRecoveryPhrase()).pub;
    go(dmChannel(me().pub, stranger), p2p);
    await expect.element(main().getByText('Offline · messages sync when they’re back')).toBeVisible();
    await expect.element(main().getByText(/It syncs directly between your devices\./)).toBeVisible();
    useApp.getState().go({ code: p2p, ch: 'general', thread: 'f'.repeat(64) });
    await expect.element(page.getByText('This thread syncs once a member who has it is online.')).toBeVisible();
    go('general');
  });

  it('shows joined workspaces that have no channels yet, in each mode', async () => {
    await useApp.getState().joinWorkspace(inviteHash({ code: newInviteCode(), transport: newTrysteroTransport({ kind: 'nostr', urls: [DEAD] }) }));
    await expect.element(page.getByText('Syncs when a member is online')).toBeVisible();
    await useApp.getState().joinWorkspace(inviteHash({ code: newInviteCode(), transport: newNostrTransport([DEAD]) }));
    await expect.element(page.getByText('Syncing from relays…')).toBeVisible();
    go('general');
  });

  it('handles links to workspaces it can’t join, and odd conversation routes', async () => {
    const unknown = newInviteCode();
    // A conversation route in a workspace this device doesn't have: nothing to draw, then home (in-app navigation
    // gets no toast; that's for links opened from outside).
    go('general', unknown);
    await until(() => !useApp.getState().route.code);
    go(undefined, unknown);
    await until(() => !useApp.getState().route.code);
    // A malformed private-agent route renders without crashing.
    go('adm:' + me().pub);
    await expect.element(main().getByText(/^You and /)).toBeVisible();
    go('general');
  });

  it('takes files dropped on the conversation, and only file drags', async () => {
    const section = page.getByRole('region', { name: '#general' });
    await expect.element(section).toBeVisible();
    const files = new DataTransfer();
    files.items.add(new File(['dropped'], 'dropped.txt', { type: 'text/plain' }));
    const text = new DataTransfer();
    text.setData('text/plain', 'just text');
    const fire = (type: string, dt: DataTransfer, target: Element = section.element()) =>
      target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    fire('dragover', text);
    await expect.element(page.getByText('Drop to share · up to 25 MB each')).not.toBeInTheDocument();
    fire('dragover', files);
    await expect.element(page.getByText('Drop to share · up to 25 MB each')).toBeVisible();
    fire('dragleave', files, page.getByRole('log').element()); // leaving a child keeps the overlay
    await expect.element(page.getByText('Drop to share · up to 25 MB each')).toBeVisible();
    fire('dragleave', files);
    await expect.element(page.getByText('Drop to share · up to 25 MB each')).not.toBeInTheDocument();
    fire('drop', new DataTransfer()); // nothing in it
    fire('drop', files);
    await expect.element(page.getByRole('button', { name: 'Remove dropped.txt' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove dropped.txt' }).click();
  });

  it('follows new messages, offers a jump back when scrolled away, and marks what’s new', async () => {
    for (let i = 0; i < 30; i++) bo.publish({ t: 'msg', ch: 'general', b: { text: 'filler ' + i } });
    await until(() => [...(useApp.getState().states[code]?.msgs.values() ?? [])].some((m) => m.text === 'filler 29'));
    const log = page.getByRole('log').element();
    log.scrollTop = 0;
    log.dispatchEvent(new Event('scroll'));
    // Scrolled away, a new message doesn't yank the view down; the button offers the way back.
    await bo.say({ t: 'msg', ch: 'general', b: { text: 'arrived while reading history' } });
    expect(log.scrollTop).toBe(0);
    await page.getByRole('button', { name: 'Jump to latest' }).click();
    await expect.poll(() => log.scrollHeight - log.scrollTop - log.clientHeight).toBeLessThan(160);
    // Read up to now, leave, and come back to new messages: a "New" divider above the first one that isn't mine
    // (my agent's message counts as new; one from my other device doesn't).
    go('random');
    const myDevice = await member(code, 'device', me(), { profile: false });
    await myDevice.say({ t: 'msg', ch: 'general', b: { text: 'from my phone' } });
    myDevice.publish({ t: 'agent', b: { id: 'mine', name: 'Mine', handle: 'mine', runtime: 'copilot', replyIn: 'thread' } });
    await myDevice.say({ t: 'msg', ch: 'general', ag: 'mine', b: { text: 'my agent, while you were away' } });
    go('general');
    await expect.element(main().getByText('New', { exact: true })).toBeVisible();
    // Someone typing who hasn't published a profile yet.
    const shy = await member(code, 'shy', undefined, { profile: false });
    shy.setPresence({ st: 'online', typing: 'general' });
    await expect.element(main().getByText('Someone')).toBeVisible();
    shy.setPresence({ typing: null });
  });

  it('keeps Up-arrow and the @ picker sensible', async () => {
    useApp.getState().createChannel('quiet', '');
    await until(() => useApp.getState().route.ch === 'quiet');
    const box = page.getByRole('textbox', { name: 'Message #quiet' });
    await box.click();
    await userEvent.keyboard('{ArrowUp}'); // none of my messages here: nothing to edit
    await expect.element(page.getByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
    // Several matches: only the highlighted one shows the Enter hint.
    await member(code, 'Bob');
    await box.fill('@bo');
    await expect.poll(() => page.getByRole('option').elements().length).toBe(2);
    await box.fill('');
    go('general');
  });
});

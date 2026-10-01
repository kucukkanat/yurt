import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
// `pure`: no automatic cleanup between tests, since one App instance lives through the whole file.
import { cleanup, render } from 'vitest-browser-react/pure';
import { inviteHash, newInviteCode, newNostrTransport, newRecoveryPhrase } from '@yurt/protocol';
import { App } from '../../../src/App';
import { getPeer } from '../../../src/lib/net';
import { useApp } from '../../../src/store';
import { openRemote, resetDb, until } from './harness';

// The app shell: what it renders when, its keyboard shortcuts, the narrow drawer and toasts. The screens
// inside it have their own tests (test/browser/ui).
const app = () => useApp.getState();
let code = '';
let screen: Awaited<ReturnType<typeof render>>;

beforeAll(async () => {
  await resetDb();
  await page.viewport(1200, 800);
  screen = await render(<App />);
});

afterAll(async () => {
  await cleanup();
  for (const w of app().workspaces) getPeer(w.code)?.leave();
});

describe('the app shell', () => {
  it('renders nothing until saved data has loaded, then onboarding', async () => {
    expect(screen.container.textContent).toBe('');
    await app().init();
    await expect.element(page.getByLabelText('Display name').first()).toBeVisible();
  });

  it('shows the workspace once there is an identity, opening its first channel', async () => {
    await app().createIdentity(newRecoveryPhrase(), 'Ada', 'ada');
    code = await app().createWorkspace('Shell', { kind: 'nostr', relays: [inject('relayUrl')], blossom: [] });
    await until(() => app().route.ch === 'general', '#general');
    app().go({ code }); // a workspace route without a channel goes to #general
    await until(() => app().route.ch === 'general', '#general again');
  });

  it('opens a workspace without #general on its first channel', async () => {
    const other = newInviteCode();
    const transport = newNostrTransport([inject('relayUrl')]);
    const host = (await openRemote()).makePeer({ code: other, transport });
    await host.peer.start();
    host.peer.publish({ t: 'ws.create', b: { name: 'No general' } });
    host.peer.publish({ t: 'ch.create', b: { id: 'random', name: 'random' } });
    await app().joinWorkspace(inviteHash({ code: other, transport, creator: host.kp.pub }));
    await until(() => app().route.code === other && app().route.ch === 'random', 'its first channel');
    host.peer.leave();
    await app().leaveWorkspace(other);
    app().go({ code, ch: 'general' });
    await until(() => app().route.ch === 'general', 'back');
  });

  it('answers ⌘/Ctrl shortcuts, some only inside a workspace', async () => {
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(app().dialog).toBe('jump');
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(app().dialog).toBeNull();
    await userEvent.keyboard('{Meta>},{/Meta}');
    expect(app().dialog).toBe('settings');
    app().setDialog(null);
    await userEvent.keyboard('{Control>}i{/Control}');
    expect(app().panel.type).toBe('members');
    await userEvent.keyboard('{Control>}I{/Control}');
    expect(app().panel.type).toBeNull();
    await userEvent.keyboard('{Control>}f{/Control}');
    expect(app().panel.type).toBe('search');
    await userEvent.keyboard('{Control>}x{/Control}'); // not a shortcut
    expect(app().panel.type).toBe('search');
    app().setPanel({ type: null });
    app().go({});
    await until(() => !app().route.code, 'home');
    await userEvent.keyboard('{Control>}i{/Control}'); // members need a workspace
    expect(app().panel.type).toBeNull();
    app().go({ code, ch: 'general' });
    await until(() => app().route.ch === 'general', 'back');
  });

  it('closes the side panel with Escape, except while typing or in a dialog', async () => {
    // The composer takes focus when a channel opens; a click elsewhere moves it away.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await userEvent.keyboard('{Escape}'); // nothing open
    app().setPanel({ type: 'members' });
    await userEvent.keyboard('{Escape}');
    expect(app().panel.type).toBeNull();
    app().go({ code, ch: 'general', thread: 'some-thread' });
    await until(() => app().panel.type === 'thread', 'the thread');
    await userEvent.keyboard('{Escape}');
    await until(() => app().route.thread === undefined && app().panel.type === null, 'the thread to close');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    app().setPanel({ type: 'members' });
    app().setDialog('invite');
    await userEvent.keyboard('{Escape}');
    expect(app().panel.type).toBe('members'); // the dialog had it
    app().setDialog(null);
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    await userEvent.keyboard('{Escape}');
    expect(app().panel.type).toBe('members'); // typing had it
    field.remove();
    app().setPanel({ type: null });
  });

  it('puts the sidebar in a drawer on narrow screens, closed by tapping beside it', async () => {
    await page.viewport(500, 800);
    useApp.setState({ drawer: true });
    // Beside the drawer (it's 340px wide), where a person would tap.
    await page.getByRole('button', { name: 'Close sidebar' }).click({ position: { x: 460, y: 400 } });
    expect(app().drawer).toBe(false);
    await page.viewport(1200, 800);
  });

  it('shows toasts with their action and a way to dismiss them', async () => {
    let acted = 0;
    app().toast({ title: 'Message deleted', actionLabel: 'Undo', onAction: () => acted++ });
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(acted).toBe(1);
    expect(app().toasts).toEqual([]);
    app().toast({ title: 'Plain', duration: 0 });
    await page.getByRole('button', { name: 'Dismiss' }).click();
    expect(app().toasts).toEqual([]);
    app().toast({ title: 'No handler', actionLabel: 'Do it' });
    await page.getByRole('button', { name: 'Do it' }).click();
    expect(app().toasts).toEqual([]);
  });
});

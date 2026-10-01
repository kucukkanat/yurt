import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { openRemote } from '../../core/harness';
import { expectText, getPeer, me, relayUrl, startApp, until, useApp } from '../app';

// The huddle panel's layout and navigation. Being in the call is set in the store, and the other member only announces
// huddle state: no microphone, camera or screen (see AGENTS.md).
const panel = () => page.getByTestId('huddle-panel');

describe('the huddle panel', () => {
  it('shows who’s in my huddle beside the conversation, follows me, collapses to the dock and goes when I leave', async () => {
    await startApp({ as: 'Ada' });
    const code = await useApp.getState().createWorkspace('Calls', { kind: 'trystero', signal: { kind: 'nostr', urls: [relayUrl()] } });
    const transport = useApp.getState().workspaces.find((w) => w.code === code)?.transport;
    if (!transport) throw new Error('no workspace');
    const bo = (await openRemote()).makePeer({ code, transport, creator: me().pub });
    await bo.peer.start();
    await until(() => [...(getPeer(code)?.peers.values() ?? [])].some((p) => p.pub === bo.kp.pub), 30_000, 'Bo over WebRTC');
    bo.peer.publish({ t: 'profile', b: { name: 'Bo', handle: 'bo' } });
    bo.peer.setHuddle({ ch: 'general', mic: false });
    useApp.setState({ huddle: { ...useApp.getState().huddle, code, ch: 'general', mic: true }, huddleOpen: true });

    // Beside the conversation, not above it: who's in, me first, with their mic state.
    await expect.element(panel().getByRole('button', { name: 'Huddle in #general' })).toBeVisible();
    await expect.element(panel().getByText('2 people')).toBeVisible();
    const people = panel().getByTestId('huddle-person');
    await expectText(people.nth(0), /Ada \(you\)/);
    await expectText(people.nth(1), /Bo\s*$/);
    await expect.element(people.nth(1).getByLabelText('Muted')).toBeVisible();
    await expect.element(panel().getByRole('button', { name: 'Leave huddle' })).toBeVisible();
    await expect.element(page.getByTestId('huddle-dock')).not.toBeInTheDocument(); // the panel has it all

    // It follows me to another conversation, and takes me back to the call's.
    useApp.getState().createChannel('random', '');
    await until(() => useApp.getState().route.ch === 'random', 10_000, 'the new channel');
    await expect.element(panel()).toBeVisible();
    await panel().getByTestId('huddle-panel-where').click();
    await until(() => useApp.getState().route.ch === 'general', 10_000, 'back in #general');

    // Collapsed, the dock stands in for it, and opens it again.
    await panel().getByTestId('huddle-panel-collapse').click();
    await expect.element(panel()).not.toBeInTheDocument();
    await expectText(page.getByTestId('huddle-dock'), /Huddle in #general\s*2/);
    await page.getByTestId('huddle-dock-open').click();
    await expect.element(panel()).toBeVisible();

    // On a phone it's full screen, and collapses to the bar above the composer.
    await page.viewport(390, 800);
    await expect.element(panel()).toHaveStyle({ position: 'fixed' });
    await panel().getByTestId('huddle-panel-collapse').click();
    await expect.element(page.getByRole('region', { name: '#general' }).getByTestId('huddle-dock')).toBeVisible();
    await page.viewport(1280, 860);
    useApp.setState({ huddleOpen: true });

    // Leaving ends it.
    await panel().getByRole('button', { name: 'Leave huddle' }).click();
    await expect.element(panel()).not.toBeInTheDocument();
    await until(() => useApp.getState().huddle.ch === null, 10_000, 'out of the huddle');
    bo.peer.leave();
  }, 60_000);
});

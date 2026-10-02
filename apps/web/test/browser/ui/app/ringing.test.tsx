import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { dmChannel } from '@yurt/protocol';
import { ringer } from '../../../../src/lib/ringer';
import { openRemote } from '../../core/harness';
import { getPeer, me, relayUrl, startApp, until, useApp } from '../app';

// Huddle state only, announced by a real member over WebRTC: no microphone, camera or screen (see AGENTS.md).
describe('a huddle in a DM', () => {
  it('rings with who’s calling, shows in the sidebar, and stops when silenced or answered', async () => {
    await startApp({ as: 'Ada' });
    // A tap first, as a person would have made: browsers only let a page play sound after one.
    await page.getByRole('heading').first().click();
    const code = await useApp.getState().createWorkspace('Calls', { relays: [relayUrl()], blossom: [] });
    const transport = useApp.getState().workspaces.find((w) => w.code === code)?.transport;
    if (!transport) throw new Error('no workspace');
    const bo = (await openRemote()).makePeer({ code, transport, creator: me().pub, webrtc: true });
    await bo.peer.start();
    // Call rooms open on demand; open both now so Bo is already connected when he joins a huddle.
    getPeer(code)?.ensureRoom();
    bo.peer.ensureRoom();
    await until(() => [...(getPeer(code)?.peers.values() ?? [])].some((p) => p.pub === bo.kp.pub), 30_000, 'Bo over WebRTC');
    bo.peer.publish({ t: 'profile', b: { name: 'Bo', handle: 'bo' } });
    const dm = dmChannel(me().pub, bo.kp.pub);
    bo.peer.publish({ t: 'msg', ch: dm, to: me().pub, b: { text: 'got a minute?' } });

    // A huddle in a channel shows in the sidebar but doesn't ring.
    bo.peer.setHuddle({ ch: 'general' });
    await expect.element(page.getByRole('img', { name: 'Huddle: 1 person' })).toBeVisible();
    expect(ringer.current()).toBeNull();

    // He calls me: it rings, and says who.
    bo.peer.setHuddle({ ch: dm });
    await expect.element(page.getByRole('alertdialog', { name: 'Bo is calling you' })).toBeVisible();
    await until(() => ringer.playing(), 10_000, 'the ringtone');
    await expect.element(page.getByTestId('huddle-indicator')).toHaveTextContent('1');

    // Silenced: quiet, and stays quiet while the call lasts.
    await page.getByTestId('incoming-call-silence').click();
    await expect.element(page.getByTestId('incoming-call')).not.toBeInTheDocument();
    expect(ringer.playing()).toBe(false);

    // He hangs up and calls again: it rings again.
    bo.peer.setHuddle({ ch: null });
    await expect.element(page.getByTestId('huddle-indicator')).not.toBeInTheDocument();
    bo.peer.setHuddle({ ch: dm });
    await expect.element(page.getByTestId('incoming-call')).toBeVisible();

    // Answered (I'm in that huddle): the ringing stops and the sidebar counts me too.
    const before = useApp.getState().huddle;
    useApp.setState({ huddle: { ...before, code, ch: dm } });
    await expect.element(page.getByTestId('incoming-call')).not.toBeInTheDocument();
    expect(ringer.playing()).toBe(false);
    await expect.element(page.getByRole('img', { name: 'Huddle: 2 people' })).toBeVisible();
    useApp.setState({ huddle: before });
    bo.peer.leave();
  }, 60_000);
});

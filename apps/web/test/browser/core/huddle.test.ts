import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { keyFromPhrase, newInviteCode, newRecoveryPhrase, newTrysteroTransport, newWorkspaceKey, type WorkspacePeer } from '@yurt/protocol';
import { huddle, MAX_VIDEO } from '../../../src/lib/huddle';
import { connect, disconnect } from '../../../src/lib/net';
import { DEFAULT_SETTINGS } from '../../../src/lib/stored';
import { openRemote, quiet, resetDb, until } from './harness';
import type { RemoteApi } from './remote';

// Real calls: this page's huddle against members in their own frames, over WebRTC with Chromium's fake devices,
// signalling through the local relay.
const code = newInviteCode();
const transport = newTrysteroTransport({ kind: 'nostr', urls: [inject('relayUrl')] });
const kp = keyFromPhrase(newRecoveryPhrase());
let me: WorkspacePeer;
let remote: RemoteApi;
let bob: ReturnType<RemoteApi['makePeer']>;
const views: string[] = [];
const unsubscribe = huddle.subscribe((v) => views.push(String(v.ch)));

/** Bob's id for me, as his room knows it. */
const myIdAtBob = () => [...bob.peer.peers].find(([, p]) => p.pub === kp.pub)?.[0];
const bobId = () => [...me.peers].find(([, p]) => p.pub === bob.kp.pub)?.[0] ?? '';

beforeAll(async () => {
  await resetDb();
  me = connect(code, kp, null, transport, DEFAULT_SETTINGS, quiet());
  remote = await openRemote();
  bob = remote.makePeer({ code, transport });
  await bob.peer.start();
  await until(() => !!myIdAtBob() && !!bobId(), 'Bob and me to meet over WebRTC', 30_000);
}, 40_000);

afterAll(async () => {
  await huddle.leave();
  unsubscribe();
  bob.peer.leave();
  disconnect(code);
});

describe('huddles', () => {
  it('start with my microphone and tell the room', async () => {
    expect(huddle.videoCount(undefined, 'general')).toBe(0);
    await huddle.join(me, 'general');
    expect(huddle.view).toMatchObject({ code, ch: 'general', mic: true, cam: false, screen: false });
    await until(() => bob.peer.huddles.get(myIdAtBob() ?? '')?.ch === 'general', 'Bob to see me in the huddle');
  });

  it('play the streams a member in the same huddle sends, and only those', async () => {
    bob.peer.setHuddle({ ch: 'general', mic: true, cam: true, screen: false });
    const target = myIdAtBob() ?? '';
    const room = bob.peer.ensureRoom();
    room?.addStream(await remote.media.mic(), { target, metadata: { kind: 'mic', ch: 'general' } });
    room?.addStream(await remote.media.cam(), { target, metadata: { kind: 'cam', ch: 'general' } });
    room?.addStream(await remote.media.cam(), { target, metadata: { kind: 'cam', ch: 'random' } }); // another huddle: ignored
    room?.addStream(await remote.media.mic(), { target, metadata: 'junk' }); // unreadable metadata: no channel, so ignored
    await until(() => !!huddle.view.remote[bobId()]?.mic && !!huddle.view.remote[bobId()]?.cam, 'Bob’s mic and camera');
    expect(huddle.videoCount(me, 'general')).toBe(1);
    // He turns his camera off: the tile goes at once, before the stream ends.
    bob.peer.setHuddle({ cam: false });
    await until(() => !huddle.view.remote[bobId()]?.cam, 'Bob’s tile to go');
    expect(huddle.view.remote[bobId()]?.mic).toBeTruthy();
  });

  it('drop a member’s screen or camera tile as soon as they turn it off, keeping the other', async () => {
    bob.peer.setHuddle({ ch: 'general', mic: true, cam: true, screen: true });
    const target = myIdAtBob() ?? '';
    const room = bob.peer.ensureRoom();
    room?.addStream(await remote.media.cam(), { target, metadata: { kind: 'cam', ch: 'general' } });
    room?.addStream(await remote.media.cam(), { target, metadata: { kind: 'screen', ch: 'general' } });
    await until(() => !!huddle.view.remote[bobId()]?.cam && !!huddle.view.remote[bobId()]?.screen, 'Bob’s camera and screen');
    bob.peer.setHuddle({ cam: true, screen: false });
    await until(() => !huddle.view.remote[bobId()]?.screen, 'the screen tile to go');
    expect(huddle.view.remote[bobId()]?.cam).toBeTruthy();
    room?.addStream(await remote.media.cam(), { target, metadata: { kind: 'screen', ch: 'general' } });
    bob.peer.setHuddle({ screen: true });
    await until(() => !!huddle.view.remote[bobId()]?.screen, 'the screen again');
    bob.peer.setHuddle({ cam: false, screen: true });
    await until(() => !huddle.view.remote[bobId()]?.cam, 'the camera tile to go');
    expect(huddle.view.remote[bobId()]?.screen).toBeTruthy();
  });

  it('mute, camera and screen sharing reach the members I’m sending to', async () => {
    huddle.toggleMic();
    expect(huddle.view.mic).toBe(false);
    huddle.toggleMic();
    expect(huddle.view.mic).toBe(true);
    await huddle.toggleCam();
    expect(huddle.view.cam).toBe(true);
    expect(huddle.videoCount(me, 'general')).toBe(1);
    await until(() => bob.peer.huddles.get(myIdAtBob() ?? '')?.cam === true, 'Bob to see my camera on');
    await huddle.toggleCam();
    expect(huddle.view.cam).toBe(false);
    await huddle.toggleScreen();
    expect(huddle.view.screen).toBe(true);
    const track = huddle.view.local.screen?.getVideoTracks()[0];
    track?.dispatchEvent(new Event('ended')); // the user stops sharing from the browser's own bar
    expect(huddle.view.screen).toBe(false);
    await huddle.toggleScreen();
    const second = huddle.view.local.screen?.getVideoTracks()[0];
    await huddle.toggleScreen(); // and the in-app button stops it too
    expect(huddle.view.screen).toBe(false);
    second?.dispatchEvent(new Event('ended')); // the browser's bar reporting it afterwards changes nothing
    expect(huddle.view.screen).toBe(false);
  });

  it('stop sending to a member who leaves the huddle', async () => {
    bob.peer.setHuddle({ ch: null, mic: false, cam: false, screen: false });
    await until(() => !huddle.view.remote[bobId()], 'Bob to leave my huddle view');
  });

  it('cap video at the limit, while audio still works', async () => {
    const others = await Promise.all(
      Array.from({ length: MAX_VIDEO }, async () => {
        const r = await openRemote();
        const p = r.makePeer({ code, transport });
        await p.peer.start();
        return p;
      }),
    );
    await until(() => others.every((o) => [...me.peers.values()].some((p) => p.pub === o.kp.pub)), 'the others to join', 40_000);
    for (const o of others) o.peer.setHuddle({ ch: 'general', mic: true, cam: true, screen: false });
    await until(() => huddle.videoCount(me, 'general') >= MAX_VIDEO, 'every camera to be counted', 20_000);
    await huddle.toggleCam();
    expect(huddle.view.cam).toBe(false);
    expect(huddle.view.error).toMatch(/capped/);
    huddle.clearError();
    expect(huddle.view.error).toBeUndefined();
    for (const o of others) o.peer.leave();
  }, 60_000);

  it('switch huddles, and leave cleanly', async () => {
    await huddle.join(me, 'random'); // leaves 'general' first
    expect(huddle.view.ch).toBe('random');
    // Alone in this one: camera on and off sends to nobody.
    await huddle.toggleCam();
    expect(huddle.view.cam).toBe(true);
    await huddle.toggleCam();
    expect(huddle.view.cam).toBe(false);
    await huddle.leave();
    expect(huddle.view.ch).toBeNull();
    // Controls do nothing outside a huddle.
    huddle.toggleMic();
    await huddle.toggleCam();
    await huddle.toggleScreen();
    expect(huddle.view).toMatchObject({ ch: null, mic: false, cam: false, screen: false });
    expect(views).toContain('general');
  });

  it('explain why a call can’t start', async () => {
    // A relay workspace without the WebRTC opt-in has no room for calls.
    const relayCode = newInviteCode();
    const relayPeer = connect(relayCode, kp, null, { kind: 'nostr', key: newWorkspaceKey(), relays: [inject('relayUrl')] }, DEFAULT_SETTINGS, quiet());
    // Connected before it's left: closing a relay subscription mid-connect trips a nostr-tools bug (see report).
    await until(() => relayPeer.connected, 'the relay');
    await huddle.join(relayPeer, 'general');
    expect(huddle.view.error).toMatch(/Allow WebRTC/);
    // A workspace left while the microphone prompt was open.
    const gone = connect(newInviteCode(), kp, null, transport, DEFAULT_SETTINGS, quiet());
    const joining = huddle.join(gone, 'general');
    disconnect(gone.code);
    await joining;
    expect(huddle.view.error).toBe('You left this workspace.');
    disconnect(relayCode);
  });

  it('explain a call blocked by a settings change made while the microphone prompt was open', async () => {
    const callsOn = { ...DEFAULT_SETTINGS, webrtc: true };
    const relayTransport = { kind: 'nostr' as const, key: newWorkspaceKey(), relays: [inject('relayUrl')] };
    const c = newInviteCode();
    const h = quiet();
    const before = connect(c, kp, null, relayTransport, callsOn, h);
    await until(() => before.connected, 'the relay');
    const joining = huddle.join(before, 'general');
    disconnect(c);
    const after = connect(c, kp, null, relayTransport, DEFAULT_SETTINGS, h); // reconnected with calls turned off
    await joining;
    expect(huddle.view.error).toMatch(/Allow WebRTC/);
    await until(() => after.connected, 'the relay again');
    disconnect(c);
  });

  it('leave cleanly after a key rotation left the call room', async () => {
    const c = newInviteCode();
    const h = quiet();
    const relayTransport = { kind: 'nostr' as const, key: newWorkspaceKey(), relays: [inject('relayUrl')] };
    const mine = connect(c, kp, kp.pub, relayTransport, { ...DEFAULT_SETTINGS, webrtc: true }, h);
    await until(() => mine.connected, 'the relay');
    mine.publish({ t: 'ws.create', b: { name: 'Rekey' } });
    await until(() => mine.state.creator === kp.pub, 'my workspace');
    await huddle.join(mine, 'general');
    const other = await openRemote();
    const carol = other.makePeer({ code: c, transport: relayTransport, creator: kp.pub, webrtc: true });
    await carol.peer.start();
    carol.peer.setHuddle({ ch: 'general', mic: true, cam: false, screen: false });
    await until(() => [...mine.huddles.values()].some((x) => x.ch === 'general'), 'Carol in my call', 30_000);
    mine.rotate(); // as after a ban: the old room goes with the old key
    await until(() => mine.room === null, 'the room to be left');
    await huddle.leave();
    expect(huddle.view.ch).toBeNull();
    // Not left here: leaving a relay workspace while its post-rotation history fetch is in flight trips a
    // nostr-tools bug (an unhandled SendingOnClosedConnection; reported). The page teardown closes them.
  }, 45_000);
});

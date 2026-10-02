// The whole app in a real browser, for UI tests: the real store, IndexedDB and network code, with other members
// played by real WorkspacePeers on the local test relay. Nothing is mocked; tests drive it like a user would.
import './styles';
import { expect, inject } from 'vitest';
import { page, type Locator } from 'vitest/browser';
// /pure: no cleanup after each test. A file is one session, its tests are steps through it.
import { render } from 'vitest-browser-react/pure';
import { keyFromPhrase, newRecoveryPhrase, WorkspacePeer, type EventFields, type KeyPair, type WsTransport } from '@yurt/protocol';
import { App } from '../../../src/App';
import { useApp } from '../../../src/store';
import { blobsDb, eventsDb, kv } from '../../../src/lib/db';
import { getPeer } from '../../../src/lib/net';
import { memStore, until } from '../../../../../packages/protocol/test/util';

export { useApp, getPeer, until };

export const relayUrl = () => inject('relayUrl');
export const blossomUrl = () => inject('blossomUrl');
/** A relay workspace on the local relay and file server. */
export const localNet = () => ({ relays: [relayUrl()], blossom: [blossomUrl()] });

/**
 * Starts the app from an empty device (each test file runs in its own page, so this runs once per file).
 * With `as`, onboarding is already done under that name.
 */
export async function startApp(opts: { as?: string; hash?: string; seed?: () => Promise<void> } = {}) {
  await page.viewport(1280, 860); // desktop; narrow-layout tests shrink it themselves
  await Promise.all([kv.clear(), eventsDb.clear(), blobsDb.clear()]);
  await opts.seed?.(); // what an earlier session (or app version) left on this device
  history.replaceState(null, '', location.pathname + (opts.hash ?? '#/'));
  await useApp.getState().init();
  // Never dial 127.0.0.1:7717 from a test: that is the user's own yurt-bridge if one is running.
  // ('off' is what makes a bridge section start looking; 'missing' shows the same setup steps.)
  useApp.setState({ bridgeStatus: 'missing' });
  if (opts.as) await useApp.getState().createIdentity(newRecoveryPhrase(), opts.as, opts.as.toLowerCase());
  // The page frame index.html gives the app: a full-height root and a body that never scrolls itself.
  const style = document.createElement('style');
  style.textContent =
    'html, body, #root { height: 100%; margin: 0; } body { overflow: hidden; background: var(--surface-page); color: var(--text-body); font-family: var(--font-body); }';
  document.head.append(style);
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  return render(<App />, { container: root });
}

/** The current user's key. */
export const me = () => {
  const id = useApp.getState().identity;
  if (!id) throw new Error('no identity yet');
  return id;
};

/** Creates a relay workspace on the local relay and waits for its #general. */
export async function createWorkspace(name = 'Test') {
  const code = await useApp.getState().createWorkspace(name, localNet());
  await until(() => !!useApp.getState().states[code]?.channels.has('general'));
  return code;
}

/**
 * Another member: a real peer on the same workspace, joined with the workspace's own transport. With my own key
 * and `profile: false` it is another of my devices (or my yurt-bridge), which signs as me.
 */
export async function member(
  code: string,
  name: string,
  kp: KeyPair = keyFromPhrase(newRecoveryPhrase()),
  opts: { profile?: boolean; transport?: WsTransport; creator?: string | null } = {},
) {
  const rec = useApp.getState().workspaces.find((w) => w.code === code);
  const transport = opts.transport ?? (rec?.transport as WsTransport | undefined);
  if (!transport) throw new Error('unknown workspace ' + code);
  const p = new WorkspacePeer({
    code,
    kp,
    transport,
    creator: opts.creator !== undefined ? opts.creator : (rec?.creator ?? null),
    store: memStore().store,
    devFileServers: true,
    onError: (m) => {
      throw new Error(name + ': ' + m);
    },
  });
  await p.start();
  await until(() => p.connected, 10_000, name + ' connected');
  if (opts.profile !== false) {
    p.publish({ t: 'profile', b: { name, handle: name.toLowerCase() } });
    p.setPresence({ st: 'online' });
    // Only wait for the app to see it when the app is in this workspace already.
    if (rec) {
      await until(() => !!useApp.getState().states[code]?.profiles.has(kp.pub), 10_000, name + "'s profile");
      // Presence isn't stored by relays: one sent before the app subscribed is lost until the next heartbeat. Re-announce
      // until the app sees it, so tests don't depend on that race.
      const seen = () => [...(getPeer(code)?.presence.values() ?? [])].some((x) => x.pub === kp.pub);
      for (let i = 0; i < 20 && !seen(); i++) {
        p.setPresence({ st: 'online', typing: i % 2 ? null : undefined });
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }
  return Object.assign(p, {
    who: kp,
    name,
    /** Publishes and waits until the app has it. */
    async say<B>(f: Omit<EventFields<B>, 'ws'>) {
      const e = p.publish(f);
      await until(() => !!getPeer(code)?.events.has(e.id), 10_000, 'event at the app');
      await until(() => !!useApp.getState().states[code]?.msgs.has(e.id) || f.t !== 'msg', 10_000, 'message in state');
      return e;
    },
  });
}

/**
 * Waits until the element's text matches. (`toHaveTextContent` in this Vitest version only passes for the exact
 * full text: regexes and substrings never match.)
 */
export const expectText = (l: Locator, re: RegExp) => expect.poll(() => l.query()?.textContent ?? '').toMatch(re);

import type { BrowserCommand } from 'vitest/node';

interface PermissionContext {
  clearPermissions(): Promise<void>;
  grantPermissions(permissions: string[], options?: { origin?: string }): Promise<void>;
}

/** Grants exactly `permissions` (e.g. notifications) to `origin`, as a user answering the browser's prompt would. */
export const setPermissions: BrowserCommand<[permissions: string[], origin: string]> = async (ctx, permissions, origin) => {
  if (ctx.provider.name !== 'playwright') throw new Error('setPermissions needs the Playwright provider');
  const context = (ctx as unknown as { context: PermissionContext }).context;
  await context.clearPermissions();
  if (permissions.length) await context.grantPermissions(permissions, { origin });
};

/**
 * The handle bridge-setup.ts leaves on globalThis: both run in the Vitest Node process. This file has no
 * runtime imports, because the config loads it directly in Node.
 */
export interface TestBridge {
  pairingCode(): string;
  allowOrigin(origin: string): void;
  revokeOrigin(origin: string): void;
}
export const TEST_BRIDGE = Symbol.for('yurt.testBridge');

const testBridge = (): TestBridge => {
  const b = (globalThis as Record<symbol, unknown>)[TEST_BRIDGE];
  if (!b) throw new Error('the test bridge is not running (test/browser/core/bridge-setup.ts)');
  return b as TestBridge;
};

/** The test bridge's current pairing code (it rotates on every successful pairing). */
export const bridgePairingCode: BrowserCommand<[]> = async () => testBridge().pairingCode();

/** Lets the test page's origin talk to the test bridge, as a user adding it under "Allowed origins" would. */
export const bridgeAllowOrigin: BrowserCommand<[origin: string]> = async (_ctx, origin) => {
  testBridge().allowOrigin(origin);
};

/** Takes the origin off the list again, so a test can start from a bridge that refuses this page whatever ran before. */
export const bridgeRevokeOrigin: BrowserCommand<[origin: string]> = async (_ctx, origin) => {
  testBridge().revokeOrigin(origin);
};

interface Cdp {
  send(method: string, params: Record<string, unknown>): Promise<unknown>;
  detach(): Promise<void>;
}
interface PageContext {
  page: {
    emulateMedia(o: { reducedMotion: 'reduce' | 'no-preference' }): Promise<void>;
    context(): { newCDPSession(page: unknown): Promise<Cdp> };
  };
}
const pageOf = (ctx: Parameters<BrowserCommand<[]>>[0]) => {
  if (ctx.provider.name !== 'playwright') throw new Error('page emulation needs the Playwright provider');
  return (ctx as unknown as PageContext).page;
};

/** Emulates the user's reduced-motion preference (Chromium's own media emulation). */
export const reduceMotion: BrowserCommand<[on: boolean]> = async (ctx, on) => {
  await pageOf(ctx).emulateMedia({ reducedMotion: on ? 'reduce' : 'no-preference' });
};

/**
 * One DevTools session per page and kind of emulation: Chromium keeps an emulation for as long as the session that set
 * it is attached, so turning it off from another session would leave it on for every later test file.
 */
const sessions = new Map<string, Cdp>();
async function emulate(ctx: Parameters<BrowserCommand<[]>>[0], kind: string, on: boolean, method: string, params: Record<string, unknown>) {
  const page = pageOf(ctx);
  const cdp = sessions.get(kind) ?? (await page.context().newCDPSession(page));
  sessions.set(kind, cdp);
  await cdp.send(method, params);
  if (on) return;
  sessions.delete(kind);
  await cdp.detach(); // and with it whatever it still emulates
}

/** Emulates a touch screen, so `(pointer: coarse)` matches as on a phone (DevTools' device mode does the same). */
export const emulateTouch: BrowserCommand<[on: boolean]> = (ctx, on) =>
  emulate(ctx, 'touch', on, 'Emulation.setTouchEmulationEnabled', { enabled: on, maxTouchPoints: on ? 5 : 1 });

/** Emulates an iPhone's browser identity (its user agent), or the real one again with an empty string. */
export const emulateUserAgent: BrowserCommand<[userAgent: string]> = (ctx, userAgent) => emulate(ctx, 'ua', !!userAgent, 'Emulation.setUserAgentOverride', { userAgent });

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

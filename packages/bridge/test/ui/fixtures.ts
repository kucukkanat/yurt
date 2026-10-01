/** Shared between global-setup.ts and the browser commands in vitest.config.ts, which both run in Vitest's process. */
export interface FixtureBridge {
  url: string;
  admin: string;
  web: string;
}
interface FixtureControl {
  /** Stops the fresh bridge (its page then reconnects), and starts it again on the same port. */
  freshDown(): Promise<void>;
  freshUp(): Promise<void>;
}
declare global {
  var __yurtBridgeFixtures: FixtureControl | undefined;
}
/** The bridge page's origin in tests (vitest.config.ts pins the browser server's port), which both bridges allow. */
export const PAGE_PORT = 63417;
export const PAGE_ORIGINS = [`http://localhost:${PAGE_PORT}`, `http://127.0.0.1:${PAGE_PORT}`];

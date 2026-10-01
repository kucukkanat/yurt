// Browser commands registered in vitest.config.ts (implemented in commands.ts, run in Node).
declare module 'vitest/browser' {
  interface BrowserCommands {
    setPermissions(permissions: string[], origin: string): Promise<void>;
    bridgePairingCode(): Promise<string>;
    bridgeAllowOrigin(origin: string): Promise<void>;
    bridgeRevokeOrigin(origin: string): Promise<void>;
    reduceMotion(on: boolean): Promise<void>;
    emulateTouch(on: boolean): Promise<void>;
    emulateUserAgent(userAgent: string): Promise<void>;
  }
}
export {};

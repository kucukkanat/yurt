// Node 22's built-in WebSocket recurses when nostr-tools closes a failed socket; use the browser-like `ws` (see AGENTS.md).
import '@yurt/protocol/node-ws';
import type { TestProject } from 'vitest/node';
import { startBlossom } from '../../../../packages/protocol/test/blossom-server';
import { startRelay } from '../../../../packages/protocol/test/relay';

declare module 'vitest' {
  export interface ProvidedContext {
    relayUrl: string;
    blossomUrl: string;
  }
}

/** Starts a local Nostr relay and Blossom server for the browser tests; nothing leaves the machine. */
export default async function setup(project: TestProject) {
  const relay = await startRelay();
  const blossom = await startBlossom();
  project.provide('relayUrl', relay.url);
  project.provide('blossomUrl', blossom.url);
  return async () => {
    await relay.close();
    await blossom.close();
  };
}

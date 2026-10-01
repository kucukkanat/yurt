import { APP_ID, roomIdFor } from './codes';
import { signalingOf, type WsTransport } from './invite';
import { workspaceKeys } from './seal';

/**
 * The Trystero room a workspace meets in, and how to join it. Keyed workspaces derive every
 * credential from the 256-bit key; only legacy (keyless) ones fall back to the guessable code.
 * `key` is the current write key for relay workspaces (it changes on rotation), else the transport's.
 */
export function roomConfig(code: string, t: WsTransport, key: string | undefined, rtc: Record<string, unknown> | undefined) {
  const signal = signalingOf(t);
  const k = key ? workspaceKeys(key) : null;
  const config: Record<string, unknown> = {
    appId: k?.app ?? APP_ID,
    password: k?.password ?? code,
    ...rtc,
    // Signaling servers belong to the workspace (members must share them); relay workspaces use
    // their own relays, so no other relay learns anything about them. Empty = strategy defaults.
    ...(signal.urls.length ? { relayConfig: { urls: [...signal.urls] } } : {}),
  };
  return { config, roomId: k?.room ?? roomIdFor(code) };
}

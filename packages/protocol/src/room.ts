import { workspaceKeys } from './seal';

/**
 * The WebRTC room a workspace's calls meet in, and how to join it. Every credential derives from the
 * current write key (it changes on rotation); signaling goes over the workspace's own relays, so no
 * other relay learns anything about it.
 */
export function roomConfig(relays: readonly string[], key: string, rtc: Record<string, unknown> | undefined) {
  const k = workspaceKeys(key);
  const config: Record<string, unknown> = { appId: k.app, password: k.password, ...rtc, relayConfig: { urls: [...relays] } };
  return { config, roomId: k.room };
}

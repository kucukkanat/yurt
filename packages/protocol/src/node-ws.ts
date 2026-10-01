// Node only: not exported from the package index, so browser bundles never include it.
// Always use `ws` on Node. Node 20 has no global WebSocket, and Node 22's built-in one re-fires
// `error` when closed after a failed connect; nostr-tools closes inside `onerror`, which then
// recurses until the stack overflows whenever a relay is unreachable.
import WS from 'ws';

// `ws` throws when a socket closed mid-connect emits `error` with no listener (nostr-tools drops its
// onerror right before closing). Browsers just fire an unheard event; match that. Handlers set via
// onerror/addEventListener still receive every error.
class BrowserLikeWebSocket extends WS {
  constructor(...args: ConstructorParameters<typeof WS>) {
    super(...args);
    this.on('error', () => {});
  }
}

(globalThis as { WebSocket?: unknown }).WebSocket = BrowserLikeWebSocket;

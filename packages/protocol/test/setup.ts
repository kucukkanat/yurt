// Tests run in Node; install the same browser-like `ws` WebSocket as the bridge (see
// packages/bridge/src/polyfill.ts for why neither Node's built-in one nor bare `ws` will do).
import WS from 'ws';

class BrowserLikeWebSocket extends WS {
  constructor(...args: ConstructorParameters<typeof WS>) {
    super(...args);
    this.on('error', () => {});
  }
}

(globalThis as { WebSocket?: unknown }).WebSocket = BrowserLikeWebSocket;

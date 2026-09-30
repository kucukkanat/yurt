// Tests run in Node; use `ws` like the bridge does (see packages/bridge/src/polyfill.ts for why).
import WS from 'ws';

(globalThis as { WebSocket?: unknown }).WebSocket = WS;

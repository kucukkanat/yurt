// Always use `ws` on Node. Node 20 has no global WebSocket, and Node 22's built-in one re-fires
// `error` when closed after a failed connect; nostr-tools closes inside `onerror`, which then
// recurses until the stack overflows whenever a relay is unreachable.
import WS from 'ws';

(globalThis as { WebSocket?: unknown }).WebSocket = WS;

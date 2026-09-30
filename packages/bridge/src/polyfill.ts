// Node 20 has no global WebSocket; Trystero's Nostr strategy needs one. Bun and Node 22+ already do.
import WS from 'ws';

if (!(globalThis as any).WebSocket) (globalThis as any).WebSocket = WS;

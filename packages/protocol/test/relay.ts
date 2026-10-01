import { pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyEvent, type Event } from 'nostr-tools/pure';
import { matchFilter, type Filter } from 'nostr-tools/filter';

/**
 * A small but real NIP-01 relay (EVENT/REQ/CLOSE, OK/EOSE, ephemeral kinds), used by the
 * integration and E2E tests so they never depend on public relays. `stored` exposes exactly
 * what an operator would hold, for privacy assertions.
 */
export interface TestRelay {
  url: string;
  port: number;
  stored: Event[];
  close(): Promise<void>;
}
export interface RelayOpts {
  /** Cap every REQ's `limit`, like public relays that serve fewer than asked. */
  maxLimit?: number;
  /** Refuse an EVENT with this NIP-01 reason (e.g. "blocked: paid relay"), or accept it (null). */
  refuse?(e: Event): string | null;
}

const isEphemeral = (k: number) => k >= 20000 && k < 30000;

export function startRelay(port = 0, opts: RelayOpts = {}): Promise<TestRelay> {
  const stored: Event[] = [];
  const subs = new Map<WebSocket, Map<string, Filter[]>>();
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  const send = (ws: WebSocket, msg: unknown[]) => ws.send(JSON.stringify(msg));

  wss.on('connection', (ws) => {
    subs.set(ws, new Map());
    ws.on('close', () => subs.delete(ws));
    ws.on('message', (raw) => {
      const [type, ...rest] = JSON.parse(String(raw)) as [string, ...unknown[]];
      if (type === 'EVENT') {
        const e = rest[0] as Event;
        if (!verifyEvent(e)) return send(ws, ['OK', e.id, false, 'invalid: bad signature']);
        const refused = opts.refuse?.(e);
        if (refused) return send(ws, ['OK', e.id, false, refused]);
        const dup = stored.some((x) => x.id === e.id);
        if (!dup && !isEphemeral(e.kind)) stored.push(e);
        send(ws, ['OK', e.id, true, dup ? 'duplicate:' : '']);
        if (!dup) for (const [c, m] of subs) for (const [id, fs] of m) if (fs.some((f) => matchFilter(f, e))) send(c, ['EVENT', id, e]);
      } else if (type === 'REQ') {
        const [id, ...fs] = rest as [string, ...Filter[]];
        subs.get(ws)?.set(id, fs);
        for (const f of fs) {
          const hits = stored.filter((e) => matchFilter(f, e)).sort((a, b) => b.created_at - a.created_at);
          for (const e of hits.slice(0, Math.min(f.limit ?? hits.length, opts.maxLimit ?? Infinity))) send(ws, ['EVENT', id, e]);
        }
        send(ws, ['EOSE', id]);
      } else if (type === 'CLOSE') {
        subs.get(ws)?.delete(rest[0] as string);
      }
    });
  });

  return new Promise((resolve) =>
    wss.on('listening', () => {
      const addr = wss.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        url: `ws://127.0.0.1:${p}`,
        port: p,
        stored,
        close: () =>
          new Promise((r) => {
            for (const c of wss.clients) c.terminate();
            wss.close(() => r());
          }),
      });
    }),
  );
}

// `npm run relay -w packages/protocol` (PORT env) serves the E2E suite.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startRelay(Number(process.env.PORT ?? 7777)).then((r) => console.log('test relay on', r.url));
}

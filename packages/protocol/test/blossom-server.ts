import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyEvent, type Event } from 'nostr-tools/pure';

/**
 * A small but real Blossom server (BUD-01 auth, BUD-02 PUT /upload and GET /<sha256>, CORS),
 * for tests. `stored` is exactly what an operator would hold, for privacy assertions.
 */
export interface TestBlossom { url: string; port: number; stored: Map<string, Buffer>; close(): Promise<void> }

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function authorized(header: string | undefined, verb: string, hash: string): boolean {
  if (!header?.startsWith('Nostr ')) return false;
  try {
    const ev = JSON.parse(Buffer.from(header.slice(6), 'base64').toString()) as Event;
    const tag = (k: string) => ev.tags.find((t) => t[0] === k)?.[1];
    return verifyEvent(ev) && ev.kind === 24242 && tag('t') === verb && tag('x') === hash && Number(tag('expiration')) > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function startBlossom(port = 0): Promise<TestBlossom> {
  const stored = new Map<string, Buffer>();
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-SHA-256');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, HEAD, OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.method === 'PUT' && req.url === '/upload') {
        const hash = sha(body);
        if (!authorized(req.headers.authorization, 'upload', hash)) return res.writeHead(401, { 'X-Reason': 'bad auth' }).end();
        stored.set(hash, body);
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ sha256: hash, size: body.length, url: `http://127.0.0.1:${port}/${hash}` }));
      }
      const hash = req.url?.slice(1).split('.')[0] ?? '';
      const blob = stored.get(hash);
      if (req.method === 'GET' && blob) return res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(blob);
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    port = typeof addr === 'object' && addr ? addr.port : port;
    resolve({ url: `http://127.0.0.1:${port}`, port, stored, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) });
  }));
}

// `npm run blossom -w packages/protocol` (PORT env) serves the E2E suite.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBlossom(Number(process.env.PORT ?? 7778)).then((b) => console.log('test blossom on', b.url));
}

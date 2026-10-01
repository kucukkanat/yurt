import { randomBytes } from '@noble/ciphers/webcrypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { b64, unb64, sealBytes, openBytes, padSize, isWorkspaceKey } from './seal';
import { MAX_FILE_BYTES } from './events';

/**
 * Files for relay workspaces, on Blossom (BUD-01/02: content-addressed blob servers over HTTPS).
 * Each file is sealed with its own random key before upload, so a server holds only padded
 * ciphertext. The key travels inside the (encrypted) message, so only people who can read the
 * message can open the file.
 */

/** Public servers that accept anonymous uploads from throwaway keys (checked 2026-10). */
export const DEFAULT_BLOSSOM: readonly string[] = ['https://blossom.primal.net', 'https://nostr.download', 'https://files.sovbit.host'];

/** Where a sealed file lives and how to open it. `hash` is the ciphertext's sha256, i.e. its Blossom id. */
export interface BlobRef {
  key: string;
  hash: string;
  servers: string[];
}

const AAD = 'yurt-file-v1';
// Largest ciphertext of an allowed file: nonce (24) + padded plaintext + Poly1305 tag (16).
const MAX_CIPHER_BYTES = 24 + padSize(MAX_FILE_BYTES + 4) + 16;
const DOWNLOAD_MS = 60_000;
const base = (s: string) => s.replace(/\/+$/, '');
const hex = (b: Uint8Array) => bytesToHex(sha256(b));

/** Server URLs from free text; keeps http(s) URLs (http is for local test servers). */
export function parseServers(s: string): string[] {
  return [
    ...new Set(
      s
        .split(/[\s,]+/)
        .filter((u) => /^https?:\/\/[^\s/]+/.test(u))
        .map(base),
    ),
  ];
}

// BUD-01 auth. A fresh key per request: servers can't link uploads or downloads to anyone.
function auth(verb: 'upload' | 'get', hash: string): string {
  const now = Math.floor(Date.now() / 1000);
  const ev = finalizeEvent(
    {
      kind: 24242,
      created_at: now,
      content: verb === 'upload' ? 'Upload blob' : 'Get blob',
      tags: [
        ['t', verb],
        ['x', hash],
        ['expiration', String(now + 300)],
      ],
    },
    generateSecretKey(),
  );
  return 'Nostr ' + btoa(JSON.stringify(ev));
}

export function encryptFile(bytes: Uint8Array): { key: string; cipher: Uint8Array; hash: string } {
  const key = randomBytes(32);
  const cipher = sealBytes(key, AAD, bytes);
  return { key: b64(key), cipher, hash: hex(cipher) };
}

export function decryptFile(key: string, cipher: Uint8Array): Uint8Array | null {
  return openBytes(unb64(key), AAD, cipher);
}

/** Seal and upload to every server; resolves with the servers that took it, throws if none did. */
export async function uploadFile(servers: readonly string[], bytes: Uint8Array): Promise<BlobRef> {
  const { key, cipher, hash } = encryptFile(bytes);
  const results = await Promise.allSettled(
    servers.map(async (s) => {
      const r = await fetch(base(s) + '/upload', {
        method: 'PUT',
        body: new Uint8Array(cipher),
        headers: { Authorization: auth('upload', hash), 'Content-Type': 'application/octet-stream', 'X-SHA-256': hash },
      });
      if (!r.ok) throw new Error(`${s}: ${r.status} ${r.headers.get('x-reason') ?? ''}`.trim());
      return base(s);
    }),
  );
  const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!ok.length) throw new Error('No file server accepted the upload. ' + results.map((r) => (r.status === 'rejected' ? String(r.reason) : '')).join('; '));
  return { key, hash, servers: ok };
}

export interface DownloadOpts {
  /** Also fetch from `http://` servers (local development and tests). Otherwise only `https://` ones. */
  allowHttp?: boolean;
  /** Per-server time limit for the whole request, body included. Default 60 s. */
  timeoutMs?: number;
}

/** A FileRef's `blob` comes from another member's message, so its shape is checked, not assumed. */
function isBlobRef(r: unknown): r is BlobRef {
  if (typeof r !== 'object' || r === null) return false;
  const { key, hash, servers } = r as Record<string, unknown>;
  // The file key has the same shape as a workspace key: 32 bytes, base64url.
  return (
    typeof key === 'string' &&
    isWorkspaceKey(key) &&
    typeof hash === 'string' &&
    /^[0-9a-f]{64}$/.test(hash) &&
    Array.isArray(servers) &&
    servers.every((s) => typeof s === 'string')
  );
}

/** The body, or null once it's longer than `max` (stops reading there, so a server can't make us buffer gigabytes). */
async function readCapped(r: Response, max: number): Promise<Uint8Array | null> {
  const body = r.body;
  if (!body) return new Uint8Array();
  if (Number(r.headers.get('content-length') ?? 0) > max) {
    await body.cancel();
    return null;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (let c = await reader.read(); !c.done; c = await reader.read()) {
    n += c.value.length;
    if (n > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(c.value);
  }
  const out = new Uint8Array(n);
  chunks.reduce((at, c) => {
    out.set(c, at);
    return at + c.length;
  }, 0);
  return out;
}

/**
 * Fetch from the listed servers in turn; null when the ref is malformed, or no allowed server has
 * an intact copy that decrypts.
 */
export async function downloadFile(ref: BlobRef, opts: DownloadOpts = {}): Promise<Uint8Array | null> {
  if (!isBlobRef(ref)) return null;
  const allowed = opts.allowHttp ? /^https?:\/\//i : /^https:\/\//i;
  for (const s of ref.servers.filter((u) => allowed.test(u))) {
    try {
      const r = await fetch(base(s) + '/' + ref.hash, { headers: { Authorization: auth('get', ref.hash) }, signal: AbortSignal.timeout(opts.timeoutMs ?? DOWNLOAD_MS) });
      if (!r.ok) {
        await r.body?.cancel();
        continue;
      }
      const cipher = await readCapped(r, MAX_CIPHER_BYTES);
      // Content addressing: a server can't substitute bytes without failing this check.
      if (cipher && hex(cipher) === ref.hash) return decryptFile(ref.key, cipher);
    } catch {
      // Servers are untrusted and may be down, slow (timeout) or malformed: try the next one.
    }
  }
  return null;
}

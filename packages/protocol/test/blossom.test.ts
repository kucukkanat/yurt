import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { encryptFile, decryptFile, uploadFile, downloadFile, parseServers, sealBytes, openBytes, workspaceKeys, newWorkspaceKey, MAX_FILE_BYTES, type BlobRef } from '../src';
import { startBlossom, type TestBlossom } from './blossom-server';
import { until } from './util';

const text = (s: string) => new TextEncoder().encode(s);
const dev = { allowHttp: true }; // the test servers are plain http

describe('file sealing', () => {
  it('round-trips bytes and identifies the blob by its ciphertext hash', () => {
    const { key, cipher, hash } = encryptFile(text('quarterly report'));
    expect(hash).toBe(bytesToHex(sha256(cipher)));
    expect(new TextDecoder().decode(decryptFile(key, cipher) ?? new Uint8Array())).toBe('quarterly report');
  });

  it('rejects a wrong key or tampered ciphertext', () => {
    const { cipher } = encryptFile(text('secret'));
    expect(decryptFile(encryptFile(text('other')).key, cipher)).toBeNull();
    const bad = cipher.slice();
    bad.set([(bad.at(-1) ?? 0) ^ 1], bad.length - 1);
    expect(decryptFile(encryptFile(text('x')).key, bad)).toBeNull();
  });

  it('pads, so file sizes only reveal a bucket', () => {
    expect(encryptFile(text('a')).cipher.length).toBe(encryptFile(text('a'.repeat(200))).cipher.length);
    const k = workspaceKeys(newWorkspaceKey()).enc;
    expect(openBytes(k, 'aad', sealBytes(k, 'aad', new Uint8Array(70_000)))?.length).toBe(70_000);
  });

  it('parses server lists', () => {
    expect(parseServers('https://a.io/ https://a.io\nhttp://127.0.0.1:1, ftp://x')).toEqual(['https://a.io', 'http://127.0.0.1:1']);
  });
});

describe('blossom', () => {
  let server: TestBlossom;
  beforeEach(async () => {
    server = await startBlossom();
  });
  afterEach(() => server.close());

  it('uploads sealed files and downloads them back', async () => {
    const ref = await uploadFile([server.url], text('meeting notes: ship friday'));
    expect(ref.servers).toEqual([server.url]);
    const stored = [...server.stored.values()].map((b) => b.toString('latin1')).join('');
    expect(stored).not.toContain('ship friday');
    expect(new TextDecoder().decode((await downloadFile(ref, dev)) ?? new Uint8Array())).toBe('meeting notes: ship friday');
  });

  it('skips unreachable servers and keeps the ones that took it', async () => {
    const ref = await uploadFile(['http://127.0.0.1:9', server.url], text('x'));
    expect(ref.servers).toEqual([server.url]);
    expect(await downloadFile({ ...ref, servers: ['http://127.0.0.1:9', server.url] }, dev)).not.toBeNull();
  });

  it('fails loudly when no server accepts the upload', async () => {
    await expect(uploadFile(['http://127.0.0.1:9'], text('x'))).rejects.toThrow('No file server accepted the upload');
  });

  it("says why each server refused the upload, with the server's reason when it gives one", async () => {
    const paid = await startBlossom(0, { refuseUploads: { status: 402, reason: 'blocked: paid server' } });
    const full = await startBlossom(0, { refuseUploads: { status: 507 } });
    const err = uploadFile([paid.url, full.url], text('x'));
    await expect(err).rejects.toThrow(`${paid.url}: 402 blocked: paid server`);
    await expect(err).rejects.toThrow(new RegExp(`${full.url}: 507$`));
    await Promise.all([paid.close(), full.close()]);
  });

  it('treats an empty answer as no copy', async () => {
    const ref = await uploadFile([server.url], text('x'));
    const empty = await startBlossom(0, { emptyStatus: 204 });
    expect(await downloadFile({ ...ref, servers: [empty.url] }, dev)).toBeNull();
    await empty.close();
  });

  it('returns null when no server has an intact copy', async () => {
    const ref = await uploadFile([server.url], text('x'));
    expect(await downloadFile({ ...ref, hash: '0'.repeat(64) }, dev)).toBeNull();
    server.stored.set(ref.hash, Buffer.from('swapped bytes'));
    expect(await downloadFile(ref, dev)).toBeNull();
  });

  it('only fetches from https servers unless dev servers are allowed', async () => {
    const ref = await uploadFile([server.url], text('x'));
    expect(await downloadFile(ref)).toBeNull();
    expect(await downloadFile(ref, dev)).not.toBeNull();
  });

  it('returns null for malformed refs from other members instead of throwing', async () => {
    const ref = await uploadFile([server.url], text('x'));
    const bad: unknown[] = [
      null,
      'ref',
      { ...ref, servers: server.url },
      { ...ref, servers: [42] },
      { ...ref, hash: 'ZZ'.repeat(32) },
      { ...ref, hash: ref.hash.slice(2) },
      { ...ref, key: 'not a key' },
      { ...ref, key: 7 },
    ];
    for (const r of bad) expect(await downloadFile(r as BlobRef, dev)).toBeNull();
  });

  it('stops reading a body larger than any allowed file', async () => {
    const huge = Buffer.alloc(2 * MAX_FILE_BYTES);
    // With Content-Length it's refused up front; without, once the bytes read pass the limit.
    for (const chunked of [false, true]) {
      const big = await startBlossom(0, { chunked });
      const ref = await uploadFile([big.url], text('x'));
      big.stored.set(ref.hash, huge);
      expect(await downloadFile(ref, dev)).toBeNull();
      await until(() => big.aborted.includes(ref.hash)); // hung up mid-transfer instead of buffering it all
      await big.close();
    }
  });

  it('gives up on a server that never answers', async () => {
    const stall = http.createServer(() => {}); // accepts requests, never responds
    await new Promise<void>((r) => stall.listen(0, '127.0.0.1', r));
    const addr = stall.address();
    const slow = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const ref = await uploadFile([server.url], text('still here'));
    const started = Date.now();
    const got = await downloadFile({ ...ref, servers: [slow, server.url] }, { ...dev, timeoutMs: 300 });
    expect(new TextDecoder().decode(got ?? new Uint8Array())).toBe('still here');
    expect(Date.now() - started).toBeLessThan(5_000);
    stall.closeAllConnections();
    await new Promise((r) => stall.close(r));
  });

  it('test server refuses uploads without valid auth', async () => {
    const body = text('x');
    const hash = bytesToHex(sha256(body));
    const wrong = finalizeEvent(
      {
        kind: 24242,
        created_at: 0,
        content: '',
        tags: [
          ['t', 'upload'],
          ['x', '0'.repeat(64)],
          ['expiration', '9999999999'],
        ],
      },
      generateSecretKey(),
    );
    for (const auth of [undefined, 'Nostr ' + btoa(JSON.stringify(wrong)), 'Nostr garbage']) {
      const r = await fetch(server.url + '/upload', { method: 'PUT', body, headers: auth ? { Authorization: auth } : {} });
      expect(r.status).toBe(401);
    }
    expect(server.stored.has(hash)).toBe(false);
  });
});

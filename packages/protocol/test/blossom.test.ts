import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { encryptFile, decryptFile, uploadFile, downloadFile, parseServers, sealBytes, openBytes, workspaceKeys, newWorkspaceKey } from '../src';
import { startBlossom, type TestBlossom } from './blossom-server';

const text = (s: string) => new TextEncoder().encode(s);

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
    bad[bad.length - 1] ^= 1;
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
  beforeEach(async () => { server = await startBlossom(); });
  afterEach(() => server.close());

  it('uploads sealed files and downloads them back', async () => {
    const ref = await uploadFile([server.url], text('meeting notes: ship friday'));
    expect(ref.servers).toEqual([server.url]);
    const stored = [...server.stored.values()].map((b) => b.toString('latin1')).join('');
    expect(stored).not.toContain('ship friday');
    expect(new TextDecoder().decode((await downloadFile(ref)) ?? new Uint8Array())).toBe('meeting notes: ship friday');
  });

  it('skips unreachable servers and keeps the ones that took it', async () => {
    const ref = await uploadFile(['http://127.0.0.1:9', server.url], text('x'));
    expect(ref.servers).toEqual([server.url]);
    expect(await downloadFile({ ...ref, servers: ['http://127.0.0.1:9', server.url] })).not.toBeNull();
  });

  it('fails loudly when no server accepts the upload', async () => {
    await expect(uploadFile(['http://127.0.0.1:9'], text('x'))).rejects.toThrow('No file server accepted the upload');
  });

  it('returns null when no server has an intact copy', async () => {
    const ref = await uploadFile([server.url], text('x'));
    expect(await downloadFile({ ...ref, hash: '0'.repeat(64) })).toBeNull();
    server.stored.set(ref.hash, Buffer.from('swapped bytes'));
    expect(await downloadFile(ref)).toBeNull();
  });

  it('test server refuses uploads without valid auth', async () => {
    const body = text('x');
    const hash = bytesToHex(sha256(body));
    const wrong = finalizeEvent({ kind: 24242, created_at: 0, content: '', tags: [['t', 'upload'], ['x', '0'.repeat(64)], ['expiration', '9999999999']] }, generateSecretKey());
    for (const auth of [undefined, 'Nostr ' + btoa(JSON.stringify(wrong)), 'Nostr garbage']) {
      const r = await fetch(server.url + '/upload', { method: 'PUT', body, headers: auth ? { Authorization: auth } : {} });
      expect(r.status).toBe(401);
    }
    expect(server.stored.has(hash)).toBe(false);
  });
});

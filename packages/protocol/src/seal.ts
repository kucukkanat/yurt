import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from '@noble/ciphers/webcrypto';
import { edwardsToMontgomeryPriv, edwardsToMontgomeryPub, x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

/**
 * Confidentiality for relay-stored workspaces. The 8-char invite code has ~39 bits of entropy,
 * brute-forceable offline by a relay operator, so encryption uses a separate 256-bit workspace
 * key (`wk`) that only ever travels in an invite link's #fragment.
 */

const NONCE = 24;
// Chunked: spreading a large array into String.fromCharCode overflows the call stack.
export const b64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const derive = (ikm: Uint8Array, info: string, len = 32, salt?: Uint8Array) => hkdf(sha256, ikm, salt, 'yurt-' + info + '-v1', len);

export interface WsKeys {
  /** XChaCha20-Poly1305 key for everything visible to all members. */
  readonly enc: Uint8Array;
  /** Opaque relay index tag for the workspace; reveals nothing about the code or members. */
  readonly tag: string;
  /**
   * WebRTC room credentials, all derived from the key so the short code can't reach the room.
   * `app` replaces the public "yurt.p2p.v1" app id: signaling topics then don't mark anyone as a Yurt user.
   */
  readonly app: string;
  readonly room: string;
  readonly password: string;
  /** Per-member mailbox tag for private events. Members can compute it; only the pair can decrypt. */
  inbox(pub: string): string;
  /** Pairwise key for private events between `sec`'s owner and `pub`. Symmetric: both sides derive the same key. */
  pair(sec: string, pub: string): Uint8Array;
}

/** 32 random bytes, base64url (43 chars). */
export const newWorkspaceKey = (): string => b64(randomBytes(32));

export function isWorkspaceKey(k: string): boolean {
  try {
    return /^[A-Za-z0-9_-]{43}$/.test(k) && unb64(k).length === 32;
  } catch {
    return false;
  }
}

export function workspaceKeys(key: string): WsKeys {
  if (!isWorkspaceKey(key)) throw new Error('invalid workspace key');
  const wk = unb64(key);
  return {
    enc: derive(wk, 'enc'),
    tag: bytesToHex(derive(wk, 'tag', 16)),
    app: bytesToHex(derive(wk, 'app', 16)),
    room: bytesToHex(derive(wk, 'room', 12)),
    password: bytesToHex(derive(wk, 'room-pw')),
    inbox: (pub) => bytesToHex(derive(wk, 'inbox:' + pub, 16)),
    pair: (sec, pub) => derive(x25519.getSharedSecret(edwardsToMontgomeryPriv(hexToBytes(sec)), edwardsToMontgomeryPub(hexToBytes(pub))), 'dm', 32, wk),
  };
}

/** Padded plaintext size: powers of 4 from 256 B up to 64 KiB, then 64 KiB steps. Hides message length. */
export function padSize(n: number): number {
  let b = 256;
  while (b < n && b < 65_536) b *= 4;
  return b >= n ? b : Math.ceil(n / 65_536) * 65_536;
}

/** Encrypt bytes as nonce ‖ XChaCha20-Poly1305(u32 length ‖ bytes ‖ zero padding), bound to `aad`. */
export function sealBytes(key: Uint8Array, aad: string, body: Uint8Array): Uint8Array {
  // The padding means ciphertext size only reveals a coarse bucket.
  const plain = new Uint8Array(padSize(body.length + 4));
  new DataView(plain.buffer).setUint32(0, body.length);
  plain.set(body, 4);
  const nonce = randomBytes(NONCE);
  return concatBytes(nonce, xchacha20poly1305(key, nonce, utf8ToBytes(aad)).encrypt(plain));
}

/**
 * Decrypt a `sealBytes` output. Returns null when it doesn't authenticate: relay tags are shared
 * with anyone who knows them, so foreign or garbage events under our tag are expected input,
 * not a failure of ours.
 */
export function openBytes(key: Uint8Array, aad: string, sealed: Uint8Array): Uint8Array | null {
  try {
    if (sealed.length <= NONCE) return null;
    const plain = xchacha20poly1305(key, sealed.subarray(0, NONCE), utf8ToBytes(aad)).decrypt(sealed.subarray(NONCE));
    const len = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
    return len + 4 <= plain.length ? plain.subarray(4, 4 + len) : null;
  } catch {
    return null;
  }
}

/** Encrypt `text`, binding it to `tag` so a ciphertext can't be replayed under another tag. */
export const seal = (key: Uint8Array, tag: string, text: string): string => b64(sealBytes(key, tag, utf8ToBytes(text)));

export function open(key: Uint8Array, tag: string, sealed: string): string | null {
  let raw: Uint8Array;
  try {
    raw = unb64(sealed);
  } catch {
    return null;
  } // not base64: foreign junk under our tag
  const plain = openBytes(key, tag, raw);
  return plain && new TextDecoder().decode(plain);
}

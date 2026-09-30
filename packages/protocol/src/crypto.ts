import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils';
import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export interface KeyPair { pub: string; sec: string }

export const hex = bytesToHex;
export const unhex = hexToBytes;

export function sha256hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

/** 12-word recovery phrase (128-bit entropy). */
export function newRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 128);
}

export function normalizePhrase(p: string): string {
  return p.trim().toLowerCase().split(/\s+/).join(' ');
}

export function isValidPhrase(p: string): boolean {
  return validateMnemonic(normalizePhrase(p), wordlist);
}

/** Deterministic keypair from a recovery phrase. Same phrase → same identity on any device. */
export function keyFromPhrase(phrase: string): KeyPair {
  const entropy = mnemonicToEntropy(normalizePhrase(phrase), wordlist);
  const seed = sha256(concatBytes(utf8ToBytes('yurt-ed25519-v1'), entropy));
  return { sec: bytesToHex(seed), pub: bytesToHex(ed25519.getPublicKey(seed)) };
}

export function sign(sec: string, msg: string): string {
  return bytesToHex(ed25519.sign(utf8ToBytes(msg), hexToBytes(sec)));
}

export function verify(pub: string, msg: string, sig: string): boolean {
  try { return ed25519.verify(hexToBytes(sig), utf8ToBytes(msg), hexToBytes(pub)); } catch { return false; }
}

/** Short fingerprint shown in the UI: 7F3A…C21E */
export function fingerprint(pub: string): string {
  const h = pub.toUpperCase();
  return h.slice(0, 4) + '…' + h.slice(-4);
}

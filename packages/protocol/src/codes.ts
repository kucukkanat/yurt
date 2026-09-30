import { sha256hex } from './crypto';

// Crockford-ish alphabet: no 0/O, 1/I/L, U.
const ALPHA = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

export function newInviteCode(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ALPHA[x % ALPHA.length]).join('');
}

/** "k7qx-2mpd" → "K7QX2MPD"; returns null when it can't be a code. */
export function normalizeCode(input: string): string | null {
  const s = input.trim().replace(/^.*#\/w\//, '').split('/')[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 8) return null;
  for (const c of s) if (!ALPHA.includes(c)) return null;
  return s;
}

export function formatCode(code: string): string {
  return code.slice(0, 4) + '-' + code.slice(4);
}

/** Trystero room id. The code itself is also the room password, so it never appears in signaling. */
export function roomIdFor(code: string): string {
  return sha256hex('yurt-room:' + code).slice(0, 24);
}

export const APP_ID = 'yurt.p2p.v1';

export function dmChannel(a: string, b: string): string {
  return 'dm:' + [a, b].sort().join(':');
}

export function agentDmChannel(owner: string, agentId: string): string {
  return 'adm:' + owner + ':' + agentId;
}

export function isPrivateChannel(ch: string): boolean {
  return ch.startsWith('dm:') || ch.startsWith('adm:');
}

export function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

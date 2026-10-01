import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools/core';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { derive, open, seal } from './seal';
import { EOSE } from './transports/nostr';

/*
 * One encrypted note per identity on Nostr relays, so a recovery phrase brings back more than the key: the app keeps
 * the workspaces it belongs to there. Everything derives from the identity's secret, so any device with the phrase
 * finds and opens it, and nobody else can do either:
 * - a separate Nostr key signs it, so relays never see the identity's public key and can't link it to its messages;
 * - `d`, the note's address, is opaque; the content is sealed like workspace events (XChaCha20-Poly1305, padded).
 */

// NIP-78 application data: addressable, so relays keep only the newest note per author and `d`.
const KIND_BACKUP = 30078;

export interface IdentityBackup {
  /** The newest backup's text, or null when there is none yet. Throws when no relay answered: unknown isn't empty. */
  load(): Promise<string | null>;
  /** Replaces the backup. Throws when no relay took it. */
  save(text: string): Promise<void>;
  close(): void;
}

export function identityBackup(sec: string, relays: readonly string[]): IdentityBackup {
  const ikm = hexToBytes(sec);
  const nsec = derive(ikm, 'backup-nostr');
  const author = getPublicKey(nsec);
  const enc = derive(ikm, 'backup-enc');
  const d = bytesToHex(derive(ikm, 'backup-d', 16));
  const pool = new SimplePool();
  // A replacement must be newer than what it replaces; two saves within a second would otherwise tie.
  let newest = 0;

  const query = (url: string) =>
    new Promise<NostrEvent[] | null>((resolve) => {
      const evs: NostrEvent[] = [];
      pool.subscribeEose(
        [url],
        { kinds: [KIND_BACKUP], authors: [author], '#d': [d] },
        {
          maxWait: 10_000,
          onevent: (e) => evs.push(e),
          onclose: ([r]) => resolve(r?.reason === EOSE ? evs : null),
        },
      );
    });

  return {
    async load() {
      const answers = await Promise.all(relays.map(query));
      if (answers.every((a) => a === null)) throw new Error('No relay answered for the backup');
      const notes = answers
        .flatMap((a) => a ?? [])
        .filter((e) => e.pubkey === author)
        .sort((a, b) => b.created_at - a.created_at);
      newest = Math.max(newest, ...notes.map((e) => e.created_at));
      for (const e of notes) {
        const text = open(enc, d, e.content);
        if (text !== null) return text;
      }
      return null;
    },

    async save(text) {
      newest = Math.max(Math.floor(Date.now() / 1000), newest + 1);
      const note = finalizeEvent({ kind: KIND_BACKUP, created_at: newest, tags: [['d', d]], content: seal(enc, d, text) }, nsec);
      const results = await Promise.allSettled(pool.publish([...relays], note));
      const refusals = results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []));
      if (refusals.length === results.length) throw new Error('No relay took the backup: ' + refusals.join('; '));
    },

    close() {
      pool.destroy();
    },
  };
}

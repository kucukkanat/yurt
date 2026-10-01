import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { finalizeEvent } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';
import { hexToBytes } from '@noble/hashes/utils';
import { derive, identityBackup, keyFromPhrase, newRecoveryPhrase, type IdentityBackup } from '../src';
import { startRelay, type TestRelay } from './relay';

const A = keyFromPhrase(newRecoveryPhrase());
const B = keyFromPhrase(newRecoveryPhrase());
// Nothing listens here: connecting fails at once.
const DOWN = 'ws://127.0.0.1:1';

let relay: TestRelay;
const opened: IdentityBackup[] = [];
const backup = (sec: string, relays = [relay.url]) => {
  const b = identityBackup(sec, relays);
  opened.push(b);
  return b;
};

beforeEach(async () => {
  relay = await startRelay();
});
afterEach(async () => {
  for (const b of opened.splice(0)) b.close();
  await relay.close();
});

describe('the identity backup', () => {
  it('is empty at first, then any device with the same phrase reads what another saved', async () => {
    expect(await backup(A.sec).load()).toBeNull();
    await backup(A.sec).save('{"hello":1}');
    expect(await backup(A.sec).load()).toBe('{"hello":1}');
  });

  it('reads the newest save, even several within one second', async () => {
    const b = backup(A.sec);
    await b.save('one');
    await b.save('two');
    await b.save('three');
    expect(await backup(A.sec).load()).toBe('three');
  });

  it('replaces a backup another device saved within the same second', async () => {
    await backup(A.sec).save('from the laptop');
    const phone = backup(A.sec);
    expect(await phone.load()).toBe('from the laptop');
    await phone.save('from the phone');
    expect(await backup(A.sec).load()).toBe('from the phone');
  });

  it('shows the relay neither the identity, the plaintext, nor another identity’s backup', async () => {
    await backup(A.sec).save('workspace K7QX2MPD');
    const [note] = relay.stored;
    expect(note?.pubkey).not.toBe(A.pub);
    expect(JSON.stringify(relay.stored)).not.toContain('K7QX2MPD');
    expect(await backup(B.sec).load()).toBeNull();
  });

  it('skips a newer note it can’t open and reads the one before', async () => {
    await backup(A.sec).save('good');
    const [good] = relay.stored;
    const nsec = derive(hexToBytes(A.sec), 'backup-nostr');
    const junk = finalizeEvent({ kind: 30078, created_at: (good?.created_at ?? 0) + 60, tags: good?.tags ?? [], content: 'not sealed' }, nsec);
    const r = await Relay.connect(relay.url);
    await r.publish(junk);
    r.close();
    expect(await backup(A.sec).load()).toBe('good');
  });

  it('fails loudly when no relay answers or takes it, and reads through one that does', async () => {
    await expect(backup(A.sec, [DOWN]).load()).rejects.toThrow('No relay answered');
    await expect(backup(A.sec, [DOWN]).save('x')).rejects.toThrow('No relay took the backup');
    const mixed = backup(A.sec, [DOWN, relay.url]);
    await mixed.save('kept');
    expect(await mixed.load()).toBe('kept');
  });
});

import { describe, it, expect } from 'vitest';
import { DEFAULT_RELAYS, DEFAULT_SIGNAL_URLS } from '@yurt/protocol';
import { defaultNewNet, netFromForm, rememberNet, migrateLastNet, dropLegacy } from '../src/lib/newNet';
import { anything, fc } from './fuzz';

describe('new workspace network settings', () => {
  it('start from the built-ins the first time', () => {
    expect(defaultNewNet(undefined, 'trystero')).toEqual({ kind: 'trystero', signal: { kind: 'nostr', urls: [...DEFAULT_SIGNAL_URLS] } });
    expect(defaultNewNet(undefined, 'nostr')).toEqual({ kind: 'nostr', relays: [...DEFAULT_RELAYS], blossom: [] });
  });

  it('remember what was used last, per mode', () => {
    const torrent = { kind: 'trystero' as const, signal: { kind: 'torrent' as const, urls: ['wss://t.example'] } };
    const relays = { kind: 'nostr' as const, relays: ['wss://r.example'], blossom: ['https://b.example'] };
    const last = rememberNet(rememberNet(undefined, torrent), relays);
    expect(defaultNewNet(last, 'trystero')).toEqual(torrent);
    expect(defaultNewNet(last, 'nostr')).toEqual(relays);
  });

  it('turn emptied form fields into the built-ins', () => {
    expect(netFromForm('nostr', { sigKind: 'nostr', sigUrls: '', relays: ' ', blossom: '' })).toEqual({ kind: 'nostr', relays: [...DEFAULT_RELAYS], blossom: [] });
    expect(netFromForm('trystero', { sigKind: 'nostr', sigUrls: '', relays: '', blossom: '' })).toEqual({
      kind: 'trystero',
      signal: { kind: 'nostr', urls: [...DEFAULT_SIGNAL_URLS] },
    });
    // Trackers with none listed means the strategy's own public ones, not nos.lol.
    expect(netFromForm('trystero', { sigKind: 'torrent', sigUrls: '', relays: '', blossom: '' })).toEqual({ kind: 'trystero', signal: { kind: 'torrent', urls: [] } });
  });

  it('carry an older version’s app-wide defaults over once, then drop them', () => {
    const saved = { theme: 'light', relays: 'wss://old.example', blossom: 'https://files.example', signalKind: 'torrent', signalUrls: 'wss://tracker.example' };
    expect(migrateLastNet(saved)).toEqual({
      trystero: { kind: 'torrent', urls: ['wss://tracker.example'] },
      nostr: { relays: ['wss://old.example'], blossom: ['https://files.example'] },
    });
    expect(dropLegacy(saved)).toEqual({ theme: 'light' });
    expect(migrateLastNet({ theme: 'dark' })).toBeUndefined();
    const kept = { trystero: { kind: 'nostr', urls: [] } };
    expect(migrateLastNet({ lastNet: kept, relays: 'wss://ignored.example' })).toEqual(kept);
  });
});

describe('new workspace network settings, for any form input', () => {
  const form = fc.record({ sigKind: fc.constantFrom('nostr' as const, 'torrent' as const), sigUrls: fc.string(), relays: fc.string(), blossom: fc.string() });

  it('always give a usable network: relays to reach, and signaling for nostr', () => {
    fc.assert(
      fc.property(form, (f) => {
        const nostr = netFromForm('nostr', f);
        if (nostr.kind === 'nostr') expect(nostr.relays.length).toBeGreaterThan(0);
        const p2p = netFromForm('trystero', f);
        if (p2p.kind === 'trystero' && p2p.signal.kind === 'nostr') expect(p2p.signal.urls.length).toBeGreaterThan(0);
      }),
    );
  });

  it('round-trip through “remember” and “prefill”', () => {
    fc.assert(
      fc.property(form, fc.constantFrom('nostr' as const, 'trystero' as const), (f, kind) => {
        const net = netFromForm(kind, f);
        expect(defaultNewNet(rememberNet(undefined, net), kind)).toEqual(net);
      }),
    );
  });

  it('never throw on any saved settings', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), anything), (saved) => {
        void migrateLastNet(saved);
        expect(Object.keys(dropLegacy(saved))).not.toContain('relays');
      }),
    );
  });
});

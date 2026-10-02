import { describe, it, expect } from 'vitest';
import { DEFAULT_RELAYS } from '@yurt/protocol';
import { defaultNewNet, netFromForm } from '../src/lib/newNet';
import { fc } from './fuzz';

describe('new workspace network settings', () => {
  it('start from the built-ins the first time', () => {
    expect(defaultNewNet(undefined)).toEqual({ relays: [...DEFAULT_RELAYS], blossom: [] });
  });

  it('start from what was used last', () => {
    const last = { relays: ['wss://r.example'], blossom: ['https://b.example'] };
    expect(defaultNewNet(last)).toEqual(last);
  });

  it('turn emptied form fields into the built-ins', () => {
    expect(netFromForm({ relays: ' ', blossom: '' })).toEqual({ relays: [...DEFAULT_RELAYS], blossom: [] });
  });
});

describe('new workspace network settings, for any form input', () => {
  const form = fc.record({ relays: fc.string(), blossom: fc.string() });

  it('always give relays to reach, and round-trip through “remember” and “prefill”', () => {
    fc.assert(
      fc.property(form, (f) => {
        const net = netFromForm(f);
        expect(net.relays.length).toBeGreaterThan(0);
        expect(defaultNewNet(net)).toEqual(net);
      }),
    );
  });
});

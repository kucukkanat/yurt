import { describe, expect, it } from 'vitest';
import { CHIME_GAP_MS, chimeDue, inAppAlerts, menuCount, menuLabel, messageToastKey, titleWith } from '../src/lib/alerts';
import { fc } from './fuzz';

describe('in-app alerts', () => {
  const ctx = { focus: false, sound: true, onScreen: false, osAlert: false };

  it('toast and chime for a conversation off screen', () => {
    expect(inAppAlerts(ctx)).toEqual({ toast: true, sound: true });
  });

  it('stay quiet in Focus mode', () => {
    expect(inAppAlerts({ ...ctx, focus: true })).toEqual({ toast: false, sound: false });
  });

  it('skip the toast for the conversation on screen, and the chime when off or the OS notification sounds', () => {
    expect(inAppAlerts({ ...ctx, onScreen: true })).toEqual({ toast: false, sound: true });
    expect(inAppAlerts({ ...ctx, sound: false })).toEqual({ toast: true, sound: false });
    expect(inAppAlerts({ ...ctx, osAlert: true })).toEqual({ toast: true, sound: false });
  });

  it('never alert in Focus mode, whatever else holds', () => {
    fc.assert(
      fc.property(fc.record({ sound: fc.boolean(), onScreen: fc.boolean(), osAlert: fc.boolean() }), (c) => {
        expect(inAppAlerts({ ...c, focus: true })).toEqual({ toast: false, sound: false });
      }),
    );
  });

  it('space chimes out', () => {
    expect(chimeDue(1000, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(chimeDue(1000 + CHIME_GAP_MS - 1, 1000)).toBe(false);
    expect(chimeDue(1000 + CHIME_GAP_MS, 1000)).toBe(true);
  });

  it('key toasts by conversation', () => {
    expect(messageToastKey('W1', 'general')).toBe('msg:W1/general');
    expect(messageToastKey('W1', 'general')).not.toBe(messageToastKey('W2', 'general'));
  });
});

describe('the tab title', () => {
  it('leads with the alerting count, if any', () => {
    expect(titleWith('Yurt', 0)).toBe('Yurt');
    expect(titleWith('Yurt', 3)).toBe('(3) Yurt');
    expect(titleWith('Yurt', 99)).toBe('(99) Yurt');
    expect(titleWith('Yurt', 100)).toBe('(99+) Yurt');
  });
});

describe('the menu button', () => {
  it('names what waits elsewhere', () => {
    expect(menuLabel({ m: 0, n: false })).toBe('Open sidebar');
    expect(menuLabel({ m: 0, n: true })).toBe('Open sidebar, new messages');
    expect(menuLabel({ m: 3, n: true })).toBe('Open sidebar, 3 unread');
  });

  it('fits its count', () => {
    expect(menuCount(1)).toBe('1');
    expect(menuCount(9)).toBe('9');
    expect(menuCount(12)).toBe('9+');
  });
});

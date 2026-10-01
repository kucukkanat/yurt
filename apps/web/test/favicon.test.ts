import { describe, it, expect } from 'vitest';
import { CALM, badgeText, isCalm, sameState } from '../src/lib/favicon';

describe('favicon state', () => {
  it('is calm only when there is nothing to show', () => {
    expect(isCalm(CALM)).toBe(true);
    for (const k of ['unread', 'inCall', 'callNearby', 'offline'] as const) expect(isCalm({ ...CALM, [k]: true })).toBe(false);
    expect(isCalm({ ...CALM, mentions: 2 })).toBe(false);
  });

  it('compares states field by field, so redraws only happen on real changes', () => {
    expect(sameState(CALM, { ...CALM })).toBe(true);
    expect(sameState(CALM, { ...CALM, mentions: 1 })).toBe(false);
    expect(sameState({ ...CALM, offline: true }, { ...CALM, offline: true })).toBe(true);
  });

  it('fits counts into a favicon badge', () => {
    expect(badgeText(1)).toBe('1');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(10)).toBe('9+');
    expect(badgeText(250)).toBe('9+');
  });
});

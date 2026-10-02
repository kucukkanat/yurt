import { describe, expect, it } from 'vitest';
import { attentive } from '../src/lib/visibility';

describe('whether I’m looking at the app', () => {
  const doc = (hidden: boolean, focused: boolean) => ({ hidden, hasFocus: () => focused });

  it('is looking only while the tab is visible and its window has focus', () => {
    expect(attentive(doc(false, true))).toBe(true);
  });

  it('is away with another app in front, even with the window still on screen', () => {
    expect(attentive(doc(false, false))).toBe(false);
  });

  it('is away in a hidden tab, whatever the focus says', () => {
    expect(attentive(doc(true, true))).toBe(false);
    expect(attentive(doc(true, false))).toBe(false);
  });
});

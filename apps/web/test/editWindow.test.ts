import { describe, it, expect } from 'vitest';
import { EDIT_WINDOW_MS } from '@yurt/protocol';
import { editLeft, editLeftLabel, EDIT_CLOSED } from '../src/lib/editWindow';
import { fc } from './fuzz';

describe('edit window', () => {
  const sent = 1_000_000;
  it('counts down from the full window and stops at zero', () => {
    expect(editLeft(sent, sent)).toBe(EDIT_WINDOW_MS);
    expect(editLeft(sent, sent + 60_000)).toBe(EDIT_WINDOW_MS - 60_000);
    expect(editLeft(sent, sent + EDIT_WINDOW_MS)).toBe(0);
    expect(editLeft(sent, sent + EDIT_WINDOW_MS * 2)).toBe(0);
    // A clock slightly behind the sender's never shows more than the full window.
    expect(editLeft(sent, sent - 5_000)).toBe(EDIT_WINDOW_MS);
  });

  it('labels the time left in whole minutes, then the last minute, then closed', () => {
    expect(editLeftLabel(12 * 60_000)).toBe('12 min left');
    expect(editLeftLabel(11 * 60_000 + 1)).toBe('12 min left');
    expect(editLeftLabel(60_000)).toBe('1 min left');
    expect(editLeftLabel(59_000)).toBe('less than a minute left');
    expect(editLeftLabel(0)).toBe('editing closed');
  });

  it('explains the window with its real length', () => {
    expect(EDIT_CLOSED.description).toContain(`${EDIT_WINDOW_MS / 60_000} minutes`);
  });
});

describe('edit window, for any times', () => {
  it('is always between zero and the full window, and its label agrees', () => {
    const t = fc.integer({ min: -1e13, max: 1e13 });
    fc.assert(
      fc.property(t, t, (ts, now) => {
        const left = editLeft(ts, now);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left).toBeLessThanOrEqual(EDIT_WINDOW_MS);
        expect(editLeftLabel(left) === 'editing closed').toBe(left === 0);
      }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { errorText, fmtBytes, fmtDay, fmtTime, handleFrom } from '../src/lib/format';
import { fc } from './fuzz';

describe('formatting', () => {
  it('sizes files in B, KB or MB', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1023)).toBe('1023 B');
    expect(fmtBytes(1536)).toBe('2 KB');
    expect(fmtBytes(5 * 1048576)).toBe('5.0 MB');
  });

  it('makes a handle from any name', () => {
    expect(handleFrom('Ada Lovelace')).toBe('ada-lovelace');
    expect(handleFrom('Zoë  Ünal')).toBe('zoe-unal');
    expect(handleFrom('!!!')).toBe('me');
    fc.assert(
      fc.property(fc.string(), (name) => {
        expect(handleFrom(name)).toMatch(/^[\w-]{1,24}$/);
      }),
    );
  });

  it('labels days relative to today, and times', () => {
    const now = new Date();
    expect(fmtDay(now.getTime())).toBe('Today');
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    expect(fmtDay(y.getTime())).toBe('Yesterday');
    // A day this year that's neither today nor yesterday shows its month, without the year.
    const month = now.getMonth() === 5 ? 2 : 5;
    expect(fmtDay(new Date(now.getFullYear(), month, 15).getTime())).toMatch(month === 5 ? /June/ : /March/);
    expect(fmtDay(new Date(now.getFullYear(), month, 15).getTime())).not.toMatch(String(now.getFullYear()));
    expect(fmtDay(new Date(2001, 4, 6).getTime())).toMatch(/2001/);
    expect(fmtTime(new Date(2001, 4, 6, 9, 5).getTime())).toMatch(/09.05|9.05/);
  });

  it('describes any thrown value', () => {
    expect(errorText(new Error('disk full'))).toBe('disk full');
    expect(errorText('plain')).toBe('plain');
    expect(errorText(42)).toBe('42');
  });
});

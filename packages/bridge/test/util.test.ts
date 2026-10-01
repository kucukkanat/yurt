import { describe, it, expect } from 'vitest';
import { errorMessage, listAt } from '../src/util';
import { compact } from '../src/compact';

describe('util', () => {
  it('reads the message of anything thrown', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain text')).toBe('plain text');
    expect(errorMessage(42)).toBe('42');
  });

  it('reads a list from a map, empty when absent', () => {
    const m = new Map([['a', [1, 2]]]);
    expect(listAt(m, 'a')).toEqual([1, 2]);
    expect(listAt(m, 'b')).toEqual([]);
  });

  it('drops undefined keys only', () => {
    expect(compact({ a: 1, b: undefined, c: null, d: '' })).toEqual({ a: 1, c: null, d: '' });
  });
});

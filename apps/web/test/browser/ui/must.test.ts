import { describe, expect, it } from 'vitest';
import { messageOf, must } from '../../../src/ui/must';

describe('must', () => {
  it('passes a present value through, including falsy ones', () => {
    expect(must('x', 'needed')).toBe('x');
    expect(must(0, 'needed')).toBe(0);
    expect(must('', 'needed')).toBe('');
  });

  it('fails loudly when a guaranteed value is missing', () => {
    expect(() => must(undefined, 'the sidebar only shows inside a workspace')).toThrow('the sidebar only shows inside a workspace');
    expect(() => must(null, 'nope')).toThrow('nope');
  });
});

describe('messageOf', () => {
  it('reads an error’s message, and anything else thrown as text', () => {
    expect(messageOf(new Error('disk full'))).toBe('disk full');
    expect(messageOf('plain string')).toBe('plain string');
    expect(messageOf(42)).toBe('42');
  });
});

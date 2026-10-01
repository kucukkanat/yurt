import { describe, expect, it } from 'vitest';
import { recentDiagnostics, report } from '../src/lib/diagnostics';

describe('diagnostics', () => {
  it('keep the latest 50 problems, as text', () => {
    report('AAAAAAAA', 'join', { error: 'incorrect room password', peerId: 'p1' });
    for (let i = 0; i < 55; i++) report('AAAAAAAA', 'error', 'failure ' + i);
    const d = recentDiagnostics();
    expect(d).toHaveLength(50);
    expect(d[0]?.detail).toBe('failure 5');
    expect(d.at(-1)).toMatchObject({ code: 'AAAAAAAA', kind: 'error', detail: 'failure 54' });
    report('BBBBBBBB', 'join', { error: 'banned' });
    expect(recentDiagnostics().at(-1)?.detail).toBe('{"error":"banned"}');
  });
});

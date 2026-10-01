import { describe, it, expect } from 'vitest';
import { log, onLog, recentLogs } from '../src/log';

describe('log', () => {
  it('keeps recent entries for the Activity view, newest last, capped', () => {
    for (let i = 0; i < 600; i++) log('acp', 'test', 'line ' + i);
    const recent = recentLogs();
    expect(recent).toHaveLength(200);
    expect(recent.at(-1)?.msg).toBe('line 599');
  });

  it('truncates huge messages and notifies subscribers until they unsubscribe', () => {
    const seen: string[] = [];
    const off = onLog((e) => seen.push(e.level + ':' + e.msg.length));
    log('info', 'test', 'x'.repeat(5000));
    log('warn', 'test', 'careful');
    log('error', 'test', 'broken');
    off();
    log('info', 'test', 'unheard');
    expect(seen).toEqual(['info:4001', 'warn:7', 'error:6']);
  });
});

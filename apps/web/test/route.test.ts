import { describe, expect, it } from 'vitest';
import { newInviteCode } from '@yurt/protocol';
import { buildHash, parseHash, type Route } from '../src/lib/route';
import { fc } from './fuzz';

const code = newInviteCode();

describe('routes', () => {
  it('parse workspaces, channels and threads', () => {
    expect(parseHash('')).toEqual({});
    expect(parseHash('#/')).toEqual({});
    expect(parseHash('#/w/' + code)).toEqual({ code });
    expect(parseHash('#/w/' + code.toLowerCase() + '/c/general/t/abc')).toEqual({ code, ch: 'general', thread: 'abc' });
    expect(parseHash('#/w/' + code + '/c/' + encodeURIComponent('dm:a:b'))).toEqual({ code, ch: 'dm:a:b' });
    // An invite's key segment is ignored here (the store reads it from the raw hash).
    expect(parseHash('#/w/' + code + '/k/somekey/c/x')).toEqual({ code, ch: 'x' });
  });

  it('ignore what isn’t a route instead of throwing', () => {
    expect(parseHash('#/w/not-a-code')).toEqual({});
    expect(parseHash('#/w')).toEqual({});
    expect(parseHash('#/w/' + code + '/c')).toEqual({ code });
    expect(parseHash('#/w/' + code + '/c//t/')).toEqual({ code });
    // A malformed escape (a truncated or hand-edited link) stays as typed.
    expect(parseHash('#/w/' + code + '/c/%E0%A4%A')).toEqual({ code, ch: '%E0%A4%A' });
  });

  it('build hashes that drop parts without their parent', () => {
    expect(buildHash({})).toBe('#/');
    expect(buildHash({ ch: 'general', thread: 't' })).toBe('#/');
    expect(buildHash({ code })).toBe('#/w/' + code);
    expect(buildHash({ code, thread: 't' })).toBe('#/w/' + code);
    expect(buildHash({ code, ch: 'general' })).toBe('#/w/' + code + '/c/general');
    expect(buildHash({ code, ch: 'a/b c', thread: 'x/y' })).toBe('#/w/' + code + '/c/a%2Fb%20c/t/x%2Fy');
  });

  it('never throw, whatever the address bar holds', () => {
    fc.assert(fc.property(fc.string(), (h) => void parseHash(h)));
    fc.assert(fc.property(fc.string({ unit: 'binary' }), (h) => void parseHash('#/w/' + code + '/c/' + h)));
  });

  it('round-trip any channel and thread id', () => {
    const route = fc.record({ ch: fc.option(fc.string({ unit: 'binary', minLength: 1 }), { nil: undefined }), thread: fc.string({ unit: 'binary', minLength: 1 }) });
    fc.assert(
      fc.property(route, ({ ch, thread }) => {
        const r: Route = ch ? { code, ch, thread } : { code };
        expect(parseHash(buildHash(r))).toEqual(r);
      }),
    );
  });
});

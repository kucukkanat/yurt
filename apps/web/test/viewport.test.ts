import { describe, expect, it } from 'vitest';
import { viewportVars } from '../src/lib/viewport';

describe('fitting the app to the visible area', () => {
  const cleared = { '--app-height': null, '--app-top': null, '--safe-bottom': null };

  it('keeps the CSS layout height while nothing covers the page, zoomed or short by a status bar', () => {
    expect(viewportVars(800, { height: 800, scale: 1, pageTop: 0 })).toEqual(cleared);
    expect(viewportVars(800, { height: 400, scale: 2, pageTop: 300 })).toEqual(cleared);
    expect(viewportVars(844, { height: 797, scale: 1, pageTop: 0 })).toEqual(cleared);
  });

  it('follows an iOS keyboard: the visible height, where iOS panned to, no home indicator inset', () => {
    expect(viewportVars(844, { height: 508, scale: 1, pageTop: 336 })).toEqual({ '--app-height': '508px', '--app-top': '336px', '--safe-bottom': '0px' });
  });

  it('stays put while a zoomed page is panned under the keyboard', () => {
    expect(viewportVars(844, { height: 254, scale: 2, pageTop: 400 })).toEqual({ '--app-height': '508px', '--app-top': '0px', '--safe-bottom': '0px' });
  });
});

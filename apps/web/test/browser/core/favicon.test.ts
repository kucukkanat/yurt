import { afterEach, describe, expect, it } from 'vitest';
import { CALM, type FaviconState, installFavicon } from '../../../src/lib/favicon';
import { until } from './harness';

const svg = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fill}"/></svg>`)}`;
const BLUE = svg('#00f');
const RED = svg('#f00');

const icons = () => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
function setIcon(href: string): HTMLLinkElement {
  for (const l of icons()) l.remove();
  const l = document.createElement('link');
  l.rel = 'icon';
  l.href = href;
  document.head.append(l);
  return l;
}
const href = () => icons()[0]?.href ?? '';
const tick = () => new Promise((r) => setTimeout(r, 30));

afterEach(() => {
  for (const l of icons()) l.remove();
  document.documentElement.style.removeProperty('--danger');
});

describe('tab icon', () => {
  it('leaves the page’s icon alone while there is nothing to say, and badges it otherwise', async () => {
    const link = setIcon(BLUE);
    let state: FaviconState = CALM;
    const fav = installFavicon(() => state);
    await tick();
    expect(link.href).toBe(BLUE);
    for (const s of [
      { ...CALM, mentions: 3 },
      { ...CALM, mentions: 12 },
      { ...CALM, unread: true },
      { ...CALM, inCall: true, mentions: 1 },
      { ...CALM, callNearby: true },
      { ...CALM, offline: true, unread: true },
    ]) {
      state = s;
      fav.update();
      expect(link.href).toMatch(/^data:image\/png/);
    }
    // The same state again draws nothing new.
    const drawn = link.href;
    fav.update();
    expect(link.href).toBe(drawn);
    state = CALM;
    fav.update();
    expect(link.href).toBe(BLUE);
  });

  it('decorates a newly chosen icon: a new href, or a new link element', async () => {
    const link = setIcon(BLUE);
    const state: FaviconState = { ...CALM, unread: true };
    installFavicon(() => state);
    await until(() => link.href.startsWith('data:image/png'), 'the first badge');
    const onBlue = link.href;
    link.href = RED; // someone swaps the icon
    await until(() => link.href.startsWith('data:image/png') && link.href !== onBlue, 'a badge on the new icon');
    const onRed = link.href;
    const next = setIcon(BLUE); // a whole new <link>
    await until(() => next.href.startsWith('data:image/png'), 'a badge on the new link');
    expect(next.href).not.toBe(onRed);
  });

  it('uses the theme’s colours when they are set', async () => {
    const link = setIcon(BLUE);
    const fav = installFavicon(() => ({ ...CALM, mentions: 1 }));
    await tick();
    const fallback = link.href;
    document.documentElement.style.setProperty('--danger', '#00ff00');
    link.href = BLUE; // force a redraw with the new palette
    await until(() => link.href !== BLUE && link.href !== fallback, 'a redraw with the theme colour');
    fav.update();
  });

  it('still badges when the icon can’t be loaded', async () => {
    const link = setIcon('/no-such-icon.png');
    installFavicon(() => ({ ...CALM, mentions: 2 }));
    await until(() => link.href.startsWith('data:image/png'), 'a badge without a base icon');
  });

  it('does nothing on a page without an icon', async () => {
    const fav = installFavicon(() => ({ ...CALM, mentions: 2 }));
    fav.update();
    await tick();
    expect(href()).toBe('');
  });
});

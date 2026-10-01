import { afterEach, describe, expect, it } from 'vitest';
import { CALM, type FaviconState, installFavicon as install } from '../../../src/lib/favicon';
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

// Each test's icon keeper is stopped afterwards: a live one would adopt and redraw the next test's icon.
const running: { stop(): void }[] = [];
const installFavicon = (read: () => FaviconState) => {
  const fav = install(read);
  running.push(fav);
  return fav;
};

/** The RGB of one pixel of a drawn icon. */
async function pixel(href: string, x: number, y: number): Promise<[number, number, number]> {
  const img = new Image();
  img.src = href;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  ctx.drawImage(img, 0, 0);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(x, y, 1, 1).data;
  return [r, g, b];
}

afterEach(() => {
  for (const f of running.splice(0)) f.stop();
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
    document.documentElement.style.setProperty('--danger', '#00ff00');
    const link = setIcon(BLUE);
    installFavicon(() => ({ ...CALM, mentions: 1 }));
    await until(() => link.href.startsWith('data:image/png'), 'a badge');
    // Inside the mention badge (centre 47,17 on the 64px icon, radius 17), clear of the digit: the theme's green.
    expect(await pixel(link.href, 37, 17)).toEqual([0, 255, 0]);
  });

  it('lets go of the icon once stopped, even mid-load', async () => {
    const link = setIcon(BLUE);
    const fav = installFavicon(() => ({ ...CALM, mentions: 1 }));
    const badgeOnly = link.href; // drawn at once, before the base icon loads
    fav.stop();
    await tick(); // the base icon's load lands now, and draws nothing
    expect(link.href).toBe(badgeOnly);
    link.href = RED;
    await tick();
    expect(link.href).toBe(RED);
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

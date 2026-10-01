/**
 * The tab icon reflects the app's state by drawing on top of whatever icon the page declares, so
 * the base icon can be swapped freely: we read `<link rel="icon">`, decorate it on a canvas, and
 * put the original back when there's nothing to say. Replacing the icon (a new link, or a new href
 * that isn't one of ours) makes the new one the base.
 */

export interface FaviconState {
  /** Unread mentions and DMs: a numbered red badge. */
  mentions: number;
  /** Other unread messages: a small dot. */
  unread: boolean;
  /** I'm in a huddle: a ring around the icon. */
  inCall: boolean;
  /** Someone is in a huddle I'm not in: a dot in the other corner. */
  callNearby: boolean;
  /** No network, or the current relay workspace can't reach any relay: greyed out. */
  offline: boolean;
}

export const CALM: FaviconState = { mentions: 0, unread: false, inCall: false, callNearby: false, offline: false };

export const isCalm = (s: FaviconState) => !s.mentions && !s.unread && !s.inCall && !s.callNearby && !s.offline;
export const sameState = (a: FaviconState, b: FaviconState) =>
  a.mentions === b.mentions && a.unread === b.unread && a.inCall === b.inCall && a.callNearby === b.callNearby && a.offline === b.offline;

/** Badge text: counts above 9 don't fit at favicon size. */
export const badgeText = (n: number) => (n > 9 ? '9+' : String(n));

export interface Palette { danger: string; accent: string; success: string; onColor: string }

/** Draws `base` (if it loaded) decorated for `s` onto a square canvas of `size` pixels. */
export function paint(ctx: CanvasRenderingContext2D, size: number, base: CanvasImageSource | null, s: FaviconState, c: Palette) {
  ctx.clearRect(0, 0, size, size);
  const inset = s.inCall ? size * 0.12 : 0; // leave room for the ring
  if (base) {
    ctx.save();
    if (s.offline) { ctx.filter = 'grayscale(1)'; ctx.globalAlpha = 0.55; }
    ctx.drawImage(base, inset, inset, size - 2 * inset, size - 2 * inset);
    ctx.restore();
  }
  const dot = (x: number, y: number, r: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = size * 0.05;
    ctx.strokeStyle = c.onColor;
    ctx.stroke();
  };
  if (s.inCall) {
    ctx.lineWidth = size * 0.09;
    ctx.strokeStyle = c.success;
    ctx.beginPath();
    ctx.roundRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth, size * 0.28);
    ctx.stroke();
  } else if (s.callNearby) {
    dot(size * 0.2, size * 0.8, size * 0.16, c.success);
  }
  if (s.mentions) {
    const r = size * 0.27;
    dot(size - r, r, r, c.danger);
    ctx.fillStyle = c.onColor;
    ctx.font = `bold ${Math.round(r * (s.mentions > 9 ? 1.05 : 1.4))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText(s.mentions), size - r, r + size * 0.01);
  } else if (s.unread) {
    dot(size * 0.82, size * 0.18, size * 0.16, c.accent);
  }
}

const SIZE = 64;

function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { danger: v('--danger', '#e5484d'), accent: v('--accent', '#2f55ff'), success: v('--success', '#30a46c'), onColor: '#ffffff' };
}

/** Keeps the tab icon in step with `read()`; call `update()` whenever app state may have changed. */
export function installFavicon(read: () => FaviconState): { update(): void } {
  const ours = new Set<string>(); // hrefs we generated, so we can tell them from a newly chosen icon
  let link: HTMLLinkElement | null = null;
  let baseHref = '';
  let base: HTMLImageElement | null = null;
  let shown: FaviconState = CALM;
  let drawn = false;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;

  /** Picks up a newly chosen icon as the base; false when nothing changed (including our own writes). */
  const adopt = (): boolean => {
    const l = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!l) return false;
    if (l === link && (ours.has(l.href) || l.href === baseHref)) return false;
    link = l;
    baseHref = l.href;
    ours.clear();
    base = null;
    drawn = false;
    const img = new Image();
    img.crossOrigin = 'anonymous'; // a cross-origin icon without CORS taints the canvas; we then draw badges alone
    img.onload = () => { base = img; render(true); };
    img.onerror = () => render(true);
    img.src = baseHref;
    return true;
  };

  const render = (force = false) => {
    if (adopt()) force = true;
    if (!link) return;
    const s = read();
    if (!force && drawn && sameState(s, shown)) return;
    shown = s;
    drawn = true;
    if (isCalm(s)) { link.href = baseHref; return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paint(ctx, SIZE, base, s, palette());
    let href: string;
    try { href = canvas.toDataURL('image/png'); } catch { base = null; paint(ctx, SIZE, null, s, palette()); href = canvas.toDataURL('image/png'); }
    ours.add(href);
    link.href = href;
  };

  // Someone swapping the icon (new <link> or a new href) gives us a new base to decorate. Our own
  // writes also trigger this, but adopt() recognises them, so they don't redraw (or loop).
  new MutationObserver(() => { if (adopt()) render(true); }).observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel'] });
  render(true);
  return { update: () => render() };
}

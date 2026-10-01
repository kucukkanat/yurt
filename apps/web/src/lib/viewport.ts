import { must } from '../ui/must';

/**
 * Sizes the app to the visible area. Android shrinks the page for the on-screen keyboard (index.html's
 * interactive-widget); iOS doesn't, so without this the composer would sit under the keyboard. Times the scale, so
 * pinch-zooming doesn't shrink the layout.
 */
export function trackViewport() {
  const vv = must(window.visualViewport, 'every supported browser has a visual viewport');
  const resize = () => document.documentElement.style.setProperty('--app-height', vv.height * vv.scale + 'px');
  vv.addEventListener('resize', resize);
  resize();
}

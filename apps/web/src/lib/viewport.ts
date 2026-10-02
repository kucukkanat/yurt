import { must } from '../ui/must';

/** Taller than any browser bar that comes and goes, shorter than any on-screen keyboard. */
const KEYBOARD_MIN = 120;

/**
 * The CSS variables that fit the app to what's visible. Android shrinks the page for the on-screen keyboard
 * (index.html's interactive-widget), so the layout height already fits; iOS keeps the page and pans over it, so with
 * the keyboard up the app takes the visible height, moves to where iOS panned (else it sits above the keyboard with a
 * gap below), and drops the home indicator's inset, which the keyboard covers. Otherwise the variables are cleared:
 * the CSS 100% is right, including in an installed iOS app, whose visual viewport can be short by the status bar.
 * Heights are times the scale so pinch-zooming doesn't shrink the layout, and a zoomed page isn't moved while panned.
 */
export function viewportVars(layoutHeight: number, vv: { height: number; scale: number; pageTop: number }): Record<string, string | null> {
  const height = vv.height * vv.scale;
  if (layoutHeight - height < KEYBOARD_MIN) return { '--app-height': null, '--app-top': null, '--safe-bottom': null };
  return { '--app-height': height + 'px', '--app-top': (vv.scale === 1 ? vv.pageTop : 0) + 'px', '--safe-bottom': '0px' };
}

export function trackViewport() {
  const vv = must(window.visualViewport, 'every supported browser has a visual viewport');
  const root = document.documentElement;
  const update = () => {
    for (const [name, value] of Object.entries(viewportVars(root.clientHeight, vv))) {
      if (value === null) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

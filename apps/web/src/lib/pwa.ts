import { useApp } from '../store';

/** Yurt as an installed app: offering the install, telling whether it is one, and its home-screen badge. */

/** Chromium's install offer (`beforeinstallprompt`): not in the DOM typings, so only what's used is declared. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
const isInstallPrompt = (e: Event): e is InstallPrompt => 'prompt' in e && typeof e.prompt === 'function' && 'userChoice' in e;

let offer: InstallPrompt | null = null;

/**
 * Keeps Chromium's install offer for our own Install button, instead of the browser's mini-bar, and notes when the
 * app gets installed. Safari has no such offer: there, Settings explains Add to Home Screen.
 */
export function watchInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    if (!isInstallPrompt(e)) return;
    e.preventDefault();
    offer = e;
    useApp.setState({ installable: true });
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    useApp.setState({ installable: false });
  });
}

/** Shows the browser's install dialog; true when the user installed. Only while `installable`. */
export async function install(): Promise<boolean> {
  const o = offer;
  if (!o) return false;
  offer = null; // each offer can be shown once
  useApp.setState({ installable: false });
  await o.prompt();
  return (await o.userChoice).outcome === 'accepted';
}

/** Running as an installed app (home screen or desktop window), not in a browser tab. */
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches;

/** iPhone or iPad, where only Safari's Share → Add to Home Screen installs (iPadOS reports a Mac with touch). */
export const isIos = (ua: string, touchPoints: number) => /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);

/** The unread count on the app's icon. Outside an installed app browsers refuse it, which is expected, not an error. */
export function setBadge(n: number) {
  // Optional calls: browsers without the Badging API (Firefox) have neither method.
  const asked = n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.();
  asked?.catch(() => {
    /* not installed: no icon to badge */
  });
}

/**
 * Once per device, on a phone or tablet in the browser, once there's someone to install it for (after onboarding, or
 * at once for a returning user): suggest installing. Settings → App explains how.
 */
export function offerInstall() {
  const { identity, settings, standalone, toast, openSettings, updateSettings } = useApp.getState();
  if (!identity || settings.installHint || standalone || !matchMedia('(pointer: coarse)').matches) return;
  void updateSettings({ installHint: true });
  toast({
    title: 'Install Yurt',
    description: 'Add it to your home screen for notifications and a full-screen app.',
    actionLabel: 'How',
    duration: 10_000,
    onAction: () => openSettings('app'),
  });
}

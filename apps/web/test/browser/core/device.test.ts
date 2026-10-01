import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { newRecoveryPhrase } from '@yurt/protocol';
import { useApp } from '../../../src/store';
import { haptic } from '../../../src/lib/haptics';
import { install, isIos, isStandalone, offerInstall, setBadge, watchInstall } from '../../../src/lib/pwa';
import { trackViewport } from '../../../src/lib/viewport';
import { resetDb, until } from './harness';

// What the app does with the device it runs on, in real Chromium: vibration, the install offer, the icon badge and
// the visible viewport. Touch and reduced motion are Chromium's own emulation (DevTools' device mode).

beforeAll(async () => {
  await resetDb();
  await useApp.getState().init();
  // Browsers only vibrate once the user has interacted with the page, as they have whenever the app buzzes.
  await userEvent.click(document.body);
});
afterAll(async () => {
  await commands.reduceMotion(false);
  await commands.emulateTouch(false);
});

describe('haptics', () => {
  it('vibrate unless turned off or the user prefers reduced motion', async () => {
    expect(haptic('tap')).toBe(true);
    await useApp.getState().updateSettings({ haptics: false });
    expect(haptic('tick')).toBe(false);
    await useApp.getState().updateSettings({ haptics: true });
    await commands.reduceMotion(true);
    expect(haptic('notice')).toBe(false);
    await commands.reduceMotion(false);
    expect(haptic('notice')).toBe(true);
  });
});

/**
 * Chromium's install offer as the browser dispatches it: an event carrying prompt() and the user's choice. Headless
 * Chromium never offers installing by itself, so the test plays the browser's part with the same event.
 */
function offerEvent(outcome: 'accepted' | 'dismissed') {
  let prompted = 0;
  const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: async () => {
      prompted++;
    },
    userChoice: Promise.resolve({ outcome }),
  });
  return { e, prompted: () => prompted };
}

describe('installing', () => {
  it('keeps the browser’s offer for our own Install button, once', async () => {
    watchInstall();
    expect(await install()).toBe(false); // nothing offered yet
    window.dispatchEvent(new Event('beforeinstallprompt')); // not a real offer: ignored
    expect(useApp.getState().installable).toBe(false);
    const first = offerEvent('accepted');
    window.dispatchEvent(first.e);
    expect([first.e.defaultPrevented, useApp.getState().installable]).toEqual([true, true]);
    expect(await install()).toBe(true);
    expect([first.prompted(), useApp.getState().installable]).toEqual([1, false]);
    const second = offerEvent('dismissed');
    window.dispatchEvent(second.e);
    expect(await install()).toBe(false);
    window.dispatchEvent(offerEvent('accepted').e);
    window.dispatchEvent(new Event('appinstalled')); // installed from the browser's own menu
    expect(useApp.getState().installable).toBe(false);
  });

  it('knows a browser tab from an installed app, and an iPhone or iPad from the rest', () => {
    expect(isStandalone()).toBe(false);
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true); // iPadOS asks for desktop sites
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 15)', 5)).toBe(false);
  });

  it('suggests installing once, on a touch screen, and points to Settings', async () => {
    await commands.emulateTouch(true);
    await until(() => matchMedia('(pointer: coarse)').matches, 'touch emulation');
    offerInstall(); // nobody to install it for yet (onboarding)
    expect(useApp.getState().toasts).toEqual([]);
    await useApp.getState().createIdentity(newRecoveryPhrase(), 'Ada', 'ada');
    useApp.setState({ standalone: true });
    offerInstall(); // already installed
    expect(useApp.getState().toasts).toEqual([]);
    useApp.setState({ standalone: false });
    await commands.emulateTouch(false);
    await until(() => !matchMedia('(pointer: coarse)').matches, 'a mouse again');
    offerInstall(); // a desktop pointer: nothing to suggest
    expect(useApp.getState().toasts).toEqual([]);
    await commands.emulateTouch(true);
    await until(() => matchMedia('(pointer: coarse)').matches, 'touch emulation');
    offerInstall();
    const [t] = useApp.getState().toasts;
    expect(t?.title).toBe('Install Yurt');
    t?.onAction?.();
    expect([useApp.getState().dialog, useApp.getState().settingsSection]).toEqual(['settings', 'app']);
    useApp.setState({ dialog: null, toasts: [] });
    await until(() => useApp.getState().settings.installHint, 'the hint remembered');
    offerInstall(); // never twice
    expect(useApp.getState().toasts).toEqual([]);
    await commands.emulateTouch(false);
  });

  it('badges the app icon with what needs me, and clears it', () => {
    // Browsers only badge installed apps; in a tab the request is refused, which must not surface as an error.
    setBadge(3);
    setBadge(0);
  });
});

describe('the visible viewport', () => {
  it('sizes the app to it, following resizes (an on-screen keyboard)', async () => {
    trackViewport();
    const height = () => document.documentElement.style.getPropertyValue('--app-height');
    expect(height()).toBe(String(window.visualViewport?.height) + 'px');
    await page.viewport(800, 500);
    await until(() => height() === '500px', 'the new height');
  });
});

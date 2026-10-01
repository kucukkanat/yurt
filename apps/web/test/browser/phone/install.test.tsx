import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { offerInstall } from '../../../src/lib/pwa';
import { startApp, until, useApp } from '../ui/app';

// On a phone (the `phone` test project: a touch screen and an iPhone's user agent): installing Yurt.

describe('installing on a phone', () => {
  it('suggests it once, not to an installed app, and points to Settings', async () => {
    expect(matchMedia('(pointer: coarse)').matches).toBe(true);
    offerInstall(); // nobody to install it for yet (before onboarding)
    expect(useApp.getState().toasts).toEqual([]);
    await startApp({ as: 'Ada' });
    useApp.setState({ standalone: true });
    offerInstall(); // already installed
    expect(useApp.getState().toasts).toEqual([]);
    useApp.setState({ standalone: false });
    offerInstall();
    const [t] = useApp.getState().toasts;
    expect(t?.title).toBe('Install Yurt');
    t?.onAction?.();
    expect([useApp.getState().dialog, useApp.getState().settingsSection]).toEqual(['settings', 'app']);
    await until(() => useApp.getState().settings.installHint, 10_000, 'the hint remembered');
    offerInstall(); // never twice
    expect(useApp.getState().toasts.filter((x) => x.title === 'Install Yurt')).toHaveLength(1);
  });

  it('explains Add to Home Screen on an iPhone', async () => {
    await expect.element(page.getByTestId('app-install-ios')).toBeVisible();
  });
});

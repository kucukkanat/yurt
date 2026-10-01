import { Button } from '@yurt/ui';
import { useApp } from '../store';
import { install, isIos } from '../lib/pwa';
import { Muted, SubHead } from './Settings';

/** Settings → App: installing Yurt on this device. */
export function AppSection() {
  return (
    <div data-testid="app-section" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <SubHead>Install</SubHead>
      <Install />
    </div>
  );
}

function Install() {
  const installable = useApp((s) => s.installable);
  const standalone = useApp((s) => s.standalone);
  if (standalone) return <Muted testId="app-installed">Yurt is installed on this device.</Muted>;
  if (installable)
    return (
      <div>
        <Button variant="primary" iconLeft="download" data-testid="app-install" onClick={() => void install()}>
          Install Yurt
        </Button>
      </div>
    );
  if (isIos(navigator.userAgent, navigator.maxTouchPoints))
    return (
      <ol data-testid="app-install-ios" style={{ margin: 0, paddingLeft: 'var(--space-5)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-body)', lineHeight: 1.6 }}>
        <li>Open Yurt in Safari.</li>
        <li>Tap Share, then Add to Home Screen.</li>
        <li>Open Yurt from your home screen: notifications work from there.</li>
      </ol>
    );
  return <Muted testId="app-install-menu">Use your browser’s menu: Install Yurt, or Add to Home screen.</Muted>;
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import '@yurt/ui/styles.css';
import { App } from './App';
import { Crash } from './ui/Crash';
import { useApp } from './store';
import { installFavicon } from './lib/favicon';
import { faviconStateOf } from './model';
import { getPeer } from './lib/net';
import { isStandalone, offerInstall, setBadge, watchInstall } from './lib/pwa';
import { startServiceWorker } from './lib/swClient';
import { trackViewport } from './lib/viewport';
import { attentive, onAttentionChange } from './lib/visibility';

watchInstall();
trackViewport();
useApp.setState({ standalone: isStandalone() });
void useApp.getState().init();
useApp.subscribe(offerInstall); // it waits for an identity, and offers only once
void startServiceWorker();
const iconState = () => faviconStateOf(useApp.getState(), getPeer, attentive(document));
const favicon = installFavicon(iconState);
const refresh = () => {
  favicon.update();
  setBadge(iconState().mentions); // the home-screen icon counts what the tab icon badges
};
useApp.subscribe(refresh);
onAttentionChange(refresh);
const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
createRoot(root).render(
  <React.StrictMode>
    <Crash>
      <App />
    </Crash>
  </React.StrictMode>,
);

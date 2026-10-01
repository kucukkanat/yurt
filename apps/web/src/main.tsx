import React from 'react';
import { createRoot } from 'react-dom/client';
import '@yurt/ui/styles.css';
import { App } from './App';
import { useApp } from './store';
import { installFavicon } from './lib/favicon';
import { faviconStateOf } from './model';
import { getPeer } from './lib/net';

useApp.getState().init();
const favicon = installFavicon(() => faviconStateOf(useApp.getState(), getPeer, !document.hidden));
useApp.subscribe(() => favicon.update());
document.addEventListener('visibilitychange', () => favicon.update());
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

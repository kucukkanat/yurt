import React from 'react';
import { createRoot } from 'react-dom/client';
import '@yurt/ui/styles.css';
import { App } from './App';

/** Renders the page into `doc`'s #root, talking to the bridge that served it. */
export function mount(doc: Document) {
  const root = doc.getElementById('root');
  if (!root) throw new Error('index.html has no #root element');
  createRoot(root).render(
    <React.StrictMode>
      <App url={`ws://${location.host}/ws`} token={window.__YURT_ADMIN__} />
    </React.StrictMode>,
  );
}

mount(document);

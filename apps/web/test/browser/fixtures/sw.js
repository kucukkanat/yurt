// A service worker with nothing to do, for browser tests: notifications and push subscriptions need a registered
// worker, and the app's real one (src/sw.ts) only exists in the production build.
self.addEventListener('install', () => self.skipWaiting());

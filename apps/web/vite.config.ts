import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project site: https://<user>.github.io/yurt/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.YURT_BASE || '/yurt/' : '/',
  plugins: [
    react({ include: /\.(jsx|tsx)$/ }),
    // An installable app: a manifest, icons made from public/icon.svg, and src/sw.ts (offline shell + Web Push).
    // The page registers the worker itself (lib/pwa.ts) and asks before switching to a new version.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'prompt',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wav}'] },
      pwaAssets: { image: 'public/icon.svg', preset: 'minimal-2023', overrideManifestIcons: true, htmlPreset: '2023', injectThemeColor: false },
      manifest: {
        id: './',
        name: 'Yurt',
        short_name: 'Yurt',
        description: 'Team chat that runs entirely in your browser, peer to peer.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        // The dark theme's page surface (--surface-page), so launch and status bar match the app.
        background_color: '#161614',
        theme_color: '#161614',
        categories: ['social', 'productivity'],
      },
    }),
  ],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: true },
}));

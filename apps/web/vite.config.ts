import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site: https://<user>.github.io/yurt/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.YURT_BASE || '/yurt/' : '/',
  plugins: [react({ include: /\.(jsx|tsx)$/ })],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: true },
}));

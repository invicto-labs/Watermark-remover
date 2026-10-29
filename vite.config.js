import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = process.env.CLEARPAGE_DEV_BACKEND || 'http://127.0.0.1:5055';
const frontend = 'http://127.0.0.1:5173';
function backendProxy() {
  return {
    target: backend,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyRequest, request) => {
        // Only translate our development origin; other origins remain rejected.
        if (request.headers.origin === frontend) proxyRequest.setHeader('Origin', backend);
      });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  root: 'frontend',
  base: command === 'serve' && !isPreview ? '/' : '/static/',
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': backendProxy(),
      '/static': backendProxy(),
    },
  },
  build: {
    outDir: '../static',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: 'ui.js',
        assetFileNames: 'ui.[ext]',
      },
    },
  },
}));

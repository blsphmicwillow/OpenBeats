import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

/** Keeps the standalone splash document on the same version as package.json. */
const versionedHtml = {
  name: 'openbeats-versioned-html',
  transformIndexHtml(html: string) {
    return html.replaceAll('__OPENBEATS_VERSION__', pkg.version);
  },
};

export default defineConfig({
  plugins: [react(), versionedHtml],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: ['.style.dev', 'localhost', '127.0.0.1'],
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        splash: fileURLToPath(new URL('./splash.html', import.meta.url)),
      },
    },
  },
});

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import manifest from './manifest.js';

const root = fileURLToPath(new URL('.', import.meta.url));

// Сборка расширения: npm run ext:build → extension/dist (её и грузим в Chrome).
export default defineConfig({
  root,
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: { popup: `${root}popup.html`, background: `${root}src/background.js` },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
  plugins: [{
    name: 'manifest',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) });
    },
  }],
});

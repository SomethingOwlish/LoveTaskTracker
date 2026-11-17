import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' keeps asset paths relative so the app works whether it's served
// from the domain root or from a GitHub Pages project subpath (/RepoName/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      // Firebase и React меняются редко — отдельным файлом, чтобы при обновлении
      // приложения телефон не скачивал их заново.
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) return 'firebase';
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' keeps asset paths relative so the app works whether it's served
// from the domain root or from a GitHub Pages project subpath (/RepoName/).
export default defineConfig({
  base: './',
  plugins: [react()],
});

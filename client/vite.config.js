import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:1000',
      '/data': 'http://localhost:1000'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});

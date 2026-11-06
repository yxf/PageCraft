import { defineConfig } from 'vite';
export default defineConfig({
  build: { rollupOptions: { input: { panel: 'index.html', options: 'options.html' } } },
  server: { port: 5173, strictPort: true },
});

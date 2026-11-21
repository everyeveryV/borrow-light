import { defineConfig } from 'vite';
export default defineConfig({
  root: 'app',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
});

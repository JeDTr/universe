import { defineConfig } from 'vite';

export default defineConfig({
  // relative base: works at jedtr.github.io/<any-repo-name>/
  base: './',
  build: { target: 'es2022' },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});

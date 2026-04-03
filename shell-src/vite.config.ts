import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  base: './',
  plugins: [tailwindcss(), svelte()],
  build: {
    outDir: resolve(rootDir, '../shell/dist'),
    emptyOutDir: true
  }
});

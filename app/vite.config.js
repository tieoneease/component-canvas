import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from 'tailwindcss';
import { defineConfig } from 'vite';

const appDir = dirname(fileURLToPath(import.meta.url));
const standaloneTailwindConfig = resolve(appDir, 'tailwind.config.js');
const useStandaloneTailwindFallback =
  process.env.COMPONENT_CANVAS_DISABLE_TAILWIND_FALLBACK !== '1';

export default defineConfig({
  plugins: [svelte()],
  css: useStandaloneTailwindFallback
    ? {
        postcss: {
          plugins: [tailwindcss({ config: standaloneTailwindConfig })]
        }
      }
    : undefined
});

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import colors from 'tailwindcss/colors';

const appDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(process.env.COMPONENT_CANVAS_PROJECT_ROOT ?? process.cwd());

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    resolve(appDir, 'index.html'),
    resolve(appDir, 'src/**/*.{js,svelte,ts}'),
    resolve(projectRoot, '.canvas/workflows/**/*.{js,svelte,ts}')
  ],
  theme: {
    extend: {
      colors: {
        border: colors.neutral[200],
        input: colors.neutral[200],
        ring: colors.neutral[400],
        background: colors.neutral[50],
        foreground: colors.neutral[950],
        primary: {
          DEFAULT: colors.neutral[900],
          foreground: colors.neutral[50]
        },
        secondary: {
          DEFAULT: colors.neutral[100],
          foreground: colors.neutral[900]
        },
        muted: {
          DEFAULT: colors.neutral[100],
          foreground: colors.neutral[500]
        },
        accent: {
          DEFAULT: colors.neutral[100],
          foreground: colors.neutral[900]
        },
        destructive: {
          DEFAULT: colors.red[600],
          foreground: colors.white
        },
        card: {
          DEFAULT: colors.white,
          foreground: colors.neutral[950]
        },
        popover: {
          DEFAULT: colors.white,
          foreground: colors.neutral[950]
        }
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.375rem'
      }
    }
  }
};

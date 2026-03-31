import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { startServer } from '../lib/server.ts';

const fixturesDir = resolve(process.cwd(), 'tests/fixtures');

describe('startServer', () => {
  it(
    'starts the canvas app with Vite and serves the app shell',
    async () => {
      const projectRoot = resolve(fixturesDir, 'valid-workflow');
      const server = await startServer({
        canvasDir: resolve(projectRoot, '.canvas'),
        projectRoot
      });

      try {
        expect(server.url).toMatch(/^http:\/\//u);

        const response = await fetch(server.url);
        const html = await response.text();

        expect(response.ok).toBe(true);
        expect(html).toContain('id="app"');
      } finally {
        await expect(server.close()).resolves.toBeUndefined();
      }
    },
    30_000
  );
});

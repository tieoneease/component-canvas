import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

  it(
    'uses the built-in standalone Tailwind config when no project config is provided',
    async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-standalone-'));
      const canvasDir = resolve(projectRoot, '.canvas');
      const workflowDir = resolve(canvasDir, 'workflows', 'welcome');
      let server: Awaited<ReturnType<typeof startServer>> | undefined;

      try {
        await mkdir(workflowDir, { recursive: true });
        await writeFile(
          resolve(workflowDir, 'Card.svelte'),
          '<div class="bg-sky-500 text-white px-4 py-2 rounded-lg">Hello Tailwind</div>\n',
          'utf8'
        );
        await writeFile(
          resolve(workflowDir, '_flow.ts'),
          [
            'export default {',
            "  id: 'welcome',",
            "  title: 'Welcome Flow',",
            '  screens: [',
            '    {',
            "      id: 'card',",
            "      component: './Card.svelte',",
            "      title: 'Card'",
            '    }',
            '  ],',
            '  transitions: []',
            '};',
            ''
          ].join('\n'),
          'utf8'
        );

        server = await startServer({ canvasDir, projectRoot });

        const pageResponse = await fetch(server.url);
        const html = await pageResponse.text();

        expect(pageResponse.ok).toBe(true);
        expect(html).toContain('id="app"');
      } finally {
        if (server) {
          await expect(server.close()).resolves.toBeUndefined();
        }

        await rm(projectRoot, { recursive: true, force: true });
      }
    },
    30_000
  );
});

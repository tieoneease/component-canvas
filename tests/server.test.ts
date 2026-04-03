import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { startServer } from '../lib/server.ts';

const fixturesDir = resolve(process.cwd(), 'tests/fixtures');

describe('startServer', () => {
  it(
    'starts the shell server and serves preview HTML through the mounted preview route',
    async () => {
      const projectRoot = resolve(fixturesDir, 'valid-workflow');
      const server = await startServer({
        canvasDir: resolve(projectRoot, '.canvas'),
        projectRoot
      });

      try {
        expect(server.url).toMatch(/^http:\/\//u);
        expect(server.previewUrl).toMatch(/^http:\/\//u);

        const [shellResponse, previewResponse] = await Promise.all([
          fetch(server.url),
          fetch(server.previewUrl)
        ]);
        const [shellHtml, previewHtml] = await Promise.all([
          shellResponse.text(),
          previewResponse.text()
        ]);

        expect(shellResponse.ok).toBe(true);
        expect(shellHtml).toContain('id="shell-app"');
        expect(previewResponse.ok).toBe(true);
        expect(previewHtml).toContain('id="app"');
      } finally {
        await expect(server.close()).resolves.toBeUndefined();
      }
    },
    30_000
  );

  it(
    'can start from a temporary standalone project with no local vite.config.ts',
    async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-standalone-'));
      const canvasDir = resolve(projectRoot, '.canvas');
      const workflowDir = resolve(canvasDir, 'workflows', 'welcome');
      let server: Awaited<ReturnType<typeof startServer>> | undefined;

      try {
        await mkdir(workflowDir, { recursive: true });
        await writeFile(
          resolve(workflowDir, 'Card.svelte'),
          '<div class="standalone-card">Hello standalone preview</div>\n',
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

        const [shellResponse, previewResponse] = await Promise.all([
          fetch(server.url),
          fetch(server.previewUrl)
        ]);
        const [shellHtml, previewHtml] = await Promise.all([
          shellResponse.text(),
          previewResponse.text()
        ]);

        expect(shellResponse.ok).toBe(true);
        expect(shellHtml).toContain('id="shell-app"');
        expect(previewResponse.ok).toBe(true);
        expect(previewHtml).toContain('id="app"');
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

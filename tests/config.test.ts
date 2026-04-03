import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.ts';
import { startServer } from '../lib/server.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadConfig', () => {
  it('loads project mode fields from canvas.config.ts', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-config-'));
    tempDirs.push(projectRoot);

    await writeCanvasConfig(projectRoot, [
      'export default {',
      "  lib: './src/lib',",
      "  globalCss: './src/global.css',",
      '  mocks: {',
      "    '$env/static/public': './.canvas/mocks/public.ts'",
      '  },',
      '  aliases: {',
      "    '@shared': './src/shared'",
      '  }',
      '};',
      ''
    ]);

    await expect(loadConfig(projectRoot)).resolves.toEqual({
      lib: './src/lib',
      globalCss: './src/global.css',
      mocks: {
        '$env/static/public': './.canvas/mocks/public.ts'
      },
      aliases: {
        '@shared': './src/shared'
      }
    });
  });

  it('loads a valid purity config', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-config-purity-'));
    tempDirs.push(projectRoot);

    await writeCanvasConfig(projectRoot, [
      'export default {',
      '  purity: {',
      "    componentPaths: ['$lib/components/', '$lib/marketing/'],",
      "    forbiddenImports: ['$lib/stores/', '$app/navigation']",
      '  }',
      '};',
      ''
    ]);

    await expect(loadConfig(projectRoot)).resolves.toEqual({
      purity: {
        componentPaths: ['$lib/components/', '$lib/marketing/'],
        forbiddenImports: ['$lib/stores/', '$app/navigation']
      }
    });
  });

  it('rejects purity when it is not an object', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-config-purity-invalid-'));
    tempDirs.push(projectRoot);
    const configPath = resolve(projectRoot, 'canvas.config.ts');

    await writeCanvasConfig(projectRoot, ['export default { purity: "invalid" };', '']);

    await expect(loadConfig(projectRoot)).rejects.toThrow(
      `${configPath} field "purity" must be an object when provided.`
    );
  });

  it('rejects purity.componentPaths entries that are not strings', async () => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), 'component-canvas-config-purity-component-paths-invalid-')
    );
    tempDirs.push(projectRoot);
    const configPath = resolve(projectRoot, 'canvas.config.ts');

    await writeCanvasConfig(projectRoot, [
      'export default {',
      '  purity: {',
      "    componentPaths: ['$lib/components/', 42],",
      "    forbiddenImports: ['$lib/stores/']",
      '  }',
      '};',
      ''
    ]);

    await expect(loadConfig(projectRoot)).rejects.toThrow(
      `${configPath} field "purity.componentPaths[1]" must be a string.`
    );
  });

  it('rejects purity when forbiddenImports is missing', async () => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), 'component-canvas-config-purity-forbidden-imports-missing-')
    );
    tempDirs.push(projectRoot);
    const configPath = resolve(projectRoot, 'canvas.config.ts');

    await writeCanvasConfig(projectRoot, [
      'export default {',
      '  purity: {',
      "    componentPaths: ['$lib/components/']",
      '  }',
      '};',
      ''
    ]);

    await expect(loadConfig(projectRoot)).rejects.toThrow(
      `${configPath} field "purity.forbiddenImports" must be a non-empty array of strings.`
    );
  });

  it('loads successfully when purity is omitted', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-config-no-purity-'));
    tempDirs.push(projectRoot);

    await writeCanvasConfig(projectRoot, ['export default { lib: "./src/lib" };', '']);

    await expect(loadConfig(projectRoot)).resolves.toEqual({
      lib: './src/lib'
    });
  });

  it('returns null when canvas.config.ts is missing', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-config-empty-'));
    tempDirs.push(projectRoot);

    await expect(loadConfig(projectRoot)).resolves.toBeNull();
  });
});

describe('project mode server wiring', () => {
  it(
    'applies config-driven $lib aliases, additional aliases, mocks, Tailwind, and global CSS',
    async () => {
      const projectRoot = await createProjectModeFixture();
      const canvasDir = resolve(projectRoot, '.canvas');
      const server = await startServer({
        canvasDir,
        projectRoot
      });
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];

      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      });
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      try {
        await page.goto(`${server.url}#/workflow/project-mode`, {
          waitUntil: 'domcontentloaded'
        });
        await page.waitForSelector('[data-project-mode-screen]');

        const renderedText = await page.locator('[data-project-mode-screen]').textContent();
        const backgroundColor = await page
          .locator('[data-project-mode-screen]')
          .evaluate((node) => getComputedStyle(node).backgroundColor);
        const globalCssColor = await page
          .locator('[data-global-css]')
          .evaluate((node) => getComputedStyle(node).color);

        expect(renderedText).toContain('Library alias resolved');
        expect(renderedText).toContain('extra alias resolved');
        expect(renderedText).toContain('mocked env value');
        // Tailwind v4 uses oklch color space
        expect(backgroundColor).toContain('oklch');
        expect(globalCssColor).toBe('rgb(20, 184, 166)');
        expect(consoleErrors).toEqual([]);
        expect(pageErrors).toEqual([]);
      } finally {
        await page.close();
        await browser.close();
        await server.close();
      }
    },
    30_000
  );
});

async function writeCanvasConfig(projectRoot: string, lines: string[]): Promise<void> {
  await writeFile(resolve(projectRoot, 'canvas.config.ts'), lines.join('\n'), 'utf8');
}

async function createProjectModeFixture(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-project-mode-'));
  tempDirs.push(projectRoot);

  await mkdir(resolve(projectRoot, '.canvas', 'mocks'), { recursive: true });
  await mkdir(resolve(projectRoot, '.canvas', 'workflows', 'project-mode'), { recursive: true });
  await mkdir(resolve(projectRoot, 'src', 'lib'), { recursive: true });
  await mkdir(resolve(projectRoot, 'src', 'shared'), { recursive: true });

  await writeCanvasConfig(projectRoot, [
    'export default {',
    "  lib: './src/lib',",
    "  globalCss: './src/global.css',",
    '  mocks: {',
    "    '$env/static/public': './.canvas/mocks/public.ts'",
    '  },',
    '  aliases: {',
    "    '@shared': './src/shared'",
    '  }',
    '};',
    ''
  ]);

  await writeFile(
    resolve(projectRoot, 'src', 'global.css'),
    '.project-global-flag { color: rgb(20, 184, 166); }\n',
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, 'src', 'lib', 'SharedBadge.svelte'),
    '<span data-lib-badge>Library alias resolved</span>\n',
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, 'src', 'shared', 'message.ts'),
    "export const sharedMessage = 'extra alias resolved';\n",
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, '.canvas', 'mocks', 'public.ts'),
    "export const PUBLIC_FLAG = 'mocked env value';\n",
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, '.canvas', 'workflows', 'project-mode', 'ProjectScreen.svelte'),
    [
      '<script>',
      "  import SharedBadge from '$lib/SharedBadge.svelte';",
      "  import { sharedMessage } from '@shared/message.ts';",
      "  import { PUBLIC_FLAG } from '$env/static/public';",
      '</script>',
      '',
      '<div data-project-mode-screen class="bg-teal-500 px-4 py-3 text-white">',
      '  <SharedBadge />',
      '  <p data-shared-message>{sharedMessage}</p>',
      '  <p data-mock-flag>{PUBLIC_FLAG}</p>',
      '  <p data-global-css class="project-global-flag">Global CSS loaded</p>',
      '</div>',
      ''
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, '.canvas', 'workflows', 'project-mode', '_flow.ts'),
    [
      'export default {',
      "  id: 'project-mode',",
      "  title: 'Project Mode Flow',",
      '  screens: [',
      '    {',
      "      id: 'project-screen',",
      "      component: './ProjectScreen.svelte',",
      "      title: 'Project Screen'",
      '    }',
      '  ],',
      '  transitions: []',
      '};',
      ''
    ].join('\n'),
    'utf8'
  );

  return projectRoot;
}

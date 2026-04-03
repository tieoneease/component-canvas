import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';

import { generateRenderModule, registerRender } from '../lib/render.ts';
import { startServer } from '../lib/server.ts';
import { createViteConfigSource } from './helpers.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('generateRenderModule', () => {
  it('returns a mountable virtual module that imports the component and serializes props', () => {
    const componentPath = resolve('/tmp/component-canvas-render-test/MessageCard.svelte');
    const moduleSource = generateRenderModule(componentPath, {
      message: 'Hello render',
      count: 3
    });

    expect(moduleSource).toContain("import { mount, unmount } from 'svelte';");
    expect(moduleSource).toContain(`import RenderComponent from ${JSON.stringify(`/@fs/${componentPath.replaceAll('\\', '/')}`)};`);
    expect(moduleSource).toContain('export const props = {');
    expect(moduleSource).toContain('"message": "Hello render"');
    expect(moduleSource).toContain('"count": 3');
    expect(moduleSource).toContain('mount(RenderComponent');
    expect(moduleSource).toContain('export function render(target)');
  });
});

describe('registerRender', () => {
  it(
    'registers a render module on the preview server and serves it through the preview route',
    async () => {
      const projectRoot = await createRenderFixture();
      const componentPath = resolve(projectRoot, 'src', 'MessageCard.svelte');
      const server = await startServer({
        canvasDir: resolve(projectRoot, '.canvas'),
        projectRoot
      });
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        viewport: {
          width: 1280,
          height: 720
        }
      });

      try {
        const registration = registerRender(server.previewServer, componentPath, {
          message: 'Hello render command'
        });
        const renderUrl = new URL(registration.url, server.url).toString();
        const previewResponse = await fetch(renderUrl, {
          signal: AbortSignal.timeout(10_000)
        });
        const previewHtml = await previewResponse.text();

        expect(registration.id).toMatch(/^[a-f0-9]{16}$/u);
        expect(registration.url).toBe(`/preview/#/render/${registration.id}`);
        expect(previewResponse.ok).toBe(true);
        expect(previewHtml).toContain('id="app"');

        await page.goto(renderUrl, {
          waitUntil: 'domcontentloaded'
        });
        await page.waitForSelector('[data-render-message]');

        expect(await page.locator('[data-render-message]').textContent()).toBe('Hello render command');
      } finally {
        await page.close();
        await browser.close();
        await server.close();
      }
    },
    30_000
  );
});

async function createRenderFixture(): Promise<string> {
  const tempRoot = resolve(process.cwd(), 'tests', '.tmp');

  await mkdir(tempRoot, { recursive: true });

  const projectRoot = await mkdtemp(join(tempRoot, 'component-canvas-render-'));
  tempDirs.push(projectRoot);

  await mkdir(resolve(projectRoot, '.canvas'), { recursive: true });
  await mkdir(resolve(projectRoot, 'src'), { recursive: true });
  await writeFile(resolve(projectRoot, 'vite.config.ts'), createViteConfigSource(), 'utf8');
  await writeFile(
    resolve(projectRoot, 'src', 'MessageCard.svelte'),
    [
      '<script lang="ts">',
      '  interface Props {',
      '    message?: string;',
      '  }',
      '',
      "  let { message = 'Default render message' }: Props = $props();",
      '</script>',
      '',
      '<div data-render-message>{message}</div>',
      ''
    ].join('\n'),
    'utf8'
  );

  return projectRoot;
}

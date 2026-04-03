import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadConfig', () => {
  it('loads supported canvas config fields from canvas.config.ts', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-config-'));
    tempDirs.push(projectRoot);

    await writeCanvasConfig(projectRoot, [
      'export default {',
      "  canvasDir: './storybook-canvas',",
      '  mocks: {',
      "    '$env/static/public': './.canvas/mocks/public.ts'",
      '  },',
      '  purity: {',
      "    componentPaths: ['$lib/components/', '$lib/marketing/'],",
      "    forbiddenImports: ['$lib/stores/', '$app/navigation']",
      '  }',
      '};',
      ''
    ]);

    await expect(loadConfig(projectRoot)).resolves.toEqual({
      canvasDir: './storybook-canvas',
      mocks: {
        '$env/static/public': './.canvas/mocks/public.ts'
      },
      purity: {
        componentPaths: ['$lib/components/', '$lib/marketing/'],
        forbiddenImports: ['$lib/stores/', '$app/navigation']
      }
    });
  });

  for (const [field, value] of [
    ['lib', "'./src/lib'"],
    ['aliases', "{ '@shared': './src/shared' }"],
    ['globalCss', "'./src/global.css'"]
  ] as const) {
    it(`rejects removed \"${field}\" field with a helpful error`, async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), `component-canvas-config-removed-${field}-`));
      tempDirs.push(projectRoot);
      const configPath = resolve(projectRoot, 'canvas.config.ts');

      await writeCanvasConfig(projectRoot, ['export default {', `  ${field}: ${value}`, '};', '']);

      await expect(loadConfig(projectRoot)).rejects.toThrow(
        `${configPath} field "${field}" has been removed. canvas.config.ts now only supports "canvasDir", "mocks", and "purity"; project aliases and global CSS should be configured in vite.config.ts.`
      );
    });
  }

  it('rejects unknown fields with a helpful error', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-config-unknown-field-'));
    tempDirs.push(projectRoot);
    const configPath = resolve(projectRoot, 'canvas.config.ts');

    await writeCanvasConfig(projectRoot, ['export default { theme: "dark" };', '']);

    await expect(loadConfig(projectRoot)).rejects.toThrow(
      `${configPath} field "theme" is not supported. canvas.config.ts only supports "canvasDir", "mocks", and "purity".`
    );
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

    await writeCanvasConfig(projectRoot, ['export default { canvasDir: "./canvas" };', '']);

    await expect(loadConfig(projectRoot)).resolves.toEqual({
      canvasDir: './canvas'
    });
  });

  it('returns null when canvas.config.ts is missing', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-config-empty-'));
    tempDirs.push(projectRoot);

    await expect(loadConfig(projectRoot)).resolves.toBeNull();
  });
});

async function writeCanvasConfig(projectRoot: string, lines: string[]): Promise<void> {
  await writeFile(resolve(projectRoot, 'canvas.config.ts'), lines.join('\n'), 'utf8');
}

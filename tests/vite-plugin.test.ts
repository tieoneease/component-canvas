import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import type { Alias, ConfigEnv } from 'vite';

import canvasVitePlugin from '../lib/vite-plugin.ts';

const fixturesDir = resolve(process.cwd(), 'tests/fixtures');
const configEnv: ConfigEnv = {
  command: 'serve',
  mode: 'test',
  isSsrBuild: false,
  isPreview: false
};

describe('canvasVitePlugin', () => {
  it('registers virtual modules and emits workflow component sources', async () => {
    const canvasDir = resolve(fixturesDir, 'valid-workflow/.canvas');
    const plugin = canvasVitePlugin({ canvasDir });

    expect(plugin.name).toBe('component-canvas-vite-plugin');

    const manifestsId = await plugin.resolveId?.('virtual:canvas-manifests');
    const componentsId = await plugin.resolveId?.('virtual:canvas-components');

    expect(manifestsId).toBe('\0component-canvas:manifests');
    expect(componentsId).toBe('\0component-canvas:components');

    const manifestModule = await plugin.load?.call({ warn: vi.fn() } as never, manifestsId!);
    const componentModule = await plugin.load?.call({ warn: vi.fn() } as never, componentsId!);

    expect(manifestModule).toContain('export const workflows =');
    expect(manifestModule).toContain('"id": "login"');
    expect(componentModule).toContain('login/LoginForm');
    expect(componentModule).toContain('/@fs/');
  });

  it('adds fs allow entries, aliases, mocks, and tailwind config through the Vite config hook', () => {
    const projectRoot = resolve(fixturesDir, 'valid-workflow');
    const canvasDir = resolve(projectRoot, '.canvas');
    const plugin = canvasVitePlugin({
      canvasDir,
      projectRoot,
      aliases: {
        '$lib': './src/lib'
      },
      mocks: {
        '$app/environment': './tests/mocks/app-environment.ts'
      },
      tailwindConfig: './tailwind.config.ts',
      globalCss: './src/app.css'
    });

    const config = plugin.config?.({}, configEnv);

    expect(config).toBeDefined();
    expect(config?.server?.fs?.allow).toEqual(
      expect.arrayContaining([
        canvasDir,
        projectRoot,
        resolve(projectRoot, 'src/app.css')
      ])
    );

    const aliases = aliasArrayToMap(config?.resolve?.alias ?? []);
    expect(aliases).toMatchObject({
      '$app/environment': resolve(projectRoot, 'tests/mocks/app-environment.ts'),
      '$lib': resolve(projectRoot, 'src/lib')
    });
    expect(config?.css?.postcss?.plugins).toHaveLength(1);
  });

  it('emits a virtual global CSS module when globalCss is configured', async () => {
    const projectRoot = resolve(fixturesDir, 'valid-workflow');
    const plugin = canvasVitePlugin({
      canvasDir: resolve(projectRoot, '.canvas'),
      projectRoot,
      globalCss: './src/app.css'
    });

    const globalCssId = await plugin.resolveId?.('virtual:canvas-global-css');
    const globalCssModule = await plugin.load?.call({ warn: vi.fn() } as never, globalCssId!);

    expect(globalCssId).toBe('\0component-canvas:global-css');
    expect(globalCssModule).toContain('/@fs/');
    expect(globalCssModule).toContain(resolve(projectRoot, 'src/app.css').replaceAll('\\', '/'));
  });
});

function aliasArrayToMap(alias: Alias[]): Record<string, string> {
  return alias.reduce<Record<string, string>>((entries, entry) => {
    if (typeof entry === 'object' && typeof entry.find === 'string') {
      entries[entry.find] = entry.replacement;
    }

    return entries;
  }, {});
}

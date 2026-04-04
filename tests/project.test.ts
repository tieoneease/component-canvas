import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';

import { composePreviewConfig, loadProjectViteConfig, resolvePackageEntry } from '../lib/project.ts';

const tempDirs: string[] = [];
const repoRoot = process.cwd();

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolvePackageEntry', () => {
  it.each([
    'vite',
    'svelte',
    '@sveltejs/vite-plugin-svelte'
  ])('resolves %s from the nearest ancestor node_modules', async (packageName) => {
    const projectRoot = resolve(repoRoot, 'tests/fixtures/valid-workflow');
    const entry = await resolvePackageEntry(projectRoot, packageName);
    const expectedDir = resolve(repoRoot, 'node_modules', ...getPackageNameSegments(packageName));
    const expectedVersion = await readPackageVersion(expectedDir);

    expect(entry.dir).toBe(expectedDir);
    expect(entry.version).toBe(expectedVersion);
    expect(new URL(entry.url).protocol).toBe('file:');
    expect(fileURLToPath(entry.url).startsWith(expectedDir)).toBe(true);

    const importedModule = await import(entry.url);

    expect(importedModule).toBeTypeOf('object');

    if (packageName === 'vite') {
      expect(importedModule.loadConfigFromFile).toBeTypeOf('function');
    }

    if (packageName === '@sveltejs/vite-plugin-svelte') {
      expect(importedModule.svelte).toBeTypeOf('function');
    }
  });

  it('throws a helpful error when the package cannot be found', async () => {
    const projectRoot = resolve(repoRoot, 'tests/fixtures/valid-workflow');

    await expect(resolvePackageEntry(projectRoot, 'definitely-missing-package')).rejects.toThrow(
      'Unable to find package "definitely-missing-package"'
    );
  });
});

describe('loadProjectViteConfig', () => {
  it('loads the project vite.config.ts with the project-resolved Vite module and strips build', async () => {
    const projectRoot = await createRepoTempProject('component-canvas-project-config-');

    await writeFile(
      resolve(projectRoot, 'vite.config.ts'),
      [
        "import { defineConfig } from 'vite';",
        '',
        'export default defineConfig({',
        "  build: { outDir: 'ignored-build' },",
        "  resolve: { alias: { '@demo': '/virtual/demo' } },",
        "  server: { host: '127.0.0.1' }",
        '});',
        ''
      ].join('\n'),
      'utf8'
    );

    const config = await loadProjectViteConfig(projectRoot);

    expect(config).not.toBeNull();
    expect(config).toMatchObject({
      resolve: {
        alias: {
          '@demo': '/virtual/demo'
        }
      },
      server: {
        host: '127.0.0.1'
      }
    });
    expect(config).not.toHaveProperty('build');
  });

  it('returns null when no vite.config file exists', async () => {
    const projectRoot = await createRepoTempProject('component-canvas-project-empty-');

    await expect(loadProjectViteConfig(projectRoot)).resolves.toBeNull();
  });
});

describe('composePreviewConfig', () => {
  it('merges the stripped project config with canvas plugins and preview server defaults', async () => {
    const projectRoot = await createRepoTempProject('component-canvas-preview-config-');
    const allowedPath = resolve(projectRoot, 'allowed');

    await writeFile(
      resolve(projectRoot, 'vite.config.ts'),
      [
        "import { defineConfig } from 'vite';",
        '',
        'export default defineConfig({',
        "  build: { outDir: 'ignored-build' },",
        "  plugins: [{ name: 'user-plugin' }],",
        `  resolve: { alias: { '@demo': ${JSON.stringify(allowedPath)} } },`,
        `  server: { fs: { allow: [${JSON.stringify(allowedPath)}] } }`,
        '});',
        ''
      ].join('\n'),
      'utf8'
    );

    const canvasPlugin: Plugin = { name: 'canvas-plugin' };
    const config = await composePreviewConfig(projectRoot, [canvasPlugin]);

    expect(config.configFile).toBe(false);
    expect(config).not.toHaveProperty('build');
    // Project alias is preserved, svelte dedupe is added for pnpm compat
    expect(config.resolve?.dedupe).toContain('svelte');
    expect(config.resolve?.alias).toMatchObject({ '@demo': allowedPath });
    expect(config.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'user-plugin' }),
        expect.objectContaining({ name: 'canvas-plugin' })
      ])
    );
    expect(config.server?.fs?.allow).toEqual(expect.arrayContaining([allowedPath, projectRoot]));
  });
});

async function createRepoTempProject(prefix: string): Promise<string> {
  const tempRoot = resolve(repoRoot, 'tests', '.tmp');

  await mkdir(tempRoot, { recursive: true });

  const projectRoot = await mkdtemp(join(tempRoot, prefix));
  tempDirs.push(projectRoot);

  return projectRoot;
}

async function readPackageVersion(packageDir: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8')) as {
    version: string;
  };

  return packageJson.version;
}

function getPackageNameSegments(packageName: string): string[] {
  const segments = packageName.split('/');

  if (packageName.startsWith('@')) {
    return segments.slice(0, 2);
  }

  return [segments[0]];
}

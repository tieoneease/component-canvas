import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createResolveFromExportsCache,
  resolveFromExports,
  resolveFromProject
} from '../lib/resolve-plugin.ts';

interface PackageFixture {
  packageJson?: unknown;
  rawPackageJson?: string;
  files?: string[];
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolveFromExports', () => {
  it('resolves a bare package when exports is a string', async () => {
    const { nodeModulesDir } = await createNodeModulesFixture({
      svelte: {
        packageJson: {
          name: 'svelte',
          exports: './src/index.js'
        },
        files: ['src/index.js']
      }
    });

    await expect(resolveFromExports(nodeModulesDir, 'svelte')).resolves.toBe(
      resolve(nodeModulesDir, 'svelte', 'src/index.js')
    );
  });

  it('prefers import.default when resolving nested export conditions', async () => {
    const { nodeModulesDir } = await createNodeModulesFixture({
      vite: {
        packageJson: {
          name: 'vite',
          exports: {
            '.': {
              import: {
                default: './dist/index.mjs'
              },
              default: './dist/index.js'
            }
          }
        },
        files: ['dist/index.mjs', 'dist/index.js']
      }
    });

    await expect(resolveFromExports(nodeModulesDir, 'vite')).resolves.toBe(
      resolve(nodeModulesDir, 'vite', 'dist/index.mjs')
    );
  });

  it('prefers browser when import is absent', async () => {
    const { nodeModulesDir } = await createNodeModulesFixture({
      svelte: {
        packageJson: {
          name: 'svelte',
          exports: {
            '.': {
              browser: './src/index-client.js',
              default: './src/index-server.js'
            }
          }
        },
        files: ['src/index-client.js', 'src/index-server.js']
      }
    });

    await expect(resolveFromExports(nodeModulesDir, 'svelte')).resolves.toBe(
      resolve(nodeModulesDir, 'svelte', 'src/index-client.js')
    );
  });

  it('resolves explicit subpath exports', async () => {
    const { nodeModulesDir } = await createNodeModulesFixture({
      svelte: {
        packageJson: {
          name: 'svelte',
          exports: {
            './internal/client': {
              import: './src/internal/client.js'
            }
          }
        },
        files: ['src/internal/client.js']
      }
    });

    await expect(resolveFromExports(nodeModulesDir, 'svelte/internal/client')).resolves.toBe(
      resolve(nodeModulesDir, 'svelte', 'src/internal/client.js')
    );
  });

  it('resolves wildcard subpath exports', async () => {
    const { nodeModulesDir } = await createNodeModulesFixture({
      svelte: {
        packageJson: {
          name: 'svelte',
          exports: {
            './internal/*': {
              import: './src/internal/*.js'
            }
          }
        },
        files: ['src/internal/disclose-version.js']
      }
    });

    await expect(resolveFromExports(nodeModulesDir, 'svelte/internal/disclose-version')).resolves.toBe(
      resolve(nodeModulesDir, 'svelte', 'src/internal/disclose-version.js')
    );
  });

  it('resolves scoped packages', async () => {
    const { nodeModulesDir } = await createNodeModulesFixture({
      '@scope/pkg': {
        packageJson: {
          name: '@scope/pkg',
          exports: {
            './feature': {
              default: './dist/feature.js'
            }
          }
        },
        files: ['dist/feature.js']
      }
    });

    await expect(resolveFromExports(nodeModulesDir, '@scope/pkg/feature')).resolves.toBe(
      resolve(nodeModulesDir, '@scope/pkg', 'dist/feature.js')
    );
  });

  it('returns null when the package is missing', async () => {
    const { nodeModulesDir } = await createNodeModulesFixture({});

    await expect(resolveFromExports(nodeModulesDir, 'svelte')).resolves.toBeNull();
  });

  it('returns null when package.json is malformed', async () => {
    const { nodeModulesDir } = await createNodeModulesFixture({
      broken: {
        rawPackageJson: '{ this is not valid json',
        files: ['index.js']
      }
    });

    await expect(resolveFromExports(nodeModulesDir, 'broken')).resolves.toBeNull();
  });

  it('does not reuse cache across independent resolveFromExports calls', async () => {
    const { nodeModulesDir } = await createNodeModulesFixture({
      cached: {
        packageJson: {
          name: 'cached',
          exports: './dist/index.js'
        },
        files: ['dist/index.js']
      }
    });
    const packageJsonPath = resolve(nodeModulesDir, 'cached', 'package.json');

    await expect(resolveFromExports(nodeModulesDir, 'cached')).resolves.toBe(
      resolve(nodeModulesDir, 'cached', 'dist/index.js')
    );
    await writeFile(packageJsonPath, '{ now broken', 'utf8');
    await expect(resolveFromExports(nodeModulesDir, 'cached')).resolves.toBeNull();
  });

  it('caches repeated specifier resolutions when given an explicit cache', async () => {
    const { nodeModulesDir } = await createNodeModulesFixture({
      cached: {
        packageJson: {
          name: 'cached',
          exports: './dist/index.js'
        },
        files: ['dist/index.js']
      }
    });
    const packageJsonPath = resolve(nodeModulesDir, 'cached', 'package.json');
    const cache = createResolveFromExportsCache();

    const firstResolution = await resolveFromExports(nodeModulesDir, 'cached', cache);
    await writeFile(packageJsonPath, '{ now broken', 'utf8');
    const secondResolution = await resolveFromExports(nodeModulesDir, 'cached', cache);

    expect(firstResolution).toBe(resolve(nodeModulesDir, 'cached', 'dist/index.js'));
    expect(secondResolution).toBe(firstResolution);
  });
});

describe('resolveFromProject', () => {
  it('walks up from the project root to find node_modules and only resolves targeted packages', async () => {
    const { rootDir } = await createNodeModulesFixture({
      svelte: {
        packageJson: {
          name: 'svelte',
          exports: {
            '.': './src/index.js',
            './internal/client': {
              import: './src/internal/client.js'
            }
          }
        },
        files: ['src/index.js', 'src/internal/client.js']
      }
    });
    const projectRoot = resolve(rootDir, 'apps', 'demo', 'src');

    await mkdir(projectRoot, { recursive: true });

    const plugin = resolveFromProject(projectRoot, ['svelte']);

    expect(plugin.enforce).toBe('pre');
    await expect(plugin.resolveId?.('svelte')).resolves.toBe(
      resolve(rootDir, 'node_modules', 'svelte', 'src/index.js')
    );
    await expect(plugin.resolveId?.('svelte/internal/client')).resolves.toBe(
      resolve(rootDir, 'node_modules', 'svelte', 'src/internal/client.js')
    );
    await expect(plugin.resolveId?.('vite')).resolves.toBeNull();
  });
});

async function createNodeModulesFixture(
  packages: Record<string, PackageFixture>
): Promise<{ rootDir: string; nodeModulesDir: string }> {
  const rootDir = await mkdtemp(join(tmpdir(), 'component-canvas-resolve-plugin-'));
  const nodeModulesDir = resolve(rootDir, 'node_modules');

  tempDirs.push(rootDir);
  await mkdir(nodeModulesDir, { recursive: true });

  for (const [packageName, fixture] of Object.entries(packages)) {
    await writePackage(nodeModulesDir, packageName, fixture);
  }

  return { rootDir, nodeModulesDir };
}

async function writePackage(
  nodeModulesDir: string,
  packageName: string,
  fixture: PackageFixture
): Promise<void> {
  const packageDir = resolve(nodeModulesDir, ...packageName.split('/'));

  await mkdir(packageDir, { recursive: true });

  if (fixture.rawPackageJson !== undefined) {
    await writeFile(resolve(packageDir, 'package.json'), fixture.rawPackageJson, 'utf8');
  } else if (fixture.packageJson !== undefined) {
    await writeFile(
      resolve(packageDir, 'package.json'),
      `${JSON.stringify(fixture.packageJson, null, 2)}\n`,
      'utf8'
    );
  }

  for (const file of fixture.files ?? []) {
    const filePath = resolve(packageDir, file);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '// fixture\n', 'utf8');
  }
}

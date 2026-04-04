import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { Plugin, UserConfig } from 'vite';

import { isPlainObject, pathExists } from './utils.ts';

interface PackageMetadata {
  dir: string;
  exports: unknown;
  module?: string;
  main?: string;
}

interface ParsedSpecifier {
  packageName: string;
  subpath: string;
}

interface ExportMatch {
  entry: unknown;
  captures: string[];
}

export interface ResolveFromExportsCache {
  resolutionCache: Map<string, Promise<string | null>>;
  packageMetadataCache: Map<string, Promise<PackageMetadata | null>>;
  realpathCache: Map<string, Promise<string>>;
}

export function createResolveFromExportsCache(): ResolveFromExportsCache {
  return {
    resolutionCache: new Map<string, Promise<string | null>>(),
    packageMetadataCache: new Map<string, Promise<PackageMetadata | null>>(),
    realpathCache: new Map<string, Promise<string>>()
  };
}

export function resolveFromProject(
  projectRoot: string,
  packages: string[],
  fallbackSearchPaths: string[] = []
): Plugin {
  const targetedPackages = [...new Set(packages)];
  let nodeModulesDirPromise: Promise<string | null> | undefined;
  const pluginCache = new Map<string, Promise<string | null>>();
  const resolveFromExportsCache = createResolveFromExportsCache();

  return {
    name: 'resolve-from-project',
    enforce: 'pre',

    async config(): Promise<UserConfig> {
      const nodeModulesDir = await (nodeModulesDirPromise ??= findNearestNodeModulesDir(
        projectRoot,
        fallbackSearchPaths
      ));

      if (!nodeModulesDir) {
        return {};
      }

      // esbuild (Vite's dep optimizer) inlines svelte internals into dep chunks
      // (bits-ui, lucide-svelte, etc.) creating duplicate runtime state that
      // mount() never initializes. Fix: externalize svelte imports when they
      // appear as dependencies of OTHER packages (args.kind === 'import-statement'
      // with an importer), but NOT when svelte is the entry point itself
      // (args.kind === 'entry-point'). This prevents inlining while allowing
      // svelte to be pre-bundled as its own chunk.
      const escapedNames = targetedPackages.map((name) => escapeRegExp(name));
      const esbuildFilter = new RegExp(`^(?:${escapedNames.join('|')})(?:/|$)`);

      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: 'canvas-externalize-svelte-in-deps',
                setup(build) {
                  build.onResolve({ filter: esbuildFilter }, async (args) => {
                    // Let entry points be bundled normally (svelte itself)
                    if (args.kind === 'entry-point') return undefined;
                    // Externalize svelte imports from other packages so
                    // they reference the shared runtime module at runtime
                    return { path: args.path, external: true };
                  });
                }
              }
            ]
          }
        }
      };
    },

    async resolveId(source) {
      if (!matchesTargetedPackage(source, targetedPackages)) {
        return null;
      }

      const cached = pluginCache.get(source);
      if (cached) {
        return cached;
      }

      const pending = (async () => {
        const nodeModulesDir = await (nodeModulesDirPromise ??= findNearestNodeModulesDir(
          projectRoot,
          fallbackSearchPaths
        ));

        if (!nodeModulesDir) {
          return null;
        }

        return resolveFromExports(nodeModulesDir, source, resolveFromExportsCache);
      })();

      pluginCache.set(source, pending);
      return pending;
    }
  };
}

export async function resolveFromExports(
  nodeModulesDir: string,
  specifier: string,
  cache: ResolveFromExportsCache = createResolveFromExportsCache()
): Promise<string | null> {
  const cacheKey = `${resolve(nodeModulesDir)}\0${specifier}`;
  const cached = cache.resolutionCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const parsedSpecifier = parsePackageSpecifier(specifier);
    if (!parsedSpecifier) {
      return null;
    }

    // Use realpath to dereference pnpm symlinks. Vite's default
    // preserveSymlinks:false means it resolves served files to their real
    // paths. Relative imports from those files produce real-path-based
    // module IDs. Our resolveId must return matching real paths so Vite
    // sees one module instance, not two (symlink vs real).
    const symlinkDir = resolve(nodeModulesDir, ...parsedSpecifier.packageName.split('/'));
    const packageDir = await dereferencePackageDir(symlinkDir, cache);
    const packageMetadata = await loadPackageMetadata(packageDir, cache);

    if (!packageMetadata) {
      return null;
    }

    const exportMatch = findExportMatch(packageMetadata.exports, parsedSpecifier.subpath);
    const exportTarget = exportMatch ? resolveExportTarget(exportMatch.entry, exportMatch.captures) : null;

    if (exportTarget) {
      return resolve(packageDir, exportTarget);
    }

    const legacyTarget = resolveLegacyTarget(packageMetadata, parsedSpecifier.subpath);
    return legacyTarget ? resolve(packageDir, legacyTarget) : null;
  })();

  cache.resolutionCache.set(cacheKey, pending);
  return pending;
}

async function findNearestNodeModulesDir(
  startDir: string,
  fallbackSearchPaths: string[] = []
): Promise<string | null> {
  const searchRoots = [...new Set([startDir, ...fallbackSearchPaths].map((searchRoot) => resolve(searchRoot)))];

  for (const searchRoot of searchRoots) {
    const nodeModulesDir = await findNearestNodeModulesDirFromRoot(searchRoot);

    if (nodeModulesDir) {
      return nodeModulesDir;
    }
  }

  return null;
}

async function findNearestNodeModulesDirFromRoot(startDir: string): Promise<string | null> {
  let currentDir = resolve(startDir);

  while (true) {
    const candidate = join(currentDir, 'node_modules');

    if (await pathExists(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function matchesTargetedPackage(source: string, packages: string[]): boolean {
  return packages.some((packageName) => source === packageName || source.startsWith(`${packageName}/`));
}

function parsePackageSpecifier(specifier: string): ParsedSpecifier | null {
  const parts = specifier.split('/');

  if (specifier.startsWith('@')) {
    if (parts.length < 2 || parts[0].length === 0 || parts[1].length === 0) {
      return null;
    }

    return {
      packageName: parts.slice(0, 2).join('/'),
      subpath: parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.'
    };
  }

  if (parts[0].length === 0) {
    return null;
  }

  return {
    packageName: parts[0],
    subpath: parts.length > 1 ? `./${parts.slice(1).join('/')}` : '.'
  };
}

async function dereferencePackageDir(
  symlinkDir: string,
  cache: ResolveFromExportsCache
): Promise<string> {
  const key = resolve(symlinkDir);
  const cached = cache.realpathCache.get(key);

  if (cached) {
    return cached;
  }

  const pending = realpath(symlinkDir).catch(() => key);
  cache.realpathCache.set(key, pending);
  return pending;
}

async function loadPackageMetadata(
  packageDir: string,
  cache: ResolveFromExportsCache
): Promise<PackageMetadata | null> {
  const cacheKey = resolve(packageDir);
  const cached = cache.packageMetadataCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = (async () => {
    try {
      const rawPackageJson = await readFile(join(cacheKey, 'package.json'), 'utf8');
      const packageJson = JSON.parse(rawPackageJson) as unknown;

      if (!isPlainObject(packageJson)) {
        return null;
      }

      return {
        dir: cacheKey,
        exports: packageJson.exports,
        module: typeof packageJson.module === 'string' ? packageJson.module : undefined,
        main: typeof packageJson.main === 'string' ? packageJson.main : undefined
      } satisfies PackageMetadata;
    } catch {
      return null;
    }
  })();

  cache.packageMetadataCache.set(cacheKey, pending);
  return pending;
}

function findExportMatch(exportsField: unknown, subpath: string): ExportMatch | null {
  if (subpath === '.') {
    if (typeof exportsField === 'string') {
      return { entry: exportsField, captures: [] };
    }

    if (!isPlainObject(exportsField)) {
      return null;
    }

    const exportMap = exportsField as Record<string, unknown>;
    const exportKeys = Object.keys(exportMap);
    const hasSubpathKeys = exportKeys.some((key) => key === '.' || key.startsWith('./'));

    if (!hasSubpathKeys) {
      return { entry: exportMap, captures: [] };
    }

    if (Object.prototype.hasOwnProperty.call(exportMap, '.')) {
      return { entry: exportMap['.'], captures: [] };
    }

    return null;
  }

  if (!isPlainObject(exportsField)) {
    return null;
  }

  const exportMap = exportsField as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(exportMap, subpath)) {
    return { entry: exportMap[subpath], captures: [] };
  }

  return findWildcardExportMatch(exportMap, subpath);
}

function findWildcardExportMatch(
  exportMap: Record<string, unknown>,
  subpath: string
): ExportMatch | null {
  const candidatePatterns = Object.keys(exportMap)
    .filter((key) => key.startsWith('./') && key.includes('*'))
    .sort((left, right) => right.length - left.length);

  for (const pattern of candidatePatterns) {
    const captures = matchWildcardPattern(pattern, subpath);

    if (captures) {
      return {
        entry: exportMap[pattern],
        captures
      };
    }
  }

  return null;
}

function matchWildcardPattern(pattern: string, subpath: string): string[] | null {
  const expression = new RegExp(
    `^${pattern.split('*').map(escapeRegExp).join('(.*)')}$`,
    'u'
  );
  const match = expression.exec(subpath);

  return match ? match.slice(1) : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function resolveExportTarget(entry: unknown, captures: string[]): string | null {
  const target = pickExportTarget(entry);

  if (!target) {
    return null;
  }

  return applyWildcardCaptures(target, captures);
}

function pickExportTarget(entry: unknown): string | null {
  if (typeof entry === 'string') {
    return entry;
  }

  if (!isPlainObject(entry)) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const importDefaultTarget = readNestedDefaultTarget(record.import);

  if (importDefaultTarget) {
    return importDefaultTarget;
  }

  const importTarget = readDirectTarget(record.import);

  if (importTarget) {
    return importTarget;
  }

  const browserDefaultTarget = readNestedDefaultTarget(record.browser);

  if (browserDefaultTarget) {
    return browserDefaultTarget;
  }

  const browserTarget = readDirectTarget(record.browser);

  if (browserTarget) {
    return browserTarget;
  }

  const defaultTarget = readDirectTarget(record.default);

  if (defaultTarget) {
    return defaultTarget;
  }

  return null;
}

function readNestedDefaultTarget(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(record, 'default')) {
    return null;
  }

  return readDirectTarget(record.default);
}

function readDirectTarget(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (!isPlainObject(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(record, 'default')) {
    return null;
  }

  return typeof record.default === 'string' ? record.default : null;
}

function applyWildcardCaptures(target: string, captures: string[]): string {
  let captureIndex = 0;

  return target.replace(/\*/gu, () => captures[captureIndex++] ?? '');
}

function resolveLegacyTarget(packageMetadata: PackageMetadata, subpath: string): string | null {
  if (packageMetadata.exports !== undefined) {
    if (subpath !== '.') {
      return null;
    }

    return packageMetadata.module ?? packageMetadata.main ?? null;
  }

  if (subpath === '.') {
    return packageMetadata.module ?? packageMetadata.main ?? 'index.js';
  }

  return subpath.startsWith('./') ? subpath.slice(2) : null;
}

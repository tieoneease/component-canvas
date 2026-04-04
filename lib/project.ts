import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { mergeConfig, type InlineConfig, type Plugin, type PluginOption, type UserConfig } from 'vite';

import { isPlainObject, pathExists } from './utils.ts';

interface PackageJson {
  version?: unknown;
  exports?: unknown;
  module?: unknown;
  main?: unknown;
}

type LoadConfigFromFile = (typeof import('vite'))['loadConfigFromFile'];

const PROJECT_CONFIG_ENV = {
  command: 'serve',
  mode: 'development',
  isSsrBuild: false,
  isPreview: false
} as const;

export async function resolvePackageEntry(
  projectRoot: string,
  packageName: string,
  fallbackSearchPaths: string[] = []
): Promise<{ dir: string; url: string; version: string }> {
  const resolvedProjectRoot = resolve(projectRoot);
  const packageDir = await findPackageDir(resolvedProjectRoot, packageName, fallbackSearchPaths);
  const packageJson = await readPackageJson(packageDir);
  const version = getStringField(packageJson.version);
  const entry = resolvePackageJsonEntry(packageJson);

  if (!version) {
    throw new Error(`Package "${packageName}" at "${packageDir}" is missing a string "version" field.`);
  }

  if (!entry) {
    throw new Error(`Package "${packageName}" at "${packageDir}" does not expose a resolvable entry.`);
  }

  return {
    dir: packageDir,
    url: pathToFileURL(resolve(packageDir, entry)).href,
    version
  };
}

export async function loadProjectViteConfig(
  projectRoot: string,
  fallbackSearchPaths: string[] = []
): Promise<UserConfig | null> {
  const resolvedProjectRoot = resolve(projectRoot);
  const viteEntry = await resolvePackageEntry(resolvedProjectRoot, 'vite', fallbackSearchPaths);
  const viteModule = (await import(viteEntry.url)) as {
    loadConfigFromFile?: LoadConfigFromFile;
  };

  if (typeof viteModule.loadConfigFromFile !== 'function') {
    throw new Error(`Resolved Vite module "${viteEntry.url}" does not export loadConfigFromFile().`);
  }

  const loadedConfig = await viteModule.loadConfigFromFile(
    PROJECT_CONFIG_ENV,
    undefined,
    resolvedProjectRoot,
    'silent'
  );

  if (!loadedConfig) {
    return null;
  }

  const { build: _build, ...configWithoutBuild } = loadedConfig.config;

  return configWithoutBuild;
}

export async function composePreviewConfig(
  projectRoot: string,
  canvasPlugins: Plugin[],
  fallbackSearchPaths: string[] = []
): Promise<InlineConfig> {
  const resolvedProjectRoot = resolve(projectRoot);
  const projectConfig = await loadProjectViteConfig(resolvedProjectRoot, fallbackSearchPaths);
  const canvasConfig: InlineConfig = {
    configFile: false,
    plugins: [...canvasPlugins],
    resolve: {
      // dedupe ensures Vite always resolves svelte to one copy.
      // No resolve.alias here — aliases interfere with the resolveFromProject
      // plugin's resolveId hook (Vite applies aliases before resolveId, producing
      // incorrect subpath resolution). The esbuild plugin in resolveFromProject
      // handles the dep optimizer; the resolveId hook handles runtime.
      dedupe: ['svelte']
    },
    server: {
      fs: {
        allow: [resolvedProjectRoot]
      }
    }
  };
  const mergedConfig = mergeConfig(projectConfig ?? {}, canvasConfig) as InlineConfig;
  let projectPlugins = await resolvePluginOptions(projectConfig?.plugins);

  // SvelteKit projects use sveltekit() which wraps the Svelte compiler with
  // SvelteKit-specific transforms (routing, layouts, guard plugins, virtual
  // modules, etc.) that block or break compilation of standalone .svelte files
  // in .canvas/. The SvelteKit guard plugin rejects files outside its expected
  // directories, and the SvelteKit compile plugin applies Kit-specific transforms.
  //
  // Fix: strip ALL SvelteKit-specific plugins and replace with the bare svelte()
  // plugin from @sveltejs/vite-plugin-svelte. This compiles .svelte files
  // without SvelteKit-specific behavior. Non-SvelteKit svelte plugins are kept.
  const hasSvelteKitPlugins = projectPlugins.some((p) => isSvelteKitPlugin(p));

  if (hasSvelteKitPlugins) {
    projectPlugins = projectPlugins.filter((p) => !isSveltePlugin(p));
    const sveltePlugin = await loadBareSveltePlugin(resolvedProjectRoot, fallbackSearchPaths);
    if (sveltePlugin) {
      projectPlugins = [...sveltePlugin, ...projectPlugins];
    }
    // SvelteKit provides the $lib alias (src/lib). When we strip SvelteKit
    // plugins we lose it. Re-add if the directory exists.
    await addSvelteKitAliases(resolvedProjectRoot, mergedConfig);
  } else if (!projectPlugins.some((p) => isSveltePlugin(p))) {
    // No Svelte plugin at all — add bare svelte() as fallback
    const sveltePlugin = await loadBareSveltePlugin(resolvedProjectRoot, fallbackSearchPaths);
    if (sveltePlugin) {
      projectPlugins = [...sveltePlugin, ...projectPlugins];
    }
  }

  if (canvasPlugins.length > 0 || projectPlugins.length > 0) {
    mergedConfig.plugins = [...canvasPlugins, ...projectPlugins];
  }

  return mergedConfig;
}

async function resolvePluginOptions(plugins: PluginOption | undefined): Promise<Plugin[]> {
  if (!plugins) {
    return [];
  }

  // Handle Promises (e.g., sveltekit() returns a Promise)
  if (plugins instanceof Promise) {
    try {
      const resolved = await plugins;
      return resolvePluginOptions(resolved as PluginOption);
    } catch {
      return [];
    }
  }

  if (Array.isArray(plugins)) {
    const results = await Promise.all(plugins.map((entry) => resolvePluginOptions(entry as PluginOption)));
    return results.flat();
  }

  return typeof plugins === 'object' && plugins !== null && 'name' in plugins
    ? [plugins as Plugin]
    : [];
}

async function addSvelteKitAliases(
  projectRoot: string,
  config: InlineConfig
): Promise<void> {
  const libDir = resolve(projectRoot, 'src', 'lib');

  if (!(await pathExists(libDir))) {
    return;
  }

  // Merge $lib alias into the existing resolve.alias config
  const existingAlias = config.resolve?.alias;
  const libAlias = { find: '$lib', replacement: libDir };

  if (!config.resolve) {
    config.resolve = {};
  }

  if (Array.isArray(existingAlias)) {
    existingAlias.push(libAlias);
  } else if (existingAlias && typeof existingAlias === 'object') {
    (existingAlias as Record<string, string>)['$lib'] = libDir;
  } else {
    config.resolve.alias = [libAlias];
  }
}

function isSveltePlugin(plugin: Plugin): boolean {
  const name = plugin.name?.toLowerCase() ?? '';
  return name.includes('svelte') && !name.includes('pwa');
}

function isSvelteKitPlugin(plugin: Plugin): boolean {
  const name = plugin.name?.toLowerCase() ?? '';
  return name.includes('sveltekit') || name.includes('svelte-kit');
}

async function loadBareSveltePlugin(
  projectRoot: string,
  fallbackSearchPaths: string[]
): Promise<Plugin[] | null> {
  try {
    const entry = await resolvePackageEntry(projectRoot, '@sveltejs/vite-plugin-svelte', fallbackSearchPaths);
    const mod = await import(entry.url) as { svelte?: (...args: unknown[]) => Plugin | Plugin[] };
    if (typeof mod.svelte === 'function') {
      const result = mod.svelte();
      return Array.isArray(result) ? result : [result];
    }
  } catch {
    // @sveltejs/vite-plugin-svelte not available
  }
  return null;
}

async function findPackageDir(
  projectRoot: string,
  packageName: string,
  fallbackSearchPaths: string[] = []
): Promise<string> {
  const packageSegments = getPackageNameSegments(packageName);
  const searchRoots = getPackageSearchRoots(projectRoot, fallbackSearchPaths);

  for (const searchRoot of searchRoots) {
    const packageDir = await findPackageDirFromRoot(searchRoot, packageSegments);

    if (packageDir) {
      return packageDir;
    }
  }

  throw new Error(`Unable to find package "${packageName}" from project root "${projectRoot}".`);
}

function getPackageSearchRoots(projectRoot: string, fallbackSearchPaths: string[]): string[] {
  return [...new Set([projectRoot, ...fallbackSearchPaths].map((searchRoot) => resolve(searchRoot)))];
}

async function findPackageDirFromRoot(
  searchRoot: string,
  packageSegments: string[]
): Promise<string | null> {
  let currentDir = resolve(searchRoot);

  while (true) {
    const candidateDir = join(currentDir, 'node_modules', ...packageSegments);
    const packageJsonPath = join(candidateDir, 'package.json');

    if (await pathExists(packageJsonPath)) {
      return candidateDir;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function getPackageNameSegments(packageName: string): string[] {
  const segments = packageName.split('/');

  if (packageName.startsWith('@')) {
    return segments.slice(0, 2);
  }

  return [segments[0]];
}

async function readPackageJson(packageDir: string): Promise<PackageJson> {
  const packageJsonPath = join(packageDir, 'package.json');
  const packageJsonSource = await readFile(packageJsonPath, 'utf8');

  return JSON.parse(packageJsonSource) as PackageJson;
}

function resolvePackageJsonEntry(packageJson: PackageJson): string | null {
  const exportsEntry = getRootExportsEntry(packageJson.exports);

  return (
    resolveExportEntry(exportsEntry) ??
    getStringField(packageJson.module) ??
    getStringField(packageJson.main)
  );
}

function getRootExportsEntry(exportsField: unknown): unknown {
  if (typeof exportsField === 'string') {
    return exportsField;
  }

  if (!isPlainObject(exportsField)) {
    return undefined;
  }

  if (Object.hasOwn(exportsField, '.')) {
    return exportsField['.'];
  }

  return exportsField;
}

function resolveExportEntry(entry: unknown): string | null {
  if (typeof entry === 'string') {
    return entry;
  }

  if (!isPlainObject(entry)) {
    return null;
  }

  const importValue = entry.import;
  const importDefaultValue = isPlainObject(importValue) ? importValue.default : undefined;

  return (
    getStringField(importDefaultValue) ??
    getStringField(importValue) ??
    getStringField(entry.default) ??
    resolveExportEntry(importValue) ??
    resolveExportEntry(entry.default)
  );
}

function getStringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

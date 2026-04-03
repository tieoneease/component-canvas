import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { mergeConfig, type InlineConfig, type Plugin, type UserConfig } from 'vite';

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
  packageName: string
): Promise<{ dir: string; url: string; version: string }> {
  const resolvedProjectRoot = resolve(projectRoot);
  const packageDir = await findPackageDir(resolvedProjectRoot, packageName);
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

export async function loadProjectViteConfig(projectRoot: string): Promise<UserConfig | null> {
  const resolvedProjectRoot = resolve(projectRoot);
  const viteEntry = await resolvePackageEntry(resolvedProjectRoot, 'vite');
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
  canvasPlugins: Plugin[]
): Promise<InlineConfig> {
  const resolvedProjectRoot = resolve(projectRoot);
  const projectConfig = await loadProjectViteConfig(resolvedProjectRoot);
  const canvasConfig: InlineConfig = {
    configFile: false,
    plugins: [...canvasPlugins],
    server: {
      fs: {
        allow: [resolvedProjectRoot]
      }
    }
  };

  return mergeConfig(projectConfig ?? {}, canvasConfig) as InlineConfig;
}

async function findPackageDir(projectRoot: string, packageName: string): Promise<string> {
  const packageSegments = getPackageNameSegments(packageName);
  let currentDir = resolve(projectRoot);

  while (true) {
    const candidateDir = join(currentDir, 'node_modules', ...packageSegments);
    const packageJsonPath = join(candidateDir, 'package.json');

    if (await pathExists(packageJsonPath)) {
      return candidateDir;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  throw new Error(`Unable to find package "${packageName}" from project root "${projectRoot}".`);
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

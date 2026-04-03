import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { normalizePath, type Alias, type Plugin, type UserConfig, type ViteDevServer } from 'vite';

import { SvelteAdapter, type ComponentEntry, type PurityConfig } from './adapter.ts';
import { parseWorkflowManifests } from './manifest.ts';

export interface CanvasVitePluginOptions {
  canvasDir: string;
  projectRoot?: string;
  aliases?: Record<string, string>;
  mocks?: Record<string, string>;
  globalCss?: string;
  purity?: PurityConfig;
}

const MANIFESTS_MODULE_ID = 'virtual:canvas-manifests';
const COMPONENTS_MODULE_ID = 'virtual:canvas-components';
const GLOBAL_CSS_MODULE_ID = 'virtual:canvas-global-css';

const RESOLVED_MANIFESTS_MODULE_ID = '\0component-canvas:manifests';
const RESOLVED_COMPONENTS_MODULE_ID = '\0component-canvas:components';
const RESOLVED_GLOBAL_CSS_MODULE_ID = '\0component-canvas:global-css';

export default function canvasVitePlugin(options: CanvasVitePluginOptions): Plugin {
  const resolvedCanvasDir = resolve(options.canvasDir);
  const resolvedProjectRoot = options.projectRoot ? resolve(options.projectRoot) : undefined;
  const baseDir = resolvedProjectRoot ?? dirname(resolvedCanvasDir);
  const resolvedAliases = createAliasEntries(options.aliases, baseDir);
  const resolvedMocks = createAliasEntries(options.mocks, baseDir);
  const resolvedGlobalCss = options.globalCss ? resolvePathOption(options.globalCss, baseDir) : undefined;
  const resolvedPurityComponentPaths = options.purity
    ? resolvePurityComponentPaths(options.purity.componentPaths, [...resolvedMocks, ...resolvedAliases], baseDir)
    : [];

  return {
    name: 'component-canvas-vite-plugin',
    enforce: 'pre',

    config(): UserConfig {
      const allow = uniqueStrings([resolvedCanvasDir, resolvedProjectRoot, resolvedGlobalCss]);
      const alias = [...resolvedMocks, ...resolvedAliases];
      const config: UserConfig = {};

      if (allow.length > 0) {
        config.server = {
          fs: {
            allow
          }
        };
      }

      if (alias.length > 0) {
        config.resolve = {
          alias
        };
      }

      return config;
    },

    resolveId(source, importer) {
      if (source === MANIFESTS_MODULE_ID) {
        return RESOLVED_MANIFESTS_MODULE_ID;
      }

      if (source === COMPONENTS_MODULE_ID) {
        return RESOLVED_COMPONENTS_MODULE_ID;
      }

      if (source === GLOBAL_CSS_MODULE_ID) {
        return RESOLVED_GLOBAL_CSS_MODULE_ID;
      }

      if (
        importer &&
        options.purity &&
        isPurityViolation(source, importer, options.purity, resolvedPurityComponentPaths)
      ) {
        this.error(formatPurityError(source, importer, options.purity));
      }

      return null;
    },

    async load(id) {
      if (id === RESOLVED_MANIFESTS_MODULE_ID) {
        return loadManifestsModule(this.warn.bind(this), resolvedCanvasDir);
      }

      if (id === RESOLVED_COMPONENTS_MODULE_ID) {
        return loadComponentsModule(resolvedCanvasDir);
      }

      if (id === RESOLVED_GLOBAL_CSS_MODULE_ID) {
        return loadGlobalCssModule(resolvedGlobalCss);
      }

      return null;
    },

    handleHotUpdate(context) {
      const changedFile = normalizePath(resolve(context.file));
      const canvasChanged = isPathInside(changedFile, resolvedCanvasDir);
      const globalCssChanged = resolvedGlobalCss ? changedFile === normalizePath(resolvedGlobalCss) : false;

      if (!canvasChanged && !globalCssChanged) {
        return;
      }

      invalidateVirtualModule(context.server, RESOLVED_MANIFESTS_MODULE_ID);
      invalidateVirtualModule(context.server, RESOLVED_COMPONENTS_MODULE_ID);

      if (globalCssChanged) {
        invalidateVirtualModule(context.server, RESOLVED_GLOBAL_CSS_MODULE_ID);
      }

      context.server.ws.send({ type: 'full-reload' });
    }
  };
}

async function loadManifestsModule(
  warn: (message: string) => void,
  canvasDir: string
): Promise<string> {
  const result = await parseWorkflowManifests(canvasDir);

  for (const error of result.errors) {
    warn(`[component-canvas] ${error.file}: ${error.message}`);
  }

  return [
    `export const workflows = ${JSON.stringify(result.workflows, null, 2)};`,
    `export const errors = ${JSON.stringify(result.errors, null, 2)};`,
    'export default workflows;'
  ].join('\n');
}

async function loadComponentsModule(canvasDir: string): Promise<string> {
  const components = await collectComponents(canvasDir);
  const adapter = new SvelteAdapter();

  return adapter.generateComponentModule(components);
}

export function isPurityViolation(
  source: string,
  importer: string,
  rules: PurityConfig,
  resolvedComponentPaths: string[]
): boolean {
  if (!resolvedComponentPaths.some((componentPath) => isPathInside(importer, componentPath))) {
    return false;
  }

  return rules.forbiddenImports.some((forbiddenImport) => matchesSpecifierPrefix(source, forbiddenImport));
}

export function formatPurityError(source: string, importer: string, rules: PurityConfig): string {
  const matchedComponentPath = rules.componentPaths[0] ?? '<unknown>';
  const matchedForbiddenImport =
    rules.forbiddenImports.find((forbiddenImport) => matchesSpecifierPrefix(source, forbiddenImport)) ??
    rules.forbiddenImports[0] ??
    source;

  return [
    `Purity violation: ${importer} cannot import from '${source}'`,
    `  Rule: components in '${matchedComponentPath}' may not import from '${matchedForbiddenImport}'`,
    '  Fix: lift this import to the page shell that renders this component.'
  ].join('\n');
}

function loadGlobalCssModule(globalCssPath?: string): string {
  if (!globalCssPath) {
    return 'export default undefined;';
  }

  const fsImportPath = toFsImportPath(globalCssPath);

  return [`import ${JSON.stringify(fsImportPath)};`, `export default ${JSON.stringify(fsImportPath)};`].join('\n');
}

async function collectComponents(canvasDir: string): Promise<ComponentEntry[]> {
  const workflowsDir = resolve(canvasDir, 'workflows');

  if (!(await pathExists(workflowsDir))) {
    return [];
  }

  const workflowEntries = await readdir(workflowsDir, { withFileTypes: true });
  const workflowDirs = workflowEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(workflowsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const components: ComponentEntry[] = [];

  for (const workflowDir of workflowDirs) {
    const workflowId = await resolveWorkflowId(workflowDir);
    const svelteFiles = await listSvelteFiles(workflowDir);

    for (const componentFile of svelteFiles) {
      const componentName = normalizePath(relative(workflowDir, componentFile)).replace(/\.svelte$/u, '');

      components.push({
        key: `${workflowId}/${componentName}`,
        absolutePath: componentFile
      });
    }
  }

  return components.sort((left, right) => left.key.localeCompare(right.key));
}

async function resolveWorkflowId(workflowDir: string): Promise<string> {
  const manifestFile = join(workflowDir, '_flow.ts');

  if (!(await pathExists(manifestFile))) {
    return basename(workflowDir);
  }

  try {
    const manifestModule = await importFreshModule(manifestFile);
    const manifest = getDefaultExport(manifestModule);

    if (isPlainObject(manifest) && isNonEmptyString(manifest.id)) {
      return manifest.id;
    }
  } catch {
    // Fall back to the workflow directory name if the manifest cannot be read yet.
  }

  return basename(workflowDir);
}

async function listSvelteFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listSvelteFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.svelte')) {
      files.push(resolve(fullPath));
    }
  }

  return files;
}

function createAliasEntries(entries: Record<string, string> | undefined, baseDir: string): Alias[] {
  return Object.entries(entries ?? {}).map(([find, replacement]) => ({
    find,
    replacement: resolvePathOption(replacement, baseDir)
  }));
}

function resolvePurityComponentPaths(
  componentPaths: string[],
  aliases: Alias[],
  baseDir: string
): string[] {
  return uniqueStrings(
    componentPaths
      .map((componentPath) => resolvePurityComponentPath(componentPath, aliases, baseDir))
      .filter((componentPath): componentPath is string => componentPath !== undefined)
  );
}

function resolvePurityComponentPath(
  componentPath: string,
  aliases: Alias[],
  baseDir: string
): string | undefined {
  const matchedAlias = aliases.find(
    (alias): alias is Alias & { find: string; replacement: string } =>
      typeof alias.find === 'string' &&
      typeof alias.replacement === 'string' &&
      matchesSpecifierPrefix(componentPath, alias.find)
  );

  if (matchedAlias) {
    if (!isAbsolute(matchedAlias.replacement)) {
      return undefined;
    }

    const suffix = componentPath.slice(matchedAlias.find.length).replace(/^\/+/, '');
    return normalizePath(suffix.length > 0 ? resolve(matchedAlias.replacement, suffix) : resolve(matchedAlias.replacement));
  }

  if (isAbsolute(componentPath) || componentPath.startsWith('.')) {
    return normalizePath(resolve(baseDir, componentPath));
  }

  return undefined;
}

function resolvePathOption(value: string, baseDir: string): string {
  if (isAbsolute(value) || value.startsWith('.')) {
    return resolve(baseDir, value);
  }

  return value;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

function matchesSpecifierPrefix(source: string, prefix: string): boolean {
  if (prefix.endsWith('/')) {
    return source.startsWith(prefix);
  }

  return source === prefix || source.startsWith(`${prefix}/`);
}

function invalidateVirtualModule(server: ViteDevServer, moduleId: string): void {
  const module = server.moduleGraph.getModuleById(moduleId);

  if (module) {
    server.moduleGraph.invalidateModule(module);
  }
}

function toFsImportPath(path: string): string {
  return `/@fs/${normalizePath(resolve(path))}`;
}

function isPathInside(path: string, directory: string): boolean {
  const normalizedPath = normalizePath(resolve(path));
  const normalizedDirectory = normalizePath(resolve(directory));

  return normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`);
}

async function importFreshModule(modulePath: string): Promise<unknown> {
  const { pathToFileURL } = await import('node:url');
  const { stat } = await import('node:fs/promises');
  const moduleUrl = pathToFileURL(modulePath);
  const stats = await stat(modulePath);

  moduleUrl.searchParams.set('t', String(stats.mtimeMs));

  return import(moduleUrl.href);
}

function getDefaultExport(module: unknown): unknown {
  if (isPlainObject(module) && 'default' in module) {
    return module.default;
  }

  return undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

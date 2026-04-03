import { readdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  normalizePath,
  type Alias,
  type Connect,
  type Plugin,
  type UserConfig,
  type ViteDevServer
} from 'vite';

import { SvelteAdapter, type ComponentEntry, type PurityConfig } from './adapter.ts';
import {
  getRenderIdFromResolvedModuleId,
  RENDER_MODULE_ID_PREFIX,
  RESOLVED_RENDER_MODULE_ID_PREFIX,
  type RenderRegistry
} from './render.ts';
import {
  type ParseWorkflowManifestsResult,
  parseWorkflowManifests
} from './manifest.ts';
import {
  getErrorMessage,
  importFreshModule,
  isNonEmptyString,
  isPlainObject,
  pathExists,
  toFsImportPath
} from './utils.ts';

export interface CanvasVitePluginOptions {
  canvasDir: string;
  projectRoot?: string;
  aliases?: Record<string, string>;
  mocks?: Record<string, string>;
  globalCss?: string;
  purity?: PurityConfig;
  renderRegistry?: RenderRegistry;
}

const MANIFESTS_MODULE_ID = 'virtual:canvas-manifests';
const COMPONENTS_MODULE_ID = 'virtual:canvas-components';
const GLOBAL_CSS_MODULE_ID = 'virtual:canvas-global-css';
const PREVIEW_MODULE_ID = 'virtual:canvas-preview';

const RESOLVED_MANIFESTS_MODULE_ID = '\0component-canvas:manifests';
const RESOLVED_COMPONENTS_MODULE_ID = '\0component-canvas:components';
const RESOLVED_GLOBAL_CSS_MODULE_ID = '\0component-canvas:global-css';
const RESOLVED_PREVIEW_MODULE_ID = '\0component-canvas:preview';

interface ManifestStreamState {
  connections: Set<ServerResponse>;
}

const manifestStreams = new Map<string, ManifestStreamState>();

export default function canvasVitePlugin(options: CanvasVitePluginOptions): Plugin {
  const resolvedCanvasDir = resolve(options.canvasDir);
  const resolvedProjectRoot = options.projectRoot ? resolve(options.projectRoot) : undefined;
  const baseDir = resolvedProjectRoot ?? dirname(resolvedCanvasDir);
  const resolvedAliases = createAliasEntries(options.aliases, baseDir);
  const resolvedMocks = createAliasEntries(options.mocks, baseDir);
  const resolvedGlobalCss = options.globalCss ? resolvePathOption(options.globalCss, baseDir) : undefined;
  const purityAliases = [...resolvedMocks, ...resolvedAliases];
  const resolvedPurityComponentPaths = options.purity
    ? resolveIndexedPurityPaths(options.purity.componentPaths, purityAliases, baseDir)
    : [];
  const resolvedPurityForbiddenImportPaths = options.purity
    ? resolvePurityPaths(options.purity.forbiddenImports, purityAliases, baseDir)
    : [];

  return {
    name: 'component-canvas-vite-plugin',
    enforce: 'pre',

    config(): UserConfig {
      const allow = uniqueStrings([
        resolvedCanvasDir,
        resolvedProjectRoot,
        toAllowPath(resolvedGlobalCss)
      ]);
      const config: UserConfig = {};

      if (allow.length > 0) {
        config.server = {
          fs: {
            allow
          }
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

      if (source === PREVIEW_MODULE_ID) {
        return RESOLVED_PREVIEW_MODULE_ID;
      }

      if (source.startsWith(RENDER_MODULE_ID_PREFIX)) {
        return `${RESOLVED_RENDER_MODULE_ID_PREFIX}${source.slice(RENDER_MODULE_ID_PREFIX.length)}`;
      }

      if (
        importer &&
        options.purity &&
        isPurityViolation(
          source,
          importer,
          options.purity,
          resolvedPurityComponentPaths,
          resolvedPurityForbiddenImportPaths
        )
      ) {
        this.error(
          formatPurityError(source, importer, options.purity, resolvedPurityComponentPaths)
        );
      }

      const mockedSource = resolveAliasedPath(source, resolvedMocks);

      if (mockedSource) {
        return mockedSource;
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

      if (id === RESOLVED_PREVIEW_MODULE_ID) {
        return loadPreviewModule();
      }

      const renderId = getRenderIdFromResolvedModuleId(id);

      if (renderId !== null) {
        return loadRenderModule(renderId, options.renderRegistry);
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

      if (canvasChanged) {
        void notifyManifestUpdate(resolvedCanvasDir);
      }

      context.server.ws.send({ type: 'full-reload' });
    }
  };
}

export function createPreviewMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathname = getRequestPath(req);

    if (
      req.method !== 'GET' ||
      pathname.startsWith('/api/') ||
      hasFileExtension(pathname)
    ) {
      next();
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(getPreviewHtml());
  };
}

export function createSSEMiddleware(canvasDir: string): Connect.NextHandleFunction {
  const resolvedCanvasDir = resolve(canvasDir);

  return (req, res, next) => {
    if (req.method !== 'GET' || getRequestPath(req) !== '/api/manifests/stream') {
      next();
      return;
    }

    void handleSSEConnection(req, res, resolvedCanvasDir).catch(next);
  };
}

export function createManifestsAPIMiddleware(canvasDir: string): Connect.NextHandleFunction {
  const resolvedCanvasDir = resolve(canvasDir);

  return (req, res, next) => {
    if (req.method !== 'GET' || getRequestPath(req) !== '/api/manifests') {
      next();
      return;
    }

    void handleManifestsAPIRequest(res, resolvedCanvasDir).catch(next);
  };
}

async function handleSSEConnection(
  req: IncomingMessage,
  res: ServerResponse,
  canvasDir: string
): Promise<void> {
  const state = getManifestStreamState(canvasDir);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  state.connections.add(res);
  writeSSEPayload(res, await serializeManifestPayload(canvasDir));

  const cleanup = () => {
    state.connections.delete(res);
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
}

async function handleManifestsAPIRequest(
  res: ServerResponse,
  canvasDir: string
): Promise<void> {
  const payload = await serializeManifestPayload(canvasDir);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(payload);
}

async function notifyManifestUpdate(canvasDir: string): Promise<void> {
  const state = manifestStreams.get(normalizeCanvasDir(canvasDir));

  if (!state || state.connections.size === 0) {
    return;
  }

  const payload = await serializeManifestPayload(canvasDir);

  for (const connection of [...state.connections]) {
    if (connection.writableEnded || connection.destroyed) {
      state.connections.delete(connection);
      continue;
    }

    try {
      writeSSEPayload(connection, payload);
    } catch {
      state.connections.delete(connection);
    }
  }
}

async function serializeManifestPayload(canvasDir: string): Promise<string> {
  const result = await readManifestData(canvasDir);
  return JSON.stringify(result);
}

async function readManifestData(canvasDir: string): Promise<ParseWorkflowManifestsResult> {
  try {
    return await parseWorkflowManifests(canvasDir);
  } catch (error) {
    return {
      workflows: [],
      errors: [
        {
          file: resolve(canvasDir),
          message: `Failed to parse manifests: ${getErrorMessage(error)}`
        }
      ]
    };
  }
}

function getManifestStreamState(canvasDir: string): ManifestStreamState {
  const normalizedCanvasDir = normalizeCanvasDir(canvasDir);
  const existing = manifestStreams.get(normalizedCanvasDir);

  if (existing) {
    return existing;
  }

  const created: ManifestStreamState = {
    connections: new Set<ServerResponse>()
  };

  manifestStreams.set(normalizedCanvasDir, created);
  return created;
}

function normalizeCanvasDir(canvasDir: string): string {
  return normalizePath(resolve(canvasDir));
}

function writeSSEPayload(res: ServerResponse, payload: string): void {
  res.write(`data: ${payload}\n\n`);
}

async function loadManifestsModule(
  warn: (message: string) => void,
  canvasDir: string
): Promise<string> {
  const result = await readManifestData(canvasDir);

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

function loadPreviewModule(): string {
  return [
    "import { mount, unmount } from 'svelte';",
    `import { workflows, errors as manifestErrors } from ${JSON.stringify(MANIFESTS_MODULE_ID)};`,
    `import components from ${JSON.stringify(COMPONENTS_MODULE_ID)};`,
    `import ${JSON.stringify(GLOBAL_CSS_MODULE_ID)};`,
    '',
    'const appTarget = document.getElementById("app");',
    'const workflowList = Array.isArray(workflows) ? workflows : [];',
    'const manifestIssues = Array.isArray(manifestErrors) ? manifestErrors : [];',
    'const componentRegistry = components ?? {};',
    'let mountedComponent = null;',
    'let renderVersion = 0;',
    '',
    'ensurePreviewStyles();',
    'window.addEventListener("hashchange", () => {',
    '  void renderRoute();',
    '});',
    'void renderRoute();',
    '',
    'async function renderRoute() {',
    '  const version = ++renderVersion;',
    '',
    '  if (!appTarget) {',
    '    return;',
    '  }',
    '',
    '  clearMount();',
    '',
    '  const route = parseRoute(window.location.hash || "#/");',
    '',
    '  if (route.type === "screen") {',
    '    const resolved = resolveScreen(route.workflowId, route.screenId);',
    '',
    '    if (!resolved.component) {',
    '      renderMessage("Screen not found", resolved.message);',
    '      return;',
    '    }',
    '',
    '    document.title = resolved.screen.title ?? resolved.screen.id;',
    '    mountedComponent = mount(resolved.component, {',
    '      target: appTarget,',
    '      props: resolved.screen.props ?? {}',
    '    });',
    '    return;',
    '  }',
    '',
    '  if (route.type === "render") {',
    '    await renderRegisteredPreview(route.renderId, version);',
    '    return;',
    '  }',
    '',
    '  if (manifestIssues.length > 0) {',
    '    renderManifestIssues();',
    '    return;',
    '  }',
    '',
    '  renderMessage(',
    '    "Preview route not found",',
    '    "Use #/screen/<workflowId>/<screenId> or #/render/<id>."',
    '  );',
    '}',
    '',
    'function parseRoute(hash) {',
    '  const normalizedHash = hash.replace(/^#/, "") || "/";',
    '  const screenMatch = normalizedHash.match(/^\\/screen\\/([^/]+)\\/([^/]+)$/u);',
    '',
    '  if (screenMatch) {',
    '    return {',
    '      type: "screen",',
    '      workflowId: decodeURIComponent(screenMatch[1]),',
    '      screenId: decodeURIComponent(screenMatch[2])',
    '    };',
    '  }',
    '',
    '  const renderMatch = normalizedHash.match(/^\\/render\\/([^/]+)$/u);',
    '',
    '  if (renderMatch) {',
    '    return {',
    '      type: "render",',
    '      renderId: decodeURIComponent(renderMatch[1])',
    '    };',
    '  }',
    '',
    '  return { type: "not-found" };',
    '}',
    '',
    'function resolveScreen(workflowId, screenId) {',
    '  const workflow = workflowList.find((entry) => entry.id === workflowId) ?? null;',
    '',
    '  if (!workflow) {',
    '    return {',
    '      component: null,',
    '      screen: null,',
    '      message: `Workflow ${workflowId} could not be found.`',
    '    };',
    '  }',
    '',
    '  const screen = workflow.screens.find((entry) => entry.id === screenId) ?? null;',
    '',
    '  if (!screen) {',
    '    return {',
    '      component: null,',
    '      screen: null,',
    '      message: `Screen ${screenId} could not be found in workflow ${workflowId}.`',
    '    };',
    '  }',
    '',
    '  const componentKey = `${workflow.id}/${String(screen.component)',
    '    .replace(/^\\.\\//u, "")',
    '    .replace(/\\\\/gu, "/")',
    '    .replace(/\\.svelte$/u, "")}`;',
    '  const component = componentRegistry[componentKey] ?? null;',
    '',
    '  if (!component) {',
    '    return {',
    '      component: null,',
    '      screen,',
    '      message: `Component ${componentKey} is not registered.`',
    '    };',
    '  }',
    '',
    '  return { component, screen, message: "" };',
    '}',
    '',
    'async function renderRegisteredPreview(renderId, version) {',
    '  try {',
    '    const renderModule = await import(/* @vite-ignore */ resolveRenderModuleImportUrl(renderId));',
    '',
    '    if (version !== renderVersion || !appTarget) {',
    '      return;',
    '    }',
    '',
    '    if (typeof renderModule.render === "function") {',
    '      const cleanup = await renderModule.render(appTarget);',
    '',
    '      if (version !== renderVersion) {',
    '        if (typeof cleanup === "function") {',
    '          cleanup();',
    '        }',
    '        return;',
    '      }',
    '',
    '      if (typeof cleanup === "function") {',
    '        mountedComponent = {',
    '          $destroy: cleanup',
    '        };',
    '      }',
    '',
    '      document.title = `Render ${renderId}`;',
    '      return;',
    '    }',
    '',
    '    const PreviewComponent = renderModule.component ?? renderModule.default ?? null;',
    '',
    '    if (!PreviewComponent) {',
    '      renderMessage("Render not found", `Could not resolve render ${renderId}.`);',
    '      return;',
    '    }',
    '',
    '    const props = isRecord(renderModule.props) ? renderModule.props : {};',
    '',
    '    mountedComponent = mount(PreviewComponent, {',
    '      target: appTarget,',
    '      props',
    '    });',
    '    document.title = `Render ${renderId}`;',
    '  } catch (error) {',
    '    if (version !== renderVersion) {',
    '      return;',
    '    }',
    '',
    '    renderMessage(',
    '      "Render not found",',
    '      `Could not resolve render ${renderId}: ${formatError(error)}`',
    '    );',
    '  }',
    '}',
    '',
    'function clearMount() {',
    '  if (mountedComponent) {',
    '    try {',
    '      unmount(mountedComponent);',
    '    } catch {',
    '      mountedComponent.$destroy?.();',
    '    }',
    '',
    '    mountedComponent = null;',
    '  }',
    '',
    '  appTarget.innerHTML = "";',
    '}',
    '',
    'function renderManifestIssues() {',
    '  const items = manifestIssues',
    '    .map((issue) => {',
    '      return `<li><strong>${escapeHtml(issue.file)}</strong><span>${escapeHtml(issue.message)}</span></li>`;',
    '    })',
    '    .join("");',
    '',
    '  appTarget.innerHTML = `',
    '    <section class="component-canvas-preview__message component-canvas-preview__message--issues">',
    '      <div class="component-canvas-preview__card">',
    '        <h1>Manifest issues</h1>',
    '        <ul class="component-canvas-preview__issues">${items}</ul>',
    '      </div>',
    '    </section>',
    '  `;',
    '  document.title = "Manifest issues";',
    '}',
    '',
    'function renderMessage(title, message) {',
    '  appTarget.innerHTML = `',
    '    <section class="component-canvas-preview__message">',
    '      <div class="component-canvas-preview__card">',
    '        <h1>${escapeHtml(title)}</h1>',
    '        <p>${escapeHtml(message)}</p>',
    '      </div>',
    '    </section>',
    '  `;',
    '  document.title = title;',
    '}',
    '',
    'function ensurePreviewStyles() {',
    '  if (document.getElementById("component-canvas-preview-styles")) {',
    '    return;',
    '  }',
    '',
    '  const style = document.createElement("style");',
    '  style.id = "component-canvas-preview-styles";',
    '  style.textContent = `',
    '    html, body {',
    '      min-height: 100%;',
    '      margin: 0;',
    '      background: #ffffff;',
    '      color: #0f172a;',
    '      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '    }',
    '',
    '    #app {',
    '      min-height: 100vh;',
    '    }',
    '',
    '    .component-canvas-preview__message {',
    '      box-sizing: border-box;',
    '      display: grid;',
    '      min-height: 100vh;',
    '      place-items: center;',
    '      padding: 2rem;',
    '    }',
    '',
    '    .component-canvas-preview__card {',
    '      width: min(100%, 42rem);',
    '      border: 1px solid rgba(148, 163, 184, 0.32);',
    '      border-radius: 24px;',
    '      background: rgba(255, 255, 255, 0.92);',
    '      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.12);',
    '      padding: 1.5rem;',
    '    }',
    '',
    '    .component-canvas-preview__card h1,',
    '    .component-canvas-preview__card p {',
    '      margin: 0;',
    '    }',
    '',
    '    .component-canvas-preview__card p {',
    '      margin-top: 0.75rem;',
    '      color: #475569;',
    '      line-height: 1.6;',
    '    }',
    '',
    '    .component-canvas-preview__issues {',
    '      list-style: none;',
    '      display: grid;',
    '      gap: 0.75rem;',
    '      margin: 1rem 0 0;',
    '      padding: 0;',
    '    }',
    '',
    '    .component-canvas-preview__issues li {',
    '      display: grid;',
    '      gap: 0.2rem;',
    '      padding: 0.9rem 1rem;',
    '      border-radius: 16px;',
    '      background: #f8fafc;',
    '    }',
    '',
    '    .component-canvas-preview__issues strong {',
    '      font-size: 0.95rem;',
    '      word-break: break-all;',
    '    }',
    '  `;',
    '',
    '  document.head.append(style);',
    '}',
    '',
    'function escapeHtml(value) {',
    '  return String(value)',
    '    .replace(/&/gu, "&amp;")',
    '    .replace(/</gu, "&lt;")',
    '    .replace(/>/gu, "&gt;")',
    '    .replace(/"/gu, "&quot;")',
    '    .replace(/\'/gu, "&#39;");',
    '}',
    '',
    'function isRecord(value) {',
    '  return typeof value === "object" && value !== null && !Array.isArray(value);',
    '}',
    '',
    'function resolveRenderModuleImportUrl(renderId) {',
    '  return `/preview/@id/__x00__component-canvas:render-${encodeURIComponent(renderId)}`;',
    '}',
    '',
    'function formatError(error) {',
    '  return error instanceof Error ? error.message : String(error);',
    '}'
  ].join('\n');
}

function loadRenderModule(renderId: string, renderRegistry: RenderRegistry | undefined): string {
  const registeredModule = renderRegistry?.get(renderId);

  if (registeredModule) {
    return registeredModule;
  }

  return `throw new Error(${JSON.stringify(`Render ${renderId} is not registered.`)});`;
}

export function isPurityViolation(
  source: string,
  importer: string,
  rules: PurityConfig,
  resolvedComponentPaths: Array<string | undefined>,
  resolvedForbiddenImportPaths: string[] = []
): boolean {
  if (findMatchedPurityComponentPathIndex(importer, resolvedComponentPaths) < 0) {
    return false;
  }

  return (
    rules.forbiddenImports.some((forbiddenImport) => matchesSpecifierPrefix(source, forbiddenImport)) ||
    resolvedForbiddenImportPaths.some((forbiddenImportPath) =>
      matchesResolvedSpecifierPath(source, importer, forbiddenImportPath)
    )
  );
}

export function formatPurityError(
  source: string,
  importer: string,
  rules: PurityConfig,
  resolvedComponentPaths: Array<string | undefined> = []
): string {
  const matchedComponentPathIndex = findMatchedPurityComponentPathIndex(importer, resolvedComponentPaths);
  const matchedComponentPath =
    (matchedComponentPathIndex >= 0 ? rules.componentPaths[matchedComponentPathIndex] : undefined) ??
    rules.componentPaths[0] ??
    '<unknown>';
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

function resolveIndexedPurityPaths(
  paths: string[],
  aliases: Alias[],
  baseDir: string
): Array<string | undefined> {
  return paths.map((path) => resolvePurityPath(path, aliases, baseDir));
}

function resolvePurityPaths(paths: string[], aliases: Alias[], baseDir: string): string[] {
  return uniqueStrings(paths.map((path) => resolvePurityPath(path, aliases, baseDir)));
}

function resolvePurityPath(path: string, aliases: Alias[], baseDir: string): string | undefined {
  const matchedAlias = aliases.find(
    (alias): alias is Alias & { find: string; replacement: string } =>
      typeof alias.find === 'string' &&
      typeof alias.replacement === 'string' &&
      matchesSpecifierPrefix(path, alias.find)
  );

  if (matchedAlias) {
    if (!isAbsolute(matchedAlias.replacement)) {
      return undefined;
    }

    const suffix = path.slice(matchedAlias.find.length).replace(/^\/+/, '');
    return normalizeComparablePath(
      suffix.length > 0 ? resolve(matchedAlias.replacement, suffix) : resolve(matchedAlias.replacement)
    );
  }

  if (isAbsolute(path) || path.startsWith('.')) {
    return normalizeComparablePath(resolve(baseDir, path));
  }

  return undefined;
}

function resolveAliasedPath(source: string, aliases: Alias[]): string | null {
  const matchedAlias = aliases.find(
    (alias): alias is Alias & { find: string; replacement: string } =>
      typeof alias.find === 'string' &&
      typeof alias.replacement === 'string' &&
      matchesSpecifierPrefix(source, alias.find)
  );

  if (!matchedAlias) {
    return null;
  }

  const suffix = source.slice(matchedAlias.find.length).replace(/^\/+/, '');

  if (isAbsolute(matchedAlias.replacement)) {
    return normalizePath(
      suffix.length > 0 ? resolve(matchedAlias.replacement, suffix) : resolve(matchedAlias.replacement)
    );
  }

  return suffix.length > 0
    ? `${matchedAlias.replacement.replace(/\/+$/u, '')}/${suffix}`
    : matchedAlias.replacement;
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

function toAllowPath(value: string | undefined): string | undefined {
  return value && isAbsolute(value) ? value : undefined;
}

function matchesSpecifierPrefix(source: string, prefix: string): boolean {
  if (prefix.endsWith('/')) {
    return source.startsWith(prefix);
  }

  return source === prefix || source.startsWith(`${prefix}/`);
}

function matchesResolvedSpecifierPath(source: string, importer: string, directory: string): boolean {
  const resolvedSource = resolveSpecifierPath(source, importer);

  return resolvedSource ? isPathInside(resolvedSource, directory) : false;
}

function resolveSpecifierPath(source: string, importer: string): string | undefined {
  const sourceWithoutQuery = source.split('?')[0];

  if (sourceWithoutQuery.startsWith('/@fs/')) {
    return normalizeComparablePath(sourceWithoutQuery.slice('/@fs/'.length));
  }

  if (isAbsolute(sourceWithoutQuery)) {
    return normalizeComparablePath(resolve(sourceWithoutQuery));
  }

  if (sourceWithoutQuery.startsWith('.')) {
    const importerWithoutQuery = importer.split('?')[0];
    return normalizeComparablePath(resolve(dirname(importerWithoutQuery), sourceWithoutQuery));
  }

  return undefined;
}

function invalidateVirtualModule(server: ViteDevServer, moduleId: string): void {
  const module = server.moduleGraph.getModuleById(moduleId);

  if (module) {
    server.moduleGraph.invalidateModule(module);
  }
}

function findMatchedPurityComponentPathIndex(
  importer: string,
  resolvedComponentPaths: Array<string | undefined>
): number {
  return resolvedComponentPaths.findIndex(
    (componentPath) => componentPath !== undefined && isPathInside(importer, componentPath)
  );
}

function isPathInside(path: string, directory: string): boolean {
  const normalizedPath = normalizeComparablePath(path);
  const normalizedDirectory = normalizeComparablePath(directory);

  return normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`);
}

function normalizeComparablePath(path: string): string {
  return normalizePath(resolve(path)).replace(/^\/private(?=\/var\/)/u, '');
}

function getDefaultExport(module: unknown): unknown {
  if (isPlainObject(module) && 'default' in module) {
    return module.default;
  }

  return undefined;
}

function getRequestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://component-canvas.local').pathname;
  } catch {
    return '/';
  }
}

function hasFileExtension(pathname: string): boolean {
  return extname(pathname) !== '';
}

function getPreviewHtml(): string {
  return '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Preview</title></head><body><div id="app"></div><script type="module" src="/@id/__x00__component-canvas:preview"></script></body></html>';
}

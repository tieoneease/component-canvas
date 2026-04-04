import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Connect, InlineConfig, UserConfig, ViteDevServer } from 'vite';

import { SvelteAdapter } from './adapter.ts';
import { loadConfig } from './config.ts';
import { parseWorkflowManifests } from './manifest.ts';
import { access, constants } from 'node:fs/promises';
import {
  attachRenderRegistry,
  createRenderAPIMiddleware,
  createRenderRegistry
} from './render.ts';
import { composePreviewConfig, loadProjectViteConfig, resolvePackageEntry } from './project.ts';
import { resolveFromProject } from './resolve-plugin.ts';
import { getErrorMessage, getRequestPath, getRequestPathFromUrl, pathExists } from './utils.ts';
import canvasVitePlugin, {
  createManifestStreamStore,
  createManifestsAPIMiddleware,
  createPreviewMiddleware,
  createSSEMiddleware
} from './vite-plugin.ts';

export interface ServerOptions {
  canvasDir: string;
  port?: number;
  projectRoot?: string;
  mocks?: Record<string, string>;
  logLevel?: 'info' | 'warn' | 'error' | 'silent';
}

export interface StartedServer {
  url: string;
  previewUrl: string;
  previewServer: ViteDevServer;
  close: () => Promise<void>;
}

type Middleware = Connect.NextHandleFunction;
type CreateViteServer = typeof import('vite')['createServer'];

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5173;
const MAX_PORT_ATTEMPTS = 20;
const VITE_REQUEST_PREFIXES = ['/@fs', '/@id', '/@vite', '/__', '/node_modules', '/src', '/virtual:'];

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageResolutionFallbacks = [packageRoot];
const shellDistDir = resolve(packageRoot, 'shell', 'dist');

export async function startServer(options: ServerOptions): Promise<StartedServer> {
  const resolvedCanvasDir = resolve(options.canvasDir);
  const resolvedProjectRoot = resolve(options.projectRoot ?? dirname(resolvedCanvasDir));
  const shellIndexPath = resolve(shellDistDir, 'index.html');

  if (!(await pathExists(shellIndexPath))) {
    throw new Error(
      `Built shell assets were not found at "${shellIndexPath}". Run "bun run build:shell" first.`
    );
  }

  const adapter = new SvelteAdapter();
  const canvasConfig = await loadConfig(resolvedProjectRoot);
  const resolvedMocks = mergeStringMaps(canvasConfig?.mocks, options.mocks);
  const renderRegistry = createRenderRegistry();
  const manifestStreamStore = createManifestStreamStore();
  const basePreviewMiddleware = createPreviewMiddleware();
  const sseMiddleware = createSSEMiddleware({
    canvasDir: resolvedCanvasDir,
    manifestStreamStore
  });
  const manifestsApiMiddleware = createManifestsAPIMiddleware({
    canvasDir: resolvedCanvasDir,
    manifestStreamStore
  });
  const shellMiddleware = await createShellMiddleware();
  const projectViteConfig = await loadProjectViteConfig(
    resolvedProjectRoot,
    packageResolutionFallbacks
  );
  const projectAliases = extractProjectAliases(projectViteConfig);

  const previewConfig = await composePreviewConfig(
    resolvedProjectRoot,
    [
      resolveFromProject(
        resolvedProjectRoot,
        ['svelte', '@sveltejs/vite-plugin-svelte', 'vite'],
        packageResolutionFallbacks
      ),
      canvasVitePlugin({
        canvasDir: resolvedCanvasDir,
        projectRoot: resolvedProjectRoot,
        aliases: projectAliases,
        mocks: resolvedMocks,
        purity: canvasConfig?.purity ?? adapter.defaultPurityRules(),
        globalCss: await detectGlobalCss(resolvedProjectRoot, resolvedCanvasDir),
        renderRegistry,
        manifestStreamStore
      })
    ],
    packageResolutionFallbacks
  );

  // Discover canvas component files so the dep optimizer scans the right entries
  // upfront. Without this, the optimizer scans the project's HTML/route files
  // (e.g. SvelteKit's app.html), discovers a different dep set, and restarts
  // when the preview loads canvas components → 504 "Outdated Optimize Dep".
  const { workflows } = await parseWorkflowManifests(resolvedCanvasDir);
  const canvasEntries = workflows.flatMap((wf) =>
    wf.screens.map((s) => resolve(resolvedCanvasDir, 'workflows', wf.id, s.component))
  );
  if (canvasEntries.length > 0) {
    previewConfig.optimizeDeps = {
      ...previewConfig.optimizeDeps,
      entries: canvasEntries
    };
  }

  let previewServer: ViteDevServer | undefined;
  let httpServer: Server | undefined;
  let closed = false;

  try {
    previewServer = await createPreviewServer(
      resolvedProjectRoot,
      previewConfig,
      options.logLevel,
      packageResolutionFallbacks
    );
    attachRenderRegistry(previewServer, renderRegistry);
    const renderApiMiddleware = createRenderAPIMiddleware(previewServer);
    const previewMiddleware = createMountedPreviewMiddleware(basePreviewMiddleware, previewServer);
    httpServer = createHttpServer((req, res) => {
      handleRequest({
        req,
        res,
        previewServer: previewServer!,
        previewMiddleware,
        sseMiddleware,
        manifestsApiMiddleware,
        renderApiMiddleware,
        shellMiddleware
      });
    });

    await listenHttpServer(httpServer, options.port);

    const startedHttpServer = httpServer;
    const startedPreviewServer = previewServer;
    const url = resolveServerUrl(startedHttpServer);

    return {
      url,
      previewUrl: new URL('preview/', url).toString(),
      previewServer: startedPreviewServer,
      close: async () => {
        if (closed) return;
        closed = true;
        await Promise.allSettled([
          safeCloseHttpServer(startedHttpServer),
          startedPreviewServer.close()
        ]);
      }
    };
  } catch (error) {
    await Promise.allSettled([
      httpServer ? safeCloseHttpServer(httpServer) : Promise.resolve(),
      previewServer ? previewServer.close() : Promise.resolve()
    ]);
    throw error;
  }
}

async function createPreviewServer(
  projectRoot: string,
  previewConfig: InlineConfig,
  logLevel: ServerOptions['logLevel'],
  fallbackSearchPaths: string[] = []
): Promise<ViteDevServer> {
  const viteEntry = await resolvePackageEntry(projectRoot, 'vite', fallbackSearchPaths);
  const viteModule = (await import(viteEntry.url)) as {
    createServer?: CreateViteServer;
  };

  if (typeof viteModule.createServer !== 'function') {
    throw new Error(`Resolved Vite module "${viteEntry.url}" does not export createServer().`);
  }

  return viteModule.createServer({
    ...previewConfig,
    appType: 'custom',
    base: '/preview/',
    root: resolvePreviewRoot(previewConfig.root, projectRoot),
    logLevel,
    server: {
      ...previewConfig.server,
      middlewareMode: true
    },
    optimizeDeps: previewConfig.optimizeDeps
  });
}

/**
 * Serves the preview HTML with Vite's HMR client manually injected.
 *
 * We skip server.transformIndexHtml() because it calls preTransformRequest
 * on the virtual module URL, which races with the dep optimizer's initial
 * scan on cold starts → 504 "Outdated Optimize Dep" → failed module imports.
 * This is a known limitation for synthetic HTML (not backed by a file on
 * disk) in Vite middleware mode. See vitejs/vite#5061 — Astro uses the
 * same manual-injection pattern.
 *
 * The injection is minimal and uses stable Vite conventions:
 * - /@vite/client (HMR client path)
 * - /@id/__x00__ (virtual module URL encoding, documented in plugin API)
 */
function createMountedPreviewMiddleware(
  previewMiddleware: Middleware,
  previewServer: ViteDevServer
): Middleware {
  return (req, res, next) => {
    const originalEnd = res.end.bind(res);
    let previewHtml: string | undefined;

    res.end = ((chunk) => {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) {
        previewHtml = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      }

      return res;
    }) as typeof res.end;

    previewMiddleware(req, res, (error?: unknown) => {
      res.end = originalEnd;
      next(error);
    });

    res.end = originalEnd;

    if (previewHtml === undefined) {
      return;
    }

    const base = previewServer.config.base || '/';
    const viteClient = `<script type="module" src="${base}@vite/client"></script>`;
    const transformedHtml = previewHtml
      .replace('<head>', `<head>\n  ${viteClient}`)
      .replace(
        'src="/@id/__x00__component-canvas:preview"',
        `src="${base}@id/__x00__component-canvas:preview"`
      );

    if (isResponseHandled(res)) {
      return;
    }

    originalEnd(transformedHtml as never);
  };
}

async function createShellMiddleware(): Promise<Middleware> {
  const sirvModule = await import('sirv');
  const sirv = sirvModule.default;

  return sirv(shellDistDir, {
    dev: true,
    etag: true,
    single: 'index.html'
  }) as Middleware;
}

function handleRequest(options: {
  req: IncomingMessage;
  res: ServerResponse;
  previewServer: ViteDevServer;
  previewMiddleware: Middleware;
  sseMiddleware: Middleware;
  manifestsApiMiddleware: Middleware;
  renderApiMiddleware: Middleware;
  shellMiddleware: Middleware;
}): void {
  const {
    req,
    res,
    previewServer,
    previewMiddleware,
    sseMiddleware,
    manifestsApiMiddleware,
    renderApiMiddleware,
    shellMiddleware
  } = options;
  const pathname = getRequestPath(req);

  if (
    routePreviewApiRequest(pathname, '/preview/api/manifests/stream', req, res, sseMiddleware, previewServer) ||
    routePreviewApiRequest(pathname, '/preview/api/manifests', req, res, manifestsApiMiddleware, previewServer) ||
    routePreviewApiRequest(pathname, '/preview/api/renders', req, res, renderApiMiddleware, previewServer)
  ) {
    return;
  }

  if (pathname === '/preview' || pathname.startsWith('/preview/')) {
    const strippedUrl = stripPreviewPrefix(req.url);
    const strippedPathname = getRequestPathFromUrl(strippedUrl);

    if (isViteRequestPath(strippedPathname)) {
      invokeMiddleware(previewServer.middlewares, req, res, previewServer, () => {
        if (!isResponseHandled(res)) {
          sendNotFound(res);
        }
      });
      return;
    }

    req.url = strippedUrl;
    invokeMiddleware(previewServer.middlewares, req, res, previewServer, () => {
      if (isResponseHandled(res)) {
        return;
      }

      invokeMiddleware(previewMiddleware, req, res, previewServer, () => {
        if (!isResponseHandled(res)) {
          sendNotFound(res);
        }
      });
    });
    return;
  }

  if (isViteRequestPath(pathname)) {
    invokeMiddleware(previewServer.middlewares, req, res, previewServer, () => {
      if (!isResponseHandled(res)) {
        sendNotFound(res);
      }
    });
    return;
  }

  invokeMiddleware(shellMiddleware, req, res, undefined, () => {
    if (!isResponseHandled(res)) {
      sendNotFound(res);
    }
  });
}

function invokeMiddleware(
  middleware: Middleware,
  req: IncomingMessage,
  res: ServerResponse,
  previewServer: ViteDevServer | undefined,
  onNext: () => void
): void {
  try {
    middleware(req, res, (error?: unknown) => {
      if (error) {
        sendError(res, error, previewServer);
        return;
      }

      onNext();
    });
  } catch (error) {
    sendError(res, error, previewServer);
  }
}

function routePreviewApiRequest(
  pathname: string,
  expectedPath: string,
  req: IncomingMessage,
  res: ServerResponse,
  middleware: Middleware,
  previewServer: ViteDevServer
): boolean {
  if (pathname !== expectedPath) {
    return false;
  }

  const originalUrl = req.url;
  const restoreUrl = () => {
    req.url = originalUrl;
    res.off('finish', restoreUrl);
    res.off('close', restoreUrl);
  };

  req.url = stripPreviewPrefix(req.url);
  res.on('finish', restoreUrl);
  res.on('close', restoreUrl);
  invokeMiddleware(middleware, req, res, previewServer, () => {
    restoreUrl();

    if (!isResponseHandled(res)) {
      sendNotFound(res);
    }
  });

  return true;
}

function stripPreviewPrefix(url: string | undefined): string {
  const parsedUrl = new URL(url ?? '/preview/', 'http://component-canvas.local');
  const strippedPath = parsedUrl.pathname.replace(/^\/preview(?=\/|$)/u, '') || '/';
  return `${strippedPath}${parsedUrl.search}`;
}

function isViteRequestPath(pathname: string): boolean {
  return VITE_REQUEST_PREFIXES.some((prefix) => {
    if (prefix === '/__' || prefix === '/virtual:') {
      return pathname.startsWith(prefix);
    }

    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

function isResponseHandled(res: ServerResponse): boolean {
  return res.headersSent || res.writableEnded || res.destroyed;
}

function sendNotFound(res: ServerResponse): void {
  if (isResponseHandled(res)) {
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not Found');
}

function sendError(res: ServerResponse, error: unknown, previewServer?: ViteDevServer): void {
  if (isResponseHandled(res)) {
    return;
  }

  if (error instanceof Error && previewServer) {
    previewServer.ssrFixStacktrace(error);
  }

  res.statusCode = 500;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(getErrorMessage(error));
}

async function listenHttpServer(server: Server, requestedPort?: number): Promise<void> {
  if (requestedPort !== undefined) {
    await listenOnce(server, requestedPort);
    return;
  }

  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    try {
      await listenOnce(server, DEFAULT_PORT + offset);
      return;
    } catch (error) {
      if (!isAddressInUseError(error)) {
        throw error;
      }
    }
  }

  throw new Error(
    `Unable to find an open port after trying ${MAX_PORT_ATTEMPTS} ports starting at ${DEFAULT_PORT}.`
  );
}

function listenOnce(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const handleListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off('error', handleError);
      server.off('listening', handleListening);
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen({ host: DEFAULT_HOST, port });
  });
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

function resolveServerUrl(server: Server): string {
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Component canvas server did not expose a listening URL.');
  }

  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return `http://${host}:${address.port}/`;
}

function resolvePreviewRoot(root: string | undefined, projectRoot: string): string {
  if (!root) {
    return projectRoot;
  }

  return resolve(projectRoot, root);
}

function extractProjectAliases(projectConfig: UserConfig | null): Record<string, string> | undefined {
  const aliasConfig = projectConfig?.resolve?.alias;

  if (!aliasConfig) {
    return undefined;
  }

  if (!Array.isArray(aliasConfig)) {
    const aliases = Object.fromEntries(
      Object.entries(aliasConfig).filter(
        (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'
      )
    );

    return Object.keys(aliases).length > 0 ? aliases : undefined;
  }

  const aliases = Object.fromEntries(
    aliasConfig.flatMap((entry) => {
      if (typeof entry.find === 'string' && typeof entry.replacement === 'string') {
        return [[entry.find, entry.replacement] as const];
      }

      return [];
    })
  );

  return Object.keys(aliases).length > 0 ? aliases : undefined;
}

function mergeStringMaps(
  base: Record<string, string> | undefined,
  overrides: Record<string, string> | undefined
): Record<string, string> | undefined {
  const merged = { ...(base ?? {}), ...(overrides ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function safeCloseHttpServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => {
      resolve();
    });
  });
}

/**
 * Warm up Vite's dep optimizer by transforming the preview entry module.
 * This triggers dep discovery server-side, giving the optimizer time to
 * re-bundle before any browser requests arrive.
 */
/**
 * Warm up Vite's dep optimizer by using the documented server.warmup API.
 * This triggers module transformation server-side, giving the optimizer
 * time to discover and pre-bundle deps before browser requests arrive.
 */
/**
 * Auto-detect the project's global CSS entry point.
 * Checks canvas theme first, then common SvelteKit/Svelte CSS locations.
 */
async function detectGlobalCss(
  projectRoot: string,
  canvasDir: string
): Promise<string | undefined> {
  // Project CSS first (includes Tailwind directives, theme variables, etc.)
  // Canvas theme.css is a fallback for projects without a standard CSS entry.
  // Extensions cover Vite's built-in preprocessor support (.css, .postcss,
  // .scss, .sass). Less/Stylus omitted — no evidence of Svelte ecosystem use.
  const candidates = [
    resolve(projectRoot, 'src', 'app.css'),
    resolve(projectRoot, 'src', 'app.postcss'),
    resolve(projectRoot, 'src', 'app.scss'),
    resolve(projectRoot, 'src', 'app.sass'),
    resolve(projectRoot, 'src', 'styles', 'global.css'),
    resolve(projectRoot, 'src', 'global.css'),
    resolve(canvasDir, 'theme.css')
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      // continue
    }
  }

  return undefined;
}

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Connect, InlineConfig, ViteDevServer } from 'vite';

import { SvelteAdapter } from './adapter.ts';
import { loadConfig } from './config.ts';
import { composePreviewConfig, resolvePackageEntry } from './project.ts';
import { resolveFromProject } from './resolve-plugin.ts';
import { getErrorMessage, pathExists } from './utils.ts';
import canvasVitePlugin, {
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
  close: () => Promise<void>;
}

type Middleware = Connect.NextHandleFunction;
type CreateViteServer = typeof import('vite')['createServer'];

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5173;
const MAX_PORT_ATTEMPTS = 20;
const VITE_REQUEST_PREFIXES = ['/@fs', '/@id', '/@vite', '/__', '/node_modules', '/src', '/virtual:'];

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
  const basePreviewMiddleware = createPreviewMiddleware();
  const sseMiddleware = createSSEMiddleware(resolvedCanvasDir);
  const manifestsApiMiddleware = createManifestsAPIMiddleware(resolvedCanvasDir);
  const shellMiddleware = await createShellMiddleware();

  const previewConfig = await composePreviewConfig(resolvedProjectRoot, [
    resolveFromProject(resolvedProjectRoot, ['svelte', '@sveltejs/vite-plugin-svelte', 'vite']),
    canvasVitePlugin({
      canvasDir: resolvedCanvasDir,
      projectRoot: resolvedProjectRoot,
      mocks: resolvedMocks,
      purity: canvasConfig?.purity ?? adapter.defaultPurityRules()
    })
  ]);

  let previewServer: ViteDevServer | undefined;
  let httpServer: Server | undefined;
  let closed = false;

  try {
    previewServer = await createPreviewServer(resolvedProjectRoot, previewConfig, options.logLevel);
    const previewMiddleware = createMountedPreviewMiddleware(basePreviewMiddleware, previewServer);
    httpServer = createHttpServer((req, res) => {
      handleRequest({
        req,
        res,
        previewServer: previewServer!,
        previewMiddleware,
        sseMiddleware,
        manifestsApiMiddleware,
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
  logLevel: ServerOptions['logLevel']
): Promise<ViteDevServer> {
  const viteEntry = await resolvePackageEntry(projectRoot, 'vite');
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
    }
  });
}

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

    const sourceHtml = previewHtml.replace(
      '<script type="module" src="/@id/__x00__component-canvas:preview"></script>',
      '<script type="module">import "virtual:canvas-preview";</script>'
    );

    void previewServer
      .transformIndexHtml('/preview/', sourceHtml)
      .then((transformedHtml) => {
        if (isResponseHandled(res)) {
          return;
        }

        originalEnd(transformedHtml as never);
      })
      .catch((error) => {
        sendError(res, error, previewServer);
      });
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
  shellMiddleware: Middleware;
}): void {
  const { req, res, previewServer, previewMiddleware, sseMiddleware, manifestsApiMiddleware, shellMiddleware } = options;
  const pathname = getRequestPath(req);

  if (pathname === '/preview/api/manifests/stream') {
    invokeMiddleware(sseMiddleware, req, res, previewServer, () => {
      if (!isResponseHandled(res)) {
        sendNotFound(res);
      }
    });
    return;
  }

  if (pathname === '/preview/api/manifests') {
    invokeMiddleware(manifestsApiMiddleware, req, res, previewServer, () => {
      if (!isResponseHandled(res)) {
        sendNotFound(res);
      }
    });
    return;
  }

  if (pathname === '/preview' || pathname.startsWith('/preview/')) {
    const strippedUrl = stripPreviewPrefix(req.url);
    const strippedPathname = getRequestPathFromUrl(strippedUrl);

    if (isViteRequestPath(strippedPathname)) {
      invokeMiddleware(previewServer.middlewares, req, res, previewServer, () => {
        if (isResponseHandled(res)) {
          return;
        }

        req.url = strippedUrl;
        invokeMiddleware(previewServer.middlewares, req, res, previewServer, () => {
          if (!isResponseHandled(res)) {
            sendNotFound(res);
          }
        });
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

function getRequestPath(req: IncomingMessage): string {
  return getRequestPathFromUrl(req.url);
}

function getRequestPathFromUrl(url: string | undefined): string {
  return new URL(url ?? '/', 'http://component-canvas.local').pathname;
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

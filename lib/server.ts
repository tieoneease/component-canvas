import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer, type ViteDevServer } from 'vite';

import { loadConfig, type CanvasConfig } from './config.js';
import canvasVitePlugin from './vite-plugin.js';

export interface ServerOptions {
  canvasDir: string;
  port?: number;
  projectRoot?: string;
  aliases?: Record<string, string>;
  mocks?: Record<string, string>;
  tailwindConfig?: string;
  globalCss?: string;
}

export interface StartedServer {
  url: string;
  close: () => Promise<void>;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = resolve(packageRoot, 'app');
const appConfigFile = resolve(appDir, 'vite.config.js');
const appTailwindConfigFile = resolve(appDir, 'tailwind.config.js');
const PROJECT_ROOT_ENV = 'COMPONENT_CANVAS_PROJECT_ROOT';
const DISABLE_TAILWIND_FALLBACK_ENV = 'COMPONENT_CANVAS_DISABLE_TAILWIND_FALLBACK';

export async function startServer(options: ServerOptions): Promise<StartedServer> {
  const resolvedCanvasDir = resolve(options.canvasDir);
  const resolvedProjectRoot = resolve(options.projectRoot ?? dirname(resolvedCanvasDir));
  const projectConfig = await loadConfig(resolvedProjectRoot);
  const resolvedAliases = mergeAliases(projectConfig, options.aliases);
  const resolvedMocks = mergeStringMaps(projectConfig?.mocks, options.mocks);
  const configuredGlobalCss = options.globalCss ?? projectConfig?.globalCss;
  const resolvedGlobalCss = resolveAllowPath(configuredGlobalCss, resolvedProjectRoot);
  const resolvedTailwindConfig =
    options.tailwindConfig ?? projectConfig?.tailwind ?? appTailwindConfigFile;
  const restoreEnvironment = applyServerEnvironment(resolvedProjectRoot);

  let server: ViteDevServer | undefined;
  let closed = false;

  try {
    server = await createServer({
      root: appDir,
      configFile: appConfigFile,
      plugins: [
        canvasVitePlugin({
          canvasDir: resolvedCanvasDir,
          projectRoot: resolvedProjectRoot,
          aliases: resolvedAliases,
          mocks: resolvedMocks,
          tailwindConfig: resolvedTailwindConfig,
          globalCss: configuredGlobalCss
        })
      ],
      server: {
        host: '127.0.0.1',
        port: options.port,
        strictPort: options.port !== undefined,
        fs: {
          allow: uniquePaths([appDir, resolvedProjectRoot, resolvedCanvasDir, resolvedGlobalCss])
        }
      }
    });

    await server.listen();

    const startedServer = server;

    return {
      url: resolveServerUrl(startedServer),
      close: async () => {
        if (closed) {
          return;
        }

        closed = true;

        try {
          await startedServer.close();
        } finally {
          restoreEnvironment();
        }
      }
    };
  } catch (error) {
    restoreEnvironment();

    if (server) {
      await safeClose(server);
    }

    throw error;
  }
}

function resolveServerUrl(server: ViteDevServer): string {
  const resolvedUrl = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];

  if (resolvedUrl) {
    return resolvedUrl;
  }

  const address = server.httpServer?.address();

  if (!address || typeof address === 'string') {
    throw new Error('Vite dev server did not expose a listening URL.');
  }

  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return `http://${host}:${address.port}/`;
}

function resolveAllowPath(value: string | undefined, baseDir: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.startsWith('.')) {
    return resolve(baseDir, value);
  }

  if (value.startsWith('/')) {
    return resolve(value);
  }

  return undefined;
}

function mergeAliases(
  projectConfig: CanvasConfig | null,
  explicitAliases: Record<string, string> | undefined
): Record<string, string> | undefined {
  const aliases = {
    ...(projectConfig?.aliases ?? {}),
    ...(projectConfig?.lib ? { '$lib': projectConfig.lib } : {}),
    ...(explicitAliases ?? {})
  };

  return Object.keys(aliases).length > 0 ? aliases : undefined;
}

function mergeStringMaps(
  base: Record<string, string> | undefined,
  overrides: Record<string, string> | undefined
): Record<string, string> | undefined {
  const merged = {
    ...(base ?? {}),
    ...(overrides ?? {})
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => path !== undefined))];
}

function applyServerEnvironment(projectRoot: string): () => void {
  const previousProjectRoot = process.env[PROJECT_ROOT_ENV];
  const previousDisableFallback = process.env[DISABLE_TAILWIND_FALLBACK_ENV];

  process.env[PROJECT_ROOT_ENV] = projectRoot;
  process.env[DISABLE_TAILWIND_FALLBACK_ENV] = '1';

  return () => {
    if (previousProjectRoot === undefined) {
      delete process.env[PROJECT_ROOT_ENV];
    } else {
      process.env[PROJECT_ROOT_ENV] = previousProjectRoot;
    }

    if (previousDisableFallback === undefined) {
      delete process.env[DISABLE_TAILWIND_FALLBACK_ENV];
    } else {
      process.env[DISABLE_TAILWIND_FALLBACK_ENV] = previousDisableFallback;
    }
  };
}

async function safeClose(server: ViteDevServer): Promise<void> {
  try {
    await server.close();
  } catch {
    // Ignore cleanup failures and surface the original startup error instead.
  }
}

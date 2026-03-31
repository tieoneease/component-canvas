import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer, type ViteDevServer } from 'vite';

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

export async function startServer(options: ServerOptions): Promise<StartedServer> {
  const resolvedCanvasDir = resolve(options.canvasDir);
  const resolvedProjectRoot = resolve(options.projectRoot ?? dirname(resolvedCanvasDir));
  const resolvedGlobalCss = resolveAllowPath(options.globalCss, resolvedProjectRoot);

  const server = await createServer({
    root: appDir,
    configFile: appConfigFile,
    plugins: [
      canvasVitePlugin({
        ...options,
        canvasDir: resolvedCanvasDir,
        projectRoot: resolvedProjectRoot
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

  let closed = false;

  try {
    await server.listen();

    return {
      url: resolveServerUrl(server),
      close: async () => {
        if (closed) {
          return;
        }

        closed = true;
        await server.close();
      }
    };
  } catch (error) {
    await safeClose(server);
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

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => path !== undefined))];
}

async function safeClose(server: ViteDevServer): Promise<void> {
  try {
    await server.close();
  } catch {
    // Ignore cleanup failures and surface the original startup error instead.
  }
}

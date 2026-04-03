import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createServer, type ViteDevServer } from 'vite';

import { SvelteAdapter } from './adapter.ts';
import { loadConfig } from './config.ts';
import canvasVitePlugin from './vite-plugin.ts';

export interface ServerOptions {
  canvasDir: string;
  port?: number;
  projectRoot?: string;
  aliases?: Record<string, string>;
  mocks?: Record<string, string>;
  globalCss?: string;
  logLevel?: 'info' | 'warn' | 'error' | 'silent';
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
  const adapter = new SvelteAdapter();
  const projectConfig = await loadConfig(resolvedProjectRoot);
  const resolvedAliases = options.aliases;
  const resolvedMocks = mergeStringMaps(projectConfig?.mocks, options.mocks);
  const configuredGlobalCss = options.globalCss;
  const resolvedGlobalCss = resolveAllowPath(configuredGlobalCss, resolvedProjectRoot);

  // Write @source directive for Tailwind v4 to scan the canvas directory
  const canvasSourcesCss = resolve(appDir, 'src', 'canvas-sources.css');
  writeFileSync(canvasSourcesCss, `@source "${resolvedCanvasDir.replace(/\\/g, '/')}/**/*.svelte";\n`);

  let server: ViteDevServer | undefined;
  let closed = false;

  try {
    const canvasPluginOptions = {
      canvasDir: resolvedCanvasDir,
      projectRoot: resolvedProjectRoot,
      aliases: resolvedAliases,
      mocks: resolvedMocks,
      globalCss: configuredGlobalCss,
      purity: projectConfig?.purity ?? adapter.defaultPurityRules()
    };

    server = await createServer({
      root: appDir,
      configFile: appConfigFile,
      logLevel: options.logLevel,
      plugins: [canvasVitePlugin(canvasPluginOptions)],
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
        if (closed) return;
        closed = true;
        await startedServer.close();
      }
    };
  } catch (error) {
    if (server) await safeClose(server);
    throw error;
  }
}

function resolveServerUrl(server: ViteDevServer): string {
  const resolvedUrl = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
  if (resolvedUrl) return resolvedUrl;

  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Vite dev server did not expose a listening URL.');
  }

  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return `http://${host}:${address.port}/`;
}

function resolveAllowPath(value: string | undefined, baseDir: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('.') || value.startsWith('/')) return resolve(baseDir, value);
  return undefined;
}

function mergeStringMaps(
  base: Record<string, string> | undefined,
  overrides: Record<string, string> | undefined
): Record<string, string> | undefined {
  const merged = { ...(base ?? {}), ...(overrides ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => path !== undefined))];
}

async function safeClose(server: ViteDevServer): Promise<void> {
  try { await server.close(); } catch {}
}

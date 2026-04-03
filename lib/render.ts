import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import type { Connect, ViteDevServer } from 'vite';

import { isPlainObject, toFsImportPath } from './utils.ts';

export interface RenderRegistration {
  id: string;
  url: string;
}

export type RenderRegistry = Map<string, string>;

interface RenderRegistrationRequest {
  componentPath: string;
  props?: Record<string, unknown>;
}

interface PreviewServerWithRenderRegistry extends ViteDevServer {
  [RENDER_REGISTRY_SYMBOL]?: RenderRegistry;
}

export const RENDER_MODULE_ID_PREFIX = 'virtual:canvas-render-';
export const RESOLVED_RENDER_MODULE_ID_PREFIX = '\0component-canvas:render-';

const RENDER_REGISTRY_SYMBOL = Symbol.for('component-canvas.render-registry');

export function createRenderRegistry(): RenderRegistry {
  return new Map<string, string>();
}

export function attachRenderRegistry(previewServer: ViteDevServer, renderRegistry: RenderRegistry): void {
  (previewServer as PreviewServerWithRenderRegistry)[RENDER_REGISTRY_SYMBOL] = renderRegistry;
}

export function getRenderRegistry(previewServer: ViteDevServer): RenderRegistry | null {
  return (previewServer as PreviewServerWithRenderRegistry)[RENDER_REGISTRY_SYMBOL] ?? null;
}

export function getRenderModuleId(renderId: string): string {
  return `${RENDER_MODULE_ID_PREFIX}${renderId}`;
}

export function getResolvedRenderModuleId(renderId: string): string {
  return `${RESOLVED_RENDER_MODULE_ID_PREFIX}${renderId}`;
}

export function getRenderIdFromResolvedModuleId(moduleId: string): string | null {
  if (!moduleId.startsWith(RESOLVED_RENDER_MODULE_ID_PREFIX)) {
    return null;
  }

  return moduleId.slice(RESOLVED_RENDER_MODULE_ID_PREFIX.length);
}

export function generateRenderModule(
  componentAbsolutePath: string,
  props: Record<string, unknown>
): string {
  const fsImportPath = toFsImportPath(resolve(componentAbsolutePath));
  const serializedProps = serializeProps(props);

  return [
    "import { mount, unmount } from 'svelte';",
    `import RenderComponent from ${JSON.stringify(fsImportPath)};`,
    '',
    `export const props = ${serializedProps};`,
    'export const component = RenderComponent;',
    'export default RenderComponent;',
    '',
    'export function render(target) {',
    '  const mounted = mount(RenderComponent, {',
    '    target,',
    '    props',
    '  });',
    '',
    '  return () => {',
    '    try {',
    '      unmount(mounted);',
    '    } catch {',
    '      mounted?.$destroy?.();',
    '    }',
    '  };',
    '}'
  ].join('\n');
}

export function registerRender(
  previewServer: ViteDevServer,
  componentPath: string,
  props: Record<string, unknown>
): RenderRegistration {
  const renderRegistry = getRenderRegistry(previewServer);

  if (!renderRegistry) {
    throw new Error('Preview server does not have a render registry attached.');
  }

  const componentAbsolutePath = resolve(componentPath);
  const id = createRenderId(componentAbsolutePath, props);
  const moduleSource = generateRenderModule(componentAbsolutePath, props);

  renderRegistry.set(id, moduleSource);
  invalidateRenderModule(previewServer, id);

  return {
    id,
    url: `/preview/#/render/${encodeURIComponent(id)}`
  };
}

export function createRenderAPIMiddleware(previewServer: ViteDevServer): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.method !== 'POST' || getRequestPath(req) !== '/api/renders') {
      next();
      return;
    }

    void handleRenderRegistrationRequest(req, res, previewServer).catch(next);
  };
}

async function handleRenderRegistrationRequest(
  req: IncomingMessage,
  res: ServerResponse,
  previewServer: ViteDevServer
): Promise<void> {
  const payload = validateRenderRegistrationRequest(await readJsonRequestBody(req));
  const registration = registerRender(previewServer, payload.componentPath, payload.props ?? {});

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(registration)}\n`);
}

async function readJsonRequestBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const source = Buffer.concat(chunks).toString('utf8').trim();

  if (source.length === 0) {
    return {};
  }

  return JSON.parse(source) as unknown;
}

function validateRenderRegistrationRequest(value: unknown): RenderRegistrationRequest {
  if (!isPlainObject(value) || typeof value.componentPath !== 'string') {
    throw new Error('Render registration requires a JSON object with a string "componentPath" field.');
  }

  if (value.props !== undefined && !isPlainObject(value.props)) {
    throw new Error('Render registration "props" must be a JSON object when provided.');
  }

  return {
    componentPath: value.componentPath,
    props: value.props as Record<string, unknown> | undefined
  };
}

function serializeProps(props: Record<string, unknown>): string {
  try {
    return JSON.stringify(props, null, 2) ?? '{}';
  } catch (error) {
    throw new Error(`Render props must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createRenderId(componentAbsolutePath: string, props: Record<string, unknown>): string {
  return createHash('sha256')
    .update(componentAbsolutePath)
    .update('\0')
    .update(serializeProps(props))
    .update('\0')
    .update(String(Date.now()))
    .digest('hex')
    .slice(0, 16);
}

function invalidateRenderModule(previewServer: ViteDevServer, renderId: string): void {
  const module = previewServer.moduleGraph.getModuleById(getResolvedRenderModuleId(renderId));

  if (module) {
    previewServer.moduleGraph.invalidateModule(module);
  }
}

function getRequestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://component-canvas.local').pathname;
  } catch {
    return '/';
  }
}

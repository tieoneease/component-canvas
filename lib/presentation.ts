import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, resolve } from 'node:path';

import type { Connect } from 'vite';

import { generateRenderModule, type RenderRegistry } from './render.ts';
import { getRequestPath, isPlainObject } from './utils.ts';

export interface PresentationItem {
  type: 'screen' | 'variant' | 'render';
  workflow?: string;
  screen?: string;
  variant?: string;
  renderId?: string;
  label: string;
}

export interface Presentation {
  id: string;
  title: string;
  items: PresentationItem[];
  viewport?: { width: number; height: number };
  createdAt: number;
}

export interface PresentationRegistration {
  id: string;
  url: string;
}

export type PresentationRegistry = Map<string, Presentation>;

interface PresentationRequestItem {
  workflow?: string;
  screen?: string;
  variant?: string;
  component?: string;
  props?: Record<string, unknown>;
  label?: string;
}

interface PresentationRequest {
  title?: string;
  items: PresentationRequestItem[];
  viewport?: { width: number; height: number };
}

export function createPresentationRegistry(): PresentationRegistry {
  return new Map();
}

export function createPresentationAPIMiddleware(
  presentationRegistry: PresentationRegistry,
  renderRegistry: RenderRegistry
): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathname = getRequestPath(req);

    if (req.method === 'POST' && pathname === '/api/presentations') {
      void handleCreatePresentation(req, res, presentationRegistry, renderRegistry).catch(next);
      return;
    }

    const getMatch = pathname.match(/^\/api\/presentations\/([^/]+)$/u);

    if (req.method === 'GET' && getMatch) {
      handleGetPresentation(res, presentationRegistry, safeDecode(getMatch[1]));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/presentations') {
      handleListPresentations(res, presentationRegistry);
      return;
    }

    next();
  };
}

async function handleCreatePresentation(
  req: IncomingMessage,
  res: ServerResponse,
  presentationRegistry: PresentationRegistry,
  renderRegistry: RenderRegistry
): Promise<void> {
  const body = await readJsonBody(req);
  const request = validatePresentationRequest(body);
  const items = resolveItems(request.items, renderRegistry);
  const id = createPresentationId(items);
  const presentation: Presentation = {
    id,
    title: request.title ?? 'Presentation',
    items,
    viewport: request.viewport,
    createdAt: Date.now()
  };

  presentationRegistry.set(id, presentation);

  const registration: PresentationRegistration = {
    id,
    url: `/preview/?presentation=${encodeURIComponent(id)}`
  };

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(registration)}\n`);
}

function handleGetPresentation(
  res: ServerResponse,
  registry: PresentationRegistry,
  id: string
): void {
  const presentation = registry.get(id);

  if (!presentation) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end('{"error":"Presentation not found"}\n');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(presentation)}\n`);
}

function handleListPresentations(
  res: ServerResponse,
  registry: PresentationRegistry
): void {
  const presentations = [...registry.values()].sort(
    (left, right) => right.createdAt - left.createdAt
  );

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(presentations)}\n`);
}

function resolveItems(
  requestItems: PresentationRequestItem[],
  renderRegistry: RenderRegistry
): PresentationItem[] {
  return requestItems.map((item) => {
    if (typeof item.component === 'string') {
      const componentPath = resolve(item.component);
      const props = item.props ?? {};
      const renderId = createPresentationId(
        `${componentPath}\0${JSON.stringify(props)}\0${Date.now()}`
      );
      const moduleSource = generateRenderModule(componentPath, props);

      renderRegistry.set(renderId, moduleSource);

      return {
        type: 'render' as const,
        renderId,
        label: item.label ?? basename(item.component).replace(/\.svelte$/u, '')
      };
    }

    if (typeof item.variant === 'string') {
      return {
        type: 'variant' as const,
        workflow: item.workflow!,
        screen: item.screen,
        variant: item.variant,
        label: item.label ?? item.variant
      };
    }

    return {
      type: 'screen' as const,
      workflow: item.workflow!,
      screen: item.screen!,
      label: item.label ?? item.screen!
    };
  });
}

function validatePresentationRequest(body: unknown): PresentationRequest {
  if (!isPlainObject(body)) {
    throw new Error('Presentation request must be a JSON object.');
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error('Presentation request must include a non-empty "items" array.');
  }

  const items: PresentationRequestItem[] = [];

  for (const [index, item] of body.items.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`Item at index ${index} must be an object.`);
    }

    const hasComponent = typeof item.component === 'string';
    const hasScreen = typeof item.screen === 'string';
    const hasWorkflow = typeof item.workflow === 'string';

    if (!hasComponent && !hasScreen) {
      throw new Error(`Item at index ${index} must have either "component" or "screen".`);
    }

    if (hasScreen && !hasWorkflow) {
      throw new Error(`Item at index ${index} has "screen" but is missing "workflow".`);
    }

    items.push({
      workflow: typeof item.workflow === 'string' ? item.workflow : undefined,
      screen: typeof item.screen === 'string' ? item.screen : undefined,
      variant: typeof item.variant === 'string' ? item.variant : undefined,
      component: typeof item.component === 'string' ? item.component : undefined,
      props: isPlainObject(item.props) ? (item.props as Record<string, unknown>) : undefined,
      label: typeof item.label === 'string' ? item.label : undefined
    });
  }

  return {
    title: typeof body.title === 'string' ? body.title : undefined,
    items,
    viewport: isValidViewport(body.viewport) ? body.viewport : undefined
  };
}

function isValidViewport(
  value: unknown
): value is { width: number; height: number } {
  return (
    isPlainObject(value) &&
    typeof value.width === 'number' &&
    value.width > 0 &&
    typeof value.height === 'number' &&
    value.height > 0
  );
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();

  if (text.length === 0) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function createPresentationId(input: string | PresentationItem[]): string {
  const data = typeof input === 'string' ? input : JSON.stringify(input) + Date.now();

  return createHash('sha256').update(data).digest('hex').slice(0, 12);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

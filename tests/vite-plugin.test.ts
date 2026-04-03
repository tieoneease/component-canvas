import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import type { ConfigEnv } from 'vite';

import canvasVitePlugin, {
  createManifestsAPIMiddleware,
  createPreviewMiddleware,
  createSSEMiddleware,
  formatPurityError,
  isPurityViolation
} from '../lib/vite-plugin.ts';
import type { PurityConfig } from '../lib/adapter.ts';

const fixturesDir = resolve(process.cwd(), 'tests/fixtures');
const configEnv: ConfigEnv = {
  command: 'serve',
  mode: 'test',
  isSsrBuild: false,
  isPreview: false
};

const purityRules: PurityConfig = {
  componentPaths: ['$lib/components/'],
  forbiddenImports: ['$lib/stores/', '$app/navigation']
};
const componentPath = `${resolve(fixturesDir, 'valid-workflow/src/lib/components')}/`;

describe('isPurityViolation', () => {
  it('returns true when a component imports from a forbidden path', () => {
    const importer = resolve(fixturesDir, 'valid-workflow/src/lib/components/Chat.svelte');

    expect(
      isPurityViolation('$lib/stores/conversation', importer, purityRules, [componentPath])
    ).toBe(true);
  });

  it('returns true when a component import has already been resolved to a filesystem path', () => {
    const importer = resolve(fixturesDir, 'valid-workflow/src/lib/components/Chat.svelte');
    const resolvedStorePath = resolve(fixturesDir, 'valid-workflow/src/lib/stores/conversation.ts');
    const resolvedStoreDirectory = `${resolve(fixturesDir, 'valid-workflow/src/lib/stores')}/`;

    expect(
      isPurityViolation('../stores/conversation.ts', importer, purityRules, [componentPath], [resolvedStoreDirectory])
    ).toBe(true);
    expect(
      isPurityViolation(resolvedStorePath, importer, purityRules, [componentPath], [resolvedStoreDirectory])
    ).toBe(true);
    expect(
      isPurityViolation(`/@fs/${resolvedStorePath}`, importer, purityRules, [componentPath], [resolvedStoreDirectory])
    ).toBe(true);
  });

  it('returns false when a component import is allowed', () => {
    const importer = resolve(fixturesDir, 'valid-workflow/src/lib/components/Chat.svelte');

    expect(isPurityViolation('$lib/utils/date', importer, purityRules, [componentPath])).toBe(false);
  });

  it('returns false when the importer is outside the component path', () => {
    const importer = resolve(fixturesDir, 'valid-workflow/src/routes/+page.svelte');

    expect(
      isPurityViolation('$lib/stores/conversation', importer, purityRules, [componentPath])
    ).toBe(false);
  });

  it('handles nested paths, trailing slashes, and exact path boundaries', () => {
    const nestedImporter = resolve(fixturesDir, 'valid-workflow/src/lib/components/chat/Chat.svelte');
    const siblingImporter = resolve(fixturesDir, 'valid-workflow/src/lib/components-old/Chat.svelte');

    expect(isPurityViolation('$app/navigation/forms', nestedImporter, purityRules, [componentPath])).toBe(
      true
    );
    expect(isPurityViolation('$app/navigation-utils', nestedImporter, purityRules, [componentPath])).toBe(
      false
    );
    expect(
      isPurityViolation('$lib/stores/conversation', siblingImporter, purityRules, [componentPath])
    ).toBe(false);
  });
});

describe('formatPurityError', () => {
  it('includes the importer, source, matched rule, and fix guidance', () => {
    const importer = resolve(fixturesDir, 'valid-workflow/src/lib/components/Chat.svelte');
    const message = formatPurityError('$lib/stores/conversation', importer, purityRules, [componentPath]);

    expect(message).toContain(importer);
    expect(message).toContain("'$lib/stores/conversation'");
    expect(message).toContain("'$lib/components/'");
    expect(message).toContain("'$lib/stores/'");
    expect(message).toContain('Fix: lift this import to the page shell that renders this component.');
  });

  it('uses the matched component rule instead of always using the first configured rule', () => {
    const importer = resolve(fixturesDir, 'valid-workflow/src/lib/components/Chat.svelte');
    const message = formatPurityError(
      '$lib/stores/conversation',
      importer,
      {
        componentPaths: ['$lib/unused/', '$lib/components/'],
        forbiddenImports: purityRules.forbiddenImports
      },
      [undefined, componentPath]
    );

    expect(message).toContain("'$lib/components/'");
    expect(message).not.toContain("'$lib/unused/'");
  });
});

describe('canvasVitePlugin', () => {
  it('registers virtual modules and emits workflow component sources', async () => {
    const canvasDir = resolve(fixturesDir, 'valid-workflow/.canvas');
    const plugin = canvasVitePlugin({ canvasDir });

    expect(plugin.name).toBe('component-canvas-vite-plugin');

    const manifestsId = await plugin.resolveId?.('virtual:canvas-manifests');
    const componentsId = await plugin.resolveId?.('virtual:canvas-components');
    const previewId = await plugin.resolveId?.('virtual:canvas-preview');

    expect(manifestsId).toBe('\0component-canvas:manifests');
    expect(componentsId).toBe('\0component-canvas:components');
    expect(previewId).toBe('\0component-canvas:preview');

    const manifestModule = await plugin.load?.call({ warn: vi.fn() } as never, manifestsId!);
    const componentModule = await plugin.load?.call({ warn: vi.fn() } as never, componentsId!);
    const previewModule = await plugin.load?.call({ warn: vi.fn() } as never, previewId!);

    expect(manifestModule).toContain('export const workflows =');
    expect(manifestModule).toContain('"id": "login"');
    expect(componentModule).toContain('login/LoginForm');
    expect(componentModule).toContain('/@fs/');
    expect(previewModule).toContain("virtual:canvas-manifests");
    expect(previewModule).toContain("virtual:canvas-components");
    expect(previewModule).toContain("virtual:canvas-global-css");
    expect(previewModule).toContain('#/screen/<workflowId>/<screenId>');
    expect(previewModule).toContain('/preview/@id/__x00__component-canvas:render-');
  });

  it('adds fs allow entries through the Vite config hook without injecting aliases', () => {
    const projectRoot = resolve(fixturesDir, 'valid-workflow');
    const canvasDir = resolve(projectRoot, '.canvas');
    const plugin = canvasVitePlugin({
      canvasDir,
      projectRoot,
      aliases: {
        '$lib': './src/lib'
      },
      mocks: {
        '$app/environment': './tests/mocks/app-environment.ts'
      },
      globalCss: './src/app.css'
    });

    const config = plugin.config?.({}, configEnv);

    expect(config).toBeDefined();
    expect(config?.server?.fs?.allow).toEqual(
      expect.arrayContaining([canvasDir, projectRoot, resolve(projectRoot, 'src/app.css')])
    );
    expect(config?.resolve).toBeUndefined();
  });

  it('resolves mock aliases through resolveId', async () => {
    const projectRoot = resolve(fixturesDir, 'valid-workflow');
    const plugin = canvasVitePlugin({
      canvasDir: resolve(projectRoot, '.canvas'),
      projectRoot,
      mocks: {
        '$app/environment': './tests/mocks/app-environment.ts'
      }
    });

    const resolvedId = await plugin.resolveId?.('$app/environment');

    expect(resolvedId).toBe(resolve(projectRoot, 'tests/mocks/app-environment.ts'));
  });

  it('emits a virtual global CSS module when globalCss is configured', async () => {
    const projectRoot = resolve(fixturesDir, 'valid-workflow');
    const plugin = canvasVitePlugin({
      canvasDir: resolve(projectRoot, '.canvas'),
      projectRoot,
      globalCss: './src/app.css'
    });

    const globalCssId = await plugin.resolveId?.('virtual:canvas-global-css');
    const globalCssModule = await plugin.load?.call({ warn: vi.fn() } as never, globalCssId!);

    expect(globalCssId).toBe('\0component-canvas:global-css');
    expect(globalCssModule).toContain('/@fs/');
    expect(globalCssModule).toContain(resolve(projectRoot, 'src/app.css').replaceAll('\\', '/'));
  });

  it('rejects forbidden imports for component paths resolved through aliases', async () => {
    const projectRoot = resolve(fixturesDir, 'valid-workflow');
    const plugin = canvasVitePlugin({
      canvasDir: resolve(projectRoot, '.canvas'),
      projectRoot,
      aliases: {
        '$lib': './src/lib'
      },
      purity: purityRules
    });

    const importer = resolve(projectRoot, 'src/lib/components/Chat.svelte');
    const error = vi.fn();

    const result = await plugin.resolveId?.call(
      { error } as never,
      '$lib/stores/conversation',
      importer,
      undefined as never
    );

    expect(result).toBeNull();
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.stringContaining(importer));
  });

  it('allows clean imports and imports outside component paths', async () => {
    const projectRoot = resolve(fixturesDir, 'valid-workflow');
    const plugin = canvasVitePlugin({
      canvasDir: resolve(projectRoot, '.canvas'),
      projectRoot,
      aliases: {
        '$lib': './src/lib'
      },
      purity: purityRules
    });

    const cleanError = vi.fn();
    const cleanImporter = resolve(projectRoot, 'src/lib/components/Chat.svelte');
    const cleanResult = await plugin.resolveId?.call(
      { error: cleanError } as never,
      '$lib/utils/date',
      cleanImporter,
      undefined as never
    );

    expect(cleanResult).toBeNull();
    expect(cleanError).not.toHaveBeenCalled();

    const pageError = vi.fn();
    const pageImporter = resolve(projectRoot, 'src/routes/+page.svelte');
    const pageResult = await plugin.resolveId?.call(
      { error: pageError } as never,
      '$lib/stores/conversation',
      pageImporter,
      undefined as never
    );

    expect(pageResult).toBeNull();
    expect(pageError).not.toHaveBeenCalled();
  });
});

describe('preview middleware', () => {
  it('serves preview HTML for extensionless GET requests', async () => {
    const middleware = createPreviewMiddleware();
    const req = new MockRequest('GET', '/');
    const res = new MockResponse();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('<div id="app"></div>');
    expect(res.body).toContain('/@id/__x00__component-canvas:preview');
  });

  it('passes through asset requests', () => {
    const middleware = createPreviewMiddleware();
    const req = new MockRequest('GET', '/styles.css');
    const res = new MockResponse();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.body).toBe('');
  });
});

describe('manifest middleware', () => {
  it('serves the current manifests JSON', async () => {
    const canvasDir = resolve(fixturesDir, 'valid-workflow/.canvas');
    const middleware = createManifestsAPIMiddleware(canvasDir);
    const req = new MockRequest('GET', '/api/manifests');
    const res = new MockResponse();

    const next = await invokeMiddleware(middleware, req, res);
    const payload = JSON.parse(res.body) as {
      workflows: Array<{ id: string }>;
      errors: unknown[];
    };

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toBe('application/json; charset=utf-8');
    expect(payload.workflows[0]?.id).toBe('login');
    expect(payload.errors).toEqual([]);
  });

  it('starts an SSE stream with the current manifests payload', async () => {
    const canvasDir = resolve(fixturesDir, 'valid-workflow/.canvas');
    const middleware = createSSEMiddleware(canvasDir);
    const req = new MockRequest('GET', '/api/manifests/stream');
    const res = new MockResponse();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    await waitFor(() => res.writes.length > 0);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toBe('text/event-stream');
    expect(res.body).toContain('data: ');
    expect(res.body).toContain('"id":"login"');
  });
});

class MockRequest extends EventEmitter {
  method: string;
  url: string;

  constructor(method: string, url: string) {
    super();
    this.method = method;
    this.url = url;
  }
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  body = '';
  writes: string[] = [];
  writableEnded = false;
  destroyed = false;

  #headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.#headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string): string | undefined {
    return this.#headers.get(name.toLowerCase());
  }

  flushHeaders(): void {}

  write(chunk: string): boolean {
    this.writes.push(chunk);
    this.body += chunk;
    return true;
  }

  end(chunk?: string): this {
    if (chunk) {
      this.write(chunk);
    }

    this.writableEnded = true;
    this.emit('finish');
    return this;
  }
}

async function invokeMiddleware(
  middleware: ReturnType<typeof createManifestsAPIMiddleware>,
  req: MockRequest,
  res: MockResponse
): Promise<ReturnType<typeof vi.fn>> {
  return await new Promise((resolvePromise, reject) => {
    const next = vi.fn((error?: unknown) => {
      cleanup();
      if (error) {
        reject(error);
        return;
      }

      resolvePromise(next);
    });

    const onFinish = () => {
      cleanup();
      resolvePromise(next);
    };

    const cleanup = () => {
      res.off('finish', onFinish);
    };

    res.on('finish', onFinish);
    middleware(req as never, res as never, next);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startTime = Date.now();

  while (!predicate()) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

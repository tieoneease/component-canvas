import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import type { Alias, ConfigEnv } from 'vite';

import canvasVitePlugin, { formatPurityError, isPurityViolation } from '../lib/vite-plugin.ts';
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

    expect(manifestsId).toBe('\0component-canvas:manifests');
    expect(componentsId).toBe('\0component-canvas:components');

    const manifestModule = await plugin.load?.call({ warn: vi.fn() } as never, manifestsId!);
    const componentModule = await plugin.load?.call({ warn: vi.fn() } as never, componentsId!);

    expect(manifestModule).toContain('export const workflows =');
    expect(manifestModule).toContain('"id": "login"');
    expect(componentModule).toContain('login/LoginForm');
    expect(componentModule).toContain('/@fs/');
  });

  it('adds fs allow entries, aliases, mocks, and tailwind config through the Vite config hook', () => {
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
      expect.arrayContaining([
        canvasDir,
        projectRoot,
        resolve(projectRoot, 'src/app.css')
      ])
    );

    const aliases = aliasArrayToMap(config?.resolve?.alias ?? []);
    expect(aliases).toMatchObject({
      '$app/environment': resolve(projectRoot, 'tests/mocks/app-environment.ts'),
      '$lib': resolve(projectRoot, 'src/lib')
    });
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

function aliasArrayToMap(alias: Alias[]): Record<string, string> {
  return alias.reduce<Record<string, string>>((entries, entry) => {
    if (typeof entry === 'object' && typeof entry.find === 'string') {
      entries[entry.find] = entry.replacement;
    }

    return entries;
  }, {});
}

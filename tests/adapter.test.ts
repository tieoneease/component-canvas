import { describe, expect, it } from 'vitest';

import { SvelteAdapter } from '../lib/adapter.ts';

describe('SvelteAdapter', () => {
  const adapter = new SvelteAdapter();

  it('exposes the Svelte file extension', () => {
    expect(adapter.fileExtensions).toEqual(['.svelte']);
  });

  it('returns the default SvelteKit purity rules', () => {
    expect(adapter.defaultPurityRules()).toEqual({
      componentPaths: ['$lib/components/'],
      forbiddenImports: ['$lib/stores/', '$lib/api/', '$app/navigation', '$app/environment']
    });
  });

  it('classifies screens without $lib imports as prototypes', () => {
    expect(
      adapter.isPrototypeScreen([
        '<script>',
        "  import LocalCard from './LocalCard.svelte';",
        '</script>',
        '',
        '<LocalCard />'
      ].join('\n'))
    ).toBe(true);

    expect(adapter.isPrototypeScreen('<div>Prototype</div>')).toBe(true);
  });

  it('classifies screens with $lib imports as non-prototypes', () => {
    expect(
      adapter.isPrototypeScreen([
        '<script>',
        "  import LoginForm from '$lib/components/LoginForm.svelte';",
        '</script>',
        '',
        '<LoginForm />'
      ].join('\n'))
    ).toBe(false);
  });

  it('generates the virtual component module source', () => {
    const moduleSource = adapter.generateComponentModule([
      {
        key: 'auth/LoginForm',
        absolutePath: '/tmp/project/.canvas/workflows/auth/LoginForm.svelte'
      },
      {
        key: 'auth/Nested/Helper',
        absolutePath: '/tmp/project/.canvas/workflows/auth/Nested/Helper.svelte'
      }
    ]);

    expect(moduleSource).toContain('import Component0 from "/@fs/');
    expect(moduleSource).toContain('import Component1 from "/@fs/');
    expect(moduleSource).toContain('"auth/LoginForm": Component0');
    expect(moduleSource).toContain('"auth/Nested/Helper": Component1');
    expect(moduleSource).toContain('const components =');
    expect(moduleSource).toContain('export default components;');
  });

  it('returns Vite plugins for Svelte', () => {
    const plugins = adapter.vitePlugins();

    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins[0]).toMatchObject({
      name: expect.any(String)
    });
  });
});

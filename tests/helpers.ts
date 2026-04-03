import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function extractFirstJsonObject(source: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (start === -1) {
      if (character === '{') {
        start = index;
        depth = 1;
      }

      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

const repoSveltePluginEntryUrl = pathToFileURL(
  resolve(process.cwd(), 'node_modules', '@sveltejs', 'vite-plugin-svelte', 'src', 'index.js')
).href;

export function createViteConfigSource(options: { includeLibAlias?: boolean } = {}): string {
  const includeLibAlias = options.includeLibAlias ?? false;
  const lines = ["import { defineConfig } from 'vite';"];

  if (includeLibAlias) {
    lines.unshift("import { fileURLToPath } from 'node:url';");
    lines.push('', "const libDir = fileURLToPath(new URL('./src/lib', import.meta.url));");
  }

  lines.push(
    '',
    'export default defineConfig(async () => {',
    `  const { svelte } = await import(${JSON.stringify(repoSveltePluginEntryUrl)});`,
    '',
    '  return {',
    '    plugins: [svelte()],'
  );

  if (includeLibAlias) {
    lines.push('    resolve: {', '      alias: {', '        $lib: libDir', '      }', '    }');
  }

  lines.push('  };', '});', '');

  return lines.join('\n');
}

export async function createRenderCheckFixture(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-render-check-'));

  await mkdir(resolve(projectRoot, '.canvas', 'workflows', 'adopted'), { recursive: true });
  await mkdir(resolve(projectRoot, '.canvas', 'workflows', 'prototype'), { recursive: true });
  await mkdir(resolve(projectRoot, 'src', 'lib', 'components'), { recursive: true });

  await writeFile(resolve(projectRoot, 'vite.config.ts'), createViteConfigSource({ includeLibAlias: true }), 'utf8');

  await writeFile(
    resolve(projectRoot, 'src', 'lib', 'components', 'GreetingCard.svelte'),
    [
      '<script>',
      "  export let message = 'Hello from $lib';",
      '</script>',
      '',
      '<div data-greeting-card>{message}</div>',
      ''
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, '.canvas', 'workflows', 'adopted', 'AdoptedScreen.svelte'),
    [
      '<script>',
      "  import GreetingCard from '$lib/components/GreetingCard.svelte';",
      '</script>',
      '',
      '<GreetingCard message="Shared render-check fixture" />',
      ''
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, '.canvas', 'workflows', 'adopted', '_flow.ts'),
    [
      'export default {',
      "  id: 'adopted',",
      "  title: 'Adopted Flow',",
      '  screens: [',
      '    {',
      "      id: 'ready',",
      "      component: 'AdoptedScreen.svelte',",
      "      title: 'Ready'",
      '    }',
      '  ],',
      '  transitions: []',
      '};',
      ''
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, '.canvas', 'workflows', 'prototype', 'LocalCard.svelte'),
    '<div data-local-card>Prototype concept</div>\n',
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, '.canvas', 'workflows', 'prototype', 'PrototypeScreen.svelte'),
    [
      '<script>',
      "  import LocalCard from './LocalCard.svelte';",
      '</script>',
      '',
      '<LocalCard />',
      ''
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, '.canvas', 'workflows', 'prototype', '_flow.ts'),
    [
      'export default {',
      "  id: 'prototype',",
      "  title: 'Prototype Flow',",
      '  screens: [',
      '    {',
      "      id: 'concept',",
      "      component: 'PrototypeScreen.svelte',",
      "      title: 'Concept'",
      '    }',
      '  ],',
      '  transitions: []',
      '};',
      ''
    ].join('\n'),
    'utf8'
  );

  return projectRoot;
}

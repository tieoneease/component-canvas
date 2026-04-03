import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderCheck } from '../lib/render-check.ts';
import { startServer } from '../lib/server.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('renderCheck', () => {
  it(
    'classifies passing and prototype screens and reports the correct summary',
    async () => {
      const projectRoot = await createRenderCheckFixture();
      const canvasDir = resolve(projectRoot, '.canvas');

      const result = await renderCheck({ canvasDir, projectRoot });

      expect(result.screens).toEqual([
        {
          workflow: 'adopted',
          screen: 'ready',
          status: 'pass'
        },
        {
          workflow: 'prototype',
          screen: 'concept',
          status: 'prototype'
        }
      ]);
      expect(result.summary).toEqual({
        pass: 1,
        fail: 0,
        prototype: 1,
        total: 2
      });
    },
    30_000
  );

  it(
    'filters to a single workflow and can reuse a provided server URL',
    async () => {
      const projectRoot = await createRenderCheckFixture();
      const canvasDir = resolve(projectRoot, '.canvas');
      const server = await startServer({ canvasDir, projectRoot });

      try {
        const result = await renderCheck({
          canvasDir,
          projectRoot,
          workflowId: 'adopted',
          serverUrl: server.url
        });

        expect(result.screens).toEqual([
          {
            workflow: 'adopted',
            screen: 'ready',
            status: 'pass'
          }
        ]);
        expect(result.summary).toEqual({
          pass: 1,
          fail: 0,
          prototype: 0,
          total: 1
        });
      } finally {
        await server.close();
      }
    },
    30_000
  );
});

async function createRenderCheckFixture(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-render-check-'));
  tempDirs.push(projectRoot);

  await mkdir(resolve(projectRoot, '.canvas', 'workflows', 'adopted'), { recursive: true });
  await mkdir(resolve(projectRoot, '.canvas', 'workflows', 'prototype'), { recursive: true });
  await mkdir(resolve(projectRoot, 'src', 'lib', 'components'), { recursive: true });

  await writeFile(resolve(projectRoot, 'canvas.config.ts'), 'export default { lib: "./src/lib" };\n', 'utf8');

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
      '<GreetingCard message="Canvas render-check" />',
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

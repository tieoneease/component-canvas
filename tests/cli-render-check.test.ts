import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const cliPath = resolve(process.cwd(), 'bin/cli.ts');
const tempDirs: string[] = [];

interface RenderCheckCommandPayload {
  screens: Array<{
    workflow: string;
    screen: string;
    status: 'pass' | 'fail' | 'prototype';
    error?: string;
  }>;
  summary: {
    pass: number;
    fail: number;
    prototype: number;
    total: number;
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('component-canvas render-check', () => {
  it(
    'outputs JSON and keeps exit code 0 when screens pass or are prototypes',
    async () => {
      const projectRoot = await createRenderCheckFixture();

      const result = await runRenderCheck(projectRoot, ['--json']);

      expect(result).toEqual({
        screens: [
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
        ],
        summary: {
          pass: 1,
          fail: 0,
          prototype: 1,
          total: 2
        }
      });
    },
    30_000
  );

  it(
    'supports --workflow as a filter alternative to the positional workflow argument',
    async () => {
      const projectRoot = await createRenderCheckFixture();

      const result = await runRenderCheck(projectRoot, ['--workflow', 'adopted', '--json']);

      expect(result).toEqual({
        screens: [
          {
            workflow: 'adopted',
            screen: 'ready',
            status: 'pass'
          }
        ],
        summary: {
          pass: 1,
          fail: 0,
          prototype: 0,
          total: 1
        }
      });
    },
    30_000
  );
});

async function runRenderCheck(cwd: string, args: string[]): Promise<RenderCheckCommandPayload> {
  const { stdout, stderr } = await execFile('npx', ['tsx', cliPath, 'render-check', ...args], {
    cwd,
    maxBuffer: 10 * 1024 * 1024
  });

  expect(stderr).toBe('');

  const jsonSource = extractFirstJsonObject(stdout);
  expect(jsonSource).not.toBeNull();

  return JSON.parse(jsonSource ?? '{}') as RenderCheckCommandPayload;
}

function extractFirstJsonObject(source: string): string | null {
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

async function createRenderCheckFixture(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-cli-render-check-'));
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
      '<GreetingCard message="CLI render-check" />',
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

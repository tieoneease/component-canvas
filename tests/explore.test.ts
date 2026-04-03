import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { extractComponentAPI } from '../lib/explore.ts';

const execFile = promisify(execFileCallback);
const cliPath = resolve(process.cwd(), 'bin/cli.ts');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('extractComponentAPI', () => {
  it('extracts props, events, snippets, required flags, and defaults from $props()', async () => {
    const componentPath = await createComponentFixture(
      'Card.svelte',
      [
        '<script lang="ts">',
        "  import type { Snippet } from 'svelte';",
        '  let {',
        '    title,',
        '    count = 1,',
        '    featured = false,',
        '    onclick,',
        '    onSubmit,',
        '    children,',
        '    header',
        '  }: {',
        '    title: string;',
        '    count?: number;',
        '    featured?: boolean;',
        '    onclick?: (event: MouseEvent) => void;',
        '    onSubmit: (payload: { ok: boolean }) => void;',
        '    children?: Snippet;',
        '    header: Snippet<[string]>;',
        '  } = $props();',
        '</script>',
        '',
        '<div>{title}</div>',
        ''
      ].join('\n')
    );

    await expect(extractComponentAPI(componentPath)).resolves.toEqual({
      props: [
        {
          name: 'title',
          type: 'string',
          required: true,
          category: 'prop'
        },
        {
          name: 'count',
          type: 'number',
          required: false,
          category: 'prop',
          default: '1'
        },
        {
          name: 'featured',
          type: 'boolean',
          required: false,
          category: 'prop',
          default: 'false'
        }
      ],
      events: [
        {
          name: 'onclick',
          type: '(event: MouseEvent) => void',
          required: false,
          category: 'event'
        },
        {
          name: 'onSubmit',
          type: '(payload: { ok: boolean; }) => void',
          required: true,
          category: 'event'
        }
      ],
      snippets: [
        {
          name: 'children',
          type: 'Snippet<[]>',
          required: false,
          category: 'snippet'
        },
        {
          name: 'header',
          type: 'Snippet<[string]>',
          required: true,
          category: 'snippet'
        }
      ]
    });
  });

  it('returns empty sections for components without public props', async () => {
    const componentPath = await createComponentFixture(
      'Plain.svelte',
      ['<div data-plain>Hello</div>', ''].join('\n')
    );

    await expect(extractComponentAPI(componentPath)).resolves.toEqual({
      props: [],
      events: [],
      snippets: []
    });
  });

  it('preserves complex prop type strings', async () => {
    const componentPath = await createComponentFixture(
      'Complex.svelte',
      [
        '<script lang="ts">',
        '  let {',
        '    options,',
        "    variant = 'primary'",
        '  }: {',
        '    options: { mode: "light" | "dark"; retries?: number };',
        '    variant?: "primary" | "secondary";',
        '  } = $props();',
        '</script>',
        '',
        '<div>{variant}</div>',
        ''
      ].join('\n')
    );

    const api = await extractComponentAPI(componentPath);
    const options = api.props.find((prop) => prop.name === 'options');
    const variant = api.props.find((prop) => prop.name === 'variant');

    expect(options).toMatchObject({
      required: true,
      category: 'prop'
    });
    expect(options?.type).toContain('mode: "light" | "dark"');
    expect(options?.type).toContain('retries?: number');
    expect(variant).toEqual({
      name: 'variant',
      type: '"primary" | "secondary"',
      required: false,
      category: 'prop',
      default: "'primary'"
    });
  });
});

describe('component-canvas explore', () => {
  it('supports --json output from the CLI', async () => {
    const componentPath = await createComponentFixture(
      'CliCard.svelte',
      [
        '<script lang="ts">',
        '  let { label, disabled = false }: { label: string; disabled?: boolean } = $props();',
        '</script>',
        '',
        '<button>{label}</button>',
        ''
      ].join('\n')
    );

    const { stdout, stderr } = await execFile('npx', ['tsx', cliPath, 'explore', 'CliCard.svelte', '--json'], {
      cwd: resolve(componentPath, '..'),
      maxBuffer: 10 * 1024 * 1024
    });

    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({
      props: [
        {
          name: 'label',
          type: 'string',
          required: true,
          category: 'prop'
        },
        {
          name: 'disabled',
          type: 'boolean',
          required: false,
          category: 'prop',
          default: 'false'
        }
      ],
      events: [],
      snippets: []
    });
  });
});

async function createComponentFixture(fileName: string, source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'component-canvas-explore-'));
  const componentPath = resolve(dir, fileName);

  tempDirs.push(dir);
  await writeFile(componentPath, source, 'utf8');

  return componentPath;
}

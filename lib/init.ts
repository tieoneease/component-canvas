import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CANVAS_CONFIG_FILE_NAME, type CanvasConfig } from './config.ts';

export interface InitDetection {
  lib: boolean;
  tailwind: boolean;
}

export interface InitProjectResult {
  config: string | null;
  canvasDir: string;
  detected: InitDetection;
  created: string[];
  svelteConfig: boolean;
}

interface ProjectStructureDetection {
  detected: InitDetection;
  config: CanvasConfig;
  svelteConfig: boolean;
}

const CANVAS_DIR = '.canvas/';
const EXAMPLE_WORKFLOW_DIR = '.canvas/workflows/example/';
const EXAMPLE_FLOW_PATH = '.canvas/workflows/example/_flow.ts';
const EXAMPLE_SCREEN_PATH = '.canvas/workflows/example/ExampleScreen.svelte';
const TAILWIND_CONFIG_PRIORITY = [
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.mjs',
  'tailwind.config.cjs',
  'tailwind.config.mts',
  'tailwind.config.cts'
] as const;

export async function initProject(cwd: string): Promise<InitProjectResult> {
  const projectRoot = resolve(cwd);
  const detection = await detectProjectStructure(projectRoot);
  const created: string[] = [];

  await ensureDirectory(resolve(projectRoot, '.canvas'), CANVAS_DIR, created);
  await ensureDirectory(resolve(projectRoot, '.canvas', 'workflows', 'example'), EXAMPLE_WORKFLOW_DIR, created);
  await writeFileIfMissing(resolve(projectRoot, EXAMPLE_FLOW_PATH), createExampleFlowSource(), EXAMPLE_FLOW_PATH, created);
  await writeFileIfMissing(
    resolve(projectRoot, EXAMPLE_SCREEN_PATH),
    createExampleScreenSource(),
    EXAMPLE_SCREEN_PATH,
    created
  );

  const configPath = resolve(projectRoot, CANVAS_CONFIG_FILE_NAME);
  const shouldCreateConfig = detection.detected.lib || detection.detected.tailwind;
  const hasExistingConfig = await fileExists(configPath);

  if (shouldCreateConfig && !hasExistingConfig) {
    await writeFile(configPath, renderCanvasConfig(detection.config), 'utf8');
    created.unshift(CANVAS_CONFIG_FILE_NAME);
  }

  return {
    config: shouldCreateConfig || hasExistingConfig ? CANVAS_CONFIG_FILE_NAME : null,
    canvasDir: CANVAS_DIR,
    detected: detection.detected,
    created,
    svelteConfig: detection.svelteConfig
  };
}

async function detectProjectStructure(projectRoot: string): Promise<ProjectStructureDetection> {
  const hasLib = await directoryExists(resolve(projectRoot, 'src', 'lib'));
  const tailwindConfigFile = await findTailwindConfigFile(projectRoot);
  const hasSvelteConfig = await fileExists(resolve(projectRoot, 'svelte.config.js'));
  const config: CanvasConfig = {};

  if (hasLib) {
    config.lib = './src/lib';
  }

  if (tailwindConfigFile) {
    config.tailwind = `./${tailwindConfigFile}`;
  }

  return {
    detected: {
      lib: hasLib,
      tailwind: tailwindConfigFile !== null
    },
    config,
    svelteConfig: hasSvelteConfig
  };
}

async function findTailwindConfigFile(projectRoot: string): Promise<string | null> {
  for (const candidate of TAILWIND_CONFIG_PRIORITY) {
    if (await fileExists(resolve(projectRoot, candidate))) {
      return candidate;
    }
  }

  const entries = await readdir(projectRoot, { withFileTypes: true });
  const fallback = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('tailwind.config.'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))[0];

  return fallback ?? null;
}

async function ensureDirectory(path: string, displayPath: string, created: string[]): Promise<void> {
  const existed = await directoryExists(path);
  await mkdir(path, { recursive: true });

  if (!existed) {
    created.push(displayPath);
  }
}

async function writeFileIfMissing(
  path: string,
  content: string,
  displayPath: string,
  created: string[]
): Promise<void> {
  if (await fileExists(path)) {
    return;
  }

  await writeFile(path, content, 'utf8');
  created.push(displayPath);
}

function renderCanvasConfig(config: CanvasConfig): string {
  const entries = Object.entries(config);

  if (entries.length === 0) {
    return 'export default {}\n';
  }

  const lines = ['export default {'];

  for (const [key, value] of entries) {
    lines.push(`  ${key}: ${formatStringLiteral(value)},`);
  }

  lines.push('};', '');

  return lines.join('\n');
}

function formatStringLiteral(value: string): string {
  return `'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'")}'`;
}

function createExampleFlowSource(): string {
  return [
    'export default {',
    "  id: 'example',",
    "  title: 'Example Workflow',",
    '  screens: [',
    '    {',
    "      id: 'example-screen',",
    "      component: './ExampleScreen.svelte',",
    "      title: 'Example Screen',",
    '      props: {',
    "        heading: 'Example Screen',",
    "        message: 'Edit this file to start building your workflow.'",
    '      }',
    '    }',
    '  ],',
    '  transitions: []',
    '};',
    ''
  ].join('\n');
}

function createExampleScreenSource(): string {
  return [
    '<script>',
    "  export let heading = 'Example Screen';",
    "  export let message = 'Edit this file to start building your workflow.';",
    '</script>',
    '',
    '<div class="canvas-example-screen">',
    '  <h1>{heading}</h1>',
    '  <p>{message}</p>',
    '</div>',
    '',
    '<style>',
    '  .canvas-example-screen {',
    '    box-sizing: border-box;',
    '    display: grid;',
    '    gap: 0.75rem;',
    '    min-height: 100%;',
    '    padding: 1.5rem;',
    '    font-family: system-ui, sans-serif;',
    '    align-content: start;',
    '    background: #ffffff;',
    '    color: #0f172a;',
    '  }',
    '',
    '  h1 {',
    '    margin: 0;',
    '    font-size: 1.25rem;',
    '    font-weight: 600;',
    '  }',
    '',
    '  p {',
    '    margin: 0;',
    '    color: #475569;',
    '    line-height: 1.5;',
    '  }',
    '</style>',
    ''
  ].join('\n');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const metadata = await stat(path);
    return metadata.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const metadata = await stat(path);
    return metadata.isDirectory();
  } catch {
    return false;
  }
}


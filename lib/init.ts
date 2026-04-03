import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CANVAS_CONFIG_FILE_NAME } from './config.ts';

export type InitDetection = Record<string, never>;

export interface InitProjectResult {
  config: string | null;
  canvasDir: string;
  detected: InitDetection;
  created: string[];
  svelteConfig: boolean;
}

interface ProjectStructureDetection {
  detected: InitDetection;
  svelteConfig: boolean;
}

const CANVAS_DIR = '.canvas/';
const CANVAS_AGENTS_PATH = '.canvas/AGENTS.md';
const EXAMPLE_WORKFLOW_DIR = '.canvas/workflows/example/';
const EXAMPLE_FLOW_PATH = '.canvas/workflows/example/_flow.ts';
const EXAMPLE_SCREEN_PATH = '.canvas/workflows/example/ExampleScreen.svelte';
const SVELTE_CONFIG_FILES = [
  'svelte.config.js',
  'svelte.config.mjs',
  'svelte.config.cjs',
  'svelte.config.ts'
] as const;

export async function initProject(cwd: string): Promise<InitProjectResult> {
  const projectRoot = resolve(cwd);
  const detection = await detectProjectStructure(projectRoot);
  const created: string[] = [];

  await ensureDirectory(resolve(projectRoot, '.canvas'), CANVAS_DIR, created);
  await writeFileIfMissing(
    resolve(projectRoot, CANVAS_AGENTS_PATH),
    createCanvasAgentsSource(),
    CANVAS_AGENTS_PATH,
    created
  );
  await ensureDirectory(resolve(projectRoot, '.canvas', 'workflows', 'example'), EXAMPLE_WORKFLOW_DIR, created);
  await writeFileIfMissing(resolve(projectRoot, EXAMPLE_FLOW_PATH), createExampleFlowSource(), EXAMPLE_FLOW_PATH, created);
  await writeFileIfMissing(resolve(projectRoot, EXAMPLE_SCREEN_PATH), createExampleScreenSource(), EXAMPLE_SCREEN_PATH, created);

  const configPath = resolve(projectRoot, CANVAS_CONFIG_FILE_NAME);
  const hasExistingConfig = await fileExists(configPath);

  return {
    config: hasExistingConfig ? CANVAS_CONFIG_FILE_NAME : null,
    canvasDir: CANVAS_DIR,
    detected: detection.detected,
    created,
    svelteConfig: detection.svelteConfig
  };
}

async function detectProjectStructure(projectRoot: string): Promise<ProjectStructureDetection> {
  return {
    detected: {},
    svelteConfig: await anyFileExists(projectRoot, SVELTE_CONFIG_FILES)
  };
}

async function ensureDirectory(path: string, displayPath: string, created: string[]): Promise<void> {
  const existed = await directoryExists(path);
  await mkdir(path, { recursive: true });
  if (!existed) created.push(displayPath);
}

async function writeFileIfMissing(path: string, content: string, displayPath: string, created: string[]): Promise<void> {
  if (await fileExists(path)) return;
  await writeFile(path, content, 'utf8');
  created.push(displayPath);
}

function createCanvasAgentsSource(): string {
  return `# component-canvas

## Architecture

- Workflows live in \`.canvas/workflows/<workflow>/\` with a \`_flow.ts\` manifest and screen components.
- The canvas shell is prebuilt UI. Screen previews render in separate iframes so they use the project's own Svelte + Vite runtime.
- The preview server loads the project's \`vite.config.ts\` automatically, so aliases, plugins, and global CSS belong there.

## Config

- \`canvas.config.ts\` is optional.
- Only add it when you need:
  - \`mocks\` to replace imports during previews
  - \`purity\` to enforce visual-component boundaries
- \`canvas.config.ts\` no longer accepts \`lib\`, aliases, or global CSS settings.

## Commands

- \`component-canvas explore <path>\` extracts props, \`on*\` callbacks, and snippets from a component.
- \`component-canvas render <path> --props '{...}'\` creates an ephemeral live preview URL for a component state.
`;
}

function createExampleFlowSource(): string {
  return `export default {
  id: 'example',
  title: 'Example Workflow',
  screens: [
    {
      id: 'example-screen',
      component: './ExampleScreen.svelte',
      title: 'Example Screen',
      props: {
        heading: 'Example Screen',
        message: 'Edit this file to start building your workflow.'
      }
    }
  ],
  transitions: []
};
`;
}

function createExampleScreenSource(): string {
  return `<script>
  export let heading = 'Example Screen';
  export let message = 'Edit this file to start building your workflow.';
</script>

<div class="canvas-example-screen">
  <h1>{heading}</h1>
  <p>{message}</p>
</div>

<style>
  .canvas-example-screen {
    box-sizing: border-box;
    display: grid;
    gap: 0.75rem;
    min-height: 100%;
    padding: 1.5rem;
    font-family: system-ui, sans-serif;
    align-content: start;
    background: #ffffff;
    color: #0f172a;
  }
  h1 { margin: 0; font-size: 1.25rem; font-weight: 600; }
  p { margin: 0; color: #475569; line-height: 1.5; }
</style>
`;
}

async function anyFileExists(projectRoot: string, fileNames: readonly string[]): Promise<boolean> {
  for (const fileName of fileNames) {
    if (await fileExists(resolve(projectRoot, fileName))) {
      return true;
    }
  }

  return false;
}

async function fileExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function directoryExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

import { constants } from 'node:fs';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SvelteAdapter } from './adapter.ts';
import {
  parseWorkflowManifests,
  type ManifestError,
  type Screen,
  type WorkflowManifest
} from './manifest.ts';
import { createBrowserPool, type BrowserPool } from './screenshot.ts';
import { startServer } from './server.ts';

export interface RenderCheckOptions {
  canvasDir: string;
  projectRoot?: string;
  workflowId?: string;
  serverUrl?: string;
}

export interface ScreenCheckResult {
  workflow: string;
  screen: string;
  status: 'pass' | 'fail' | 'prototype';
  error?: string;
}

export interface RenderCheckResult {
  screens: ScreenCheckResult[];
  summary: {
    pass: number;
    fail: number;
    prototype: number;
    total: number;
  };
}

interface ServerLease {
  url: string;
  close: () => Promise<void>;
}

export async function renderCheck(options: RenderCheckOptions): Promise<RenderCheckResult> {
  const resolvedCanvasDir = resolve(options.canvasDir);
  const resolvedProjectRoot = resolve(options.projectRoot ?? dirname(resolvedCanvasDir));
  const manifestResult = await parseWorkflowManifests(resolvedCanvasDir);

  if (manifestResult.errors.length > 0) {
    throw new Error(formatManifestErrors(manifestResult.errors));
  }

  const workflows = selectWorkflows(manifestResult.workflows, options.workflowId);
  const adapter = new SvelteAdapter();
  const workflowDirectories = await resolveWorkflowDirectories(resolvedCanvasDir);
  const screens: ScreenCheckResult[] = [];

  let browserPool: BrowserPool | undefined;
  let serverLease: ServerLease | undefined;
  let tempDir: string | undefined;
  let screenshotIndex = 0;

  try {
    for (const workflow of workflows) {
      for (const screen of workflow.screens) {
        try {
          const componentPath = resolveScreenComponentPath(
            resolvedCanvasDir,
            workflow.id,
            screen,
            workflowDirectories
          );
          const screenSource = await readFile(componentPath, 'utf8');

          if (adapter.isPrototypeScreen(screenSource)) {
            screens.push({
              workflow: workflow.id,
              screen: screen.id,
              status: 'prototype'
            });
            continue;
          }

          if (!serverLease) {
            serverLease = options.serverUrl
              ? createExternalServerLease(options.serverUrl)
              : await startServer({
                  canvasDir: resolvedCanvasDir,
                  projectRoot: resolvedProjectRoot,
                  logLevel: 'silent'
                });
          }

          browserPool ??= await createBrowserPool();
          tempDir ??= await mkdtemp(join(tmpdir(), 'component-canvas-render-check-'));

          const outputPath = join(
            tempDir,
            `${String(screenshotIndex).padStart(4, '0')}-${sanitizePathSegment(workflow.id)}-${sanitizePathSegment(screen.id)}.png`
          );
          screenshotIndex += 1;
          const selector = `[data-isolated-screen="${escapeAttributeValue(screen.id)}"]`;
          const url = `${ensureTrailingSlash(serverLease.url)}#/screen/${encodeURIComponent(workflow.id)}/${encodeURIComponent(screen.id)}`;

          await browserPool.capture({
            url,
            selector,
            waitForSelector: selector,
            outputPath
          });

          screens.push({
            workflow: workflow.id,
            screen: screen.id,
            status: 'pass'
          });
        } catch (error) {
          screens.push({
            workflow: workflow.id,
            screen: screen.id,
            status: 'fail',
            error: getErrorMessage(error)
          });
        }
      }
    }
  } finally {
    const cleanups: Promise<unknown>[] = [];

    if (browserPool) {
      cleanups.push(browserPool.close());
    }

    if (serverLease) {
      cleanups.push(serverLease.close());
    }

    if (tempDir) {
      cleanups.push(rm(tempDir, { recursive: true, force: true }));
    }

    await Promise.allSettled(cleanups);
  }

  return {
    screens,
    summary: summarizeResults(screens)
  };
}

function selectWorkflows(workflows: WorkflowManifest[], workflowId?: string): WorkflowManifest[] {
  if (!workflowId) {
    return workflows;
  }

  const selected = workflows.filter((workflow) => workflow.id === workflowId);

  if (selected.length === 0) {
    throw new Error(`Workflow "${workflowId}" was not found.`);
  }

  return selected;
}

function createExternalServerLease(serverUrl: string): ServerLease {
  return {
    url: serverUrl,
    close: async () => {}
  };
}

function resolveScreenComponentPath(
  canvasDir: string,
  workflowId: string,
  screen: Screen,
  workflowDirectories: Map<string, string>
): string {
  const workflowDir = workflowDirectories.get(workflowId) ?? resolve(canvasDir, 'workflows', workflowId);

  return resolve(workflowDir, screen.component);
}

async function resolveWorkflowDirectories(canvasDir: string): Promise<Map<string, string>> {
  const workflowsDir = resolve(canvasDir, 'workflows');

  if (!(await pathExists(workflowsDir))) {
    return new Map();
  }

  const entries = await readdir(workflowsDir, { withFileTypes: true });
  const workflowDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(workflowsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const directories = new Map<string, string>();

  for (const workflowDir of workflowDirs) {
    const manifestFile = join(workflowDir, '_flow.ts');

    if (!(await pathExists(manifestFile))) {
      continue;
    }

    try {
      const manifestModule = await importFreshModule(manifestFile);
      const workflowId = getWorkflowIdFromModule(manifestModule) ?? basename(workflowDir);
      directories.set(workflowId, workflowDir);
    } catch {
      directories.set(basename(workflowDir), workflowDir);
    }
  }

  return directories;
}

async function importFreshModule(modulePath: string): Promise<unknown> {
  const moduleUrl = pathToFileURL(modulePath);
  const metadata = await stat(modulePath);

  moduleUrl.searchParams.set('t', String(metadata.mtimeMs));

  return import(moduleUrl.href);
}

function getWorkflowIdFromModule(moduleValue: unknown): string | undefined {
  if (!isPlainObject(moduleValue) || !('default' in moduleValue) || !isPlainObject(moduleValue.default)) {
    return undefined;
  }

  const workflowId = moduleValue.default.id;
  return typeof workflowId === 'string' && workflowId.trim().length > 0 ? workflowId : undefined;
}

function formatManifestErrors(errors: ManifestError[]): string {
  return [
    'Failed to parse workflow manifests:',
    ...errors.map((error) => `- ${error.file}: ${error.message}`)
  ].join('\n');
}

function summarizeResults(screens: ScreenCheckResult[]): RenderCheckResult['summary'] {
  return screens.reduce<RenderCheckResult['summary']>(
    (summary, screen) => {
      summary.total += 1;
      summary[screen.status] += 1;
      return summary;
    },
    {
      pass: 0,
      fail: 0,
      prototype: 0,
      total: 0
    }
  );
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');

  return sanitized.length > 0 ? sanitized : 'screen';
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

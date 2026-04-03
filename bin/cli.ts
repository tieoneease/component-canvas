#!/usr/bin/env node

import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { Command, InvalidArgumentError } from 'commander';

import { CANVAS_CONFIG_FILE_NAME, loadConfig, type CanvasConfig } from '../lib/config.ts';
import { initProject, type InitProjectResult } from '../lib/init.ts';
import {
  parseWorkflowManifests,
  type ManifestError,
  type WorkflowManifest
} from '../lib/manifest.ts';
import { renderCheck, type RenderCheckResult } from '../lib/render-check.ts';
import { createBrowserPool } from '../lib/screenshot.ts';
import { startServer } from '../lib/server.ts';
import {
  escapeAttributeValue,
  getErrorMessage,
  isPlainObject,
  pathExists,
  sanitizePathSegment
} from '../lib/utils.ts';

interface JsonFlagOptions {
  json?: boolean;
}

interface DevCommandOptions extends JsonFlagOptions {
  port?: number;
}

interface ListCommandOptions extends JsonFlagOptions {}

interface ScreenshotCommandOptions extends JsonFlagOptions {
  screen?: string;
  all?: boolean;
  output?: string;
}

interface RenderCheckCommandOptions extends JsonFlagOptions {
  workflow?: string;
}

interface InitCommandOptions extends JsonFlagOptions {}

interface ProjectContext {
  cwd: string;
  projectRoot: string;
  canvasDir: string;
  configPath?: string;
  config: CanvasConfig | null;
}

interface WorkflowSummary {
  id: string;
  title: string;
  screens: number;
  transitions: number;
  variants: number;
}

interface ScreenshotTarget {
  workflow: WorkflowManifest;
  screenId: string;
}

interface ScreenshotOutput {
  workflow: string;
  screen: string;
  path: string;
  width: number;
  height: number;
}

interface RunningServerState {
  url: string;
  port: number;
  pid: number;
}

interface ServerLease {
  url: string;
  close: () => Promise<void>;
}

class CliError extends Error {
  details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'CliError';
    this.details = details;
  }
}

const program = new Command();
const DEV_SERVER_STATE_FILE = '.component-canvas-dev.json';

program
  .name('component-canvas')
  .description('Render real Svelte workflow canvases from a .canvas directory.')
  .version('0.0.0')
  .showHelpAfterError();

program
  .command('dev')
  .description('Start the component-canvas Vite dev server.')
  .option('--port <n>', 'Port to listen on', parsePortOption)
  .option('--json', 'Output machine-readable JSON')
  .action(async (options: DevCommandOptions, command: Command) => {
    await runCommand(command, async () => {
      const context = await resolveProjectContext(process.cwd(), { requireCanvas: true });
      const server = await startServer({
        ...toServerOptions(context),
        port: options.port
      });

      try {
        await writeRunningServerState(context, server.url);

        const payload = {
          url: server.url,
          port: getPortFromUrl(server.url)
        };

        if (options.json) {
          writeJson(payload);
        } else {
          process.stdout.write(`component-canvas dev server running at ${server.url}\n`);
        }

        await waitForShutdownSignal();
      } finally {
        await Promise.all([server.close(), removeRunningServerState(context)]);
      }
    });
  });

program
  .command('list')
  .description('List workflows discovered under .canvas/workflows/.')
  .option('--json', 'Output machine-readable JSON')
  .action(async (options: ListCommandOptions, command: Command) => {
    await runCommand(command, async () => {
      const context = await resolveProjectContext(process.cwd(), { requireCanvas: true });
      const manifestResult = await parseWorkflowManifests(context.canvasDir);
      assertManifestSuccess(manifestResult.errors);

      const summaries = createWorkflowSummaries(manifestResult.workflows);

      if (options.json) {
        writeJson({ workflows: summaries });
        return;
      }

      if (summaries.length === 0) {
        process.stdout.write(`No workflows found in ${displayPath(resolve(context.canvasDir, 'workflows'))}.\n`);
        return;
      }

      process.stdout.write(formatWorkflowTable(summaries));
      process.stdout.write('\n');
    });
  });

program
  .command('screenshot')
  .description('Capture workflow screens as PNG files.')
  .argument('[workflow]', 'Workflow id to capture')
  .option('--screen <id>', 'Capture a single screen within the selected workflow')
  .option('--all', 'Capture every screen in every workflow')
  .option('--output <dir>', 'Output directory for PNG files')
  .option('--json', 'Output machine-readable JSON')
  .action(async (workflow: string | undefined, options: ScreenshotCommandOptions, command: Command) => {
    await runCommand(command, async () => {
      if (options.all && workflow) {
        throw new CliError('Do not pass a workflow id together with --all.');
      }

      if (options.all && options.screen) {
        throw new CliError('Do not pass --screen together with --all.');
      }

      if (!options.all && !workflow) {
        throw new CliError('Provide a workflow id or pass --all.');
      }

      if (!workflow && options.screen) {
        throw new CliError('Pass a workflow id when using --screen.');
      }

      const context = await resolveProjectContext(process.cwd(), { requireCanvas: true });
      const manifestResult = await parseWorkflowManifests(context.canvasDir);
      assertManifestSuccess(manifestResult.errors);

      const outputRoot = resolveScreenshotOutputRoot(context, options.output);
      const server = await acquireServer(context);
      const browserPool = await createBrowserPool();

      try {
        const screenshots: ScreenshotOutput[] = [];

        if (options.screen) {
          // Single screen: isolated full-viewport render (no device chrome)
          const wf = manifestResult.workflows.find((w) => w.id === workflow);
          if (!wf) throw new CliError(`Workflow "${workflow}" was not found.`);
          const screen = wf.screens.find((s) => s.id === options.screen);
          if (!screen) throw new CliError(`Screen "${options.screen}" not found in workflow "${wf.id}".`);

          const screenUrl = `${server.url}#/screen/${encodeURIComponent(wf.id)}/${encodeURIComponent(screen.id)}`;
          const outputPath = join(outputRoot, sanitizePathSegment(wf.id), `${sanitizePathSegment(screen.id)}.png`);
          const result = await browserPool.capture({
            url: screenUrl,
            waitForSelector: `[data-isolated-screen="${escapeAttributeValue(screen.id)}"]`,
            outputPath
          });
          screenshots.push({ workflow: wf.id, screen: screen.id, path: result.path, width: result.width, height: result.height });
        } else {
          // Workflow-level or --all: capture the full workflow canvas for each workflow
          const targetWorkflows = options.all
            ? manifestResult.workflows
            : [manifestResult.workflows.find((w) => w.id === workflow) ?? (() => { throw new CliError(`Workflow "${workflow}" was not found.`); })()];

          for (const wf of targetWorkflows) {
            const workflowUrl = `${server.url}#/workflow/${encodeURIComponent(wf.id)}`;
            const outputPath = join(outputRoot, `${sanitizePathSegment(wf.id)}.png`);
            const canvasSelector = `[data-workflow-id="${escapeAttributeValue(wf.id)}"]`;
            const result = await browserPool.capture({
              url: workflowUrl,
              selector: canvasSelector,
              waitForSelector: canvasSelector,
              outputPath
            });
            screenshots.push({ workflow: wf.id, screen: '*', path: result.path, width: result.width, height: result.height });
          }
        }

        if (options.json) {
          writeJson({ screenshots });
          return;
        }

        if (screenshots.length === 0) {
          process.stdout.write('No screenshots were captured.\n');
          return;
        }

        for (const screenshot of screenshots) {
          const label = screenshot.screen === '*' ? screenshot.workflow : `${screenshot.workflow}/${screenshot.screen}`;
          process.stdout.write(`${label} -> ${displayPath(screenshot.path)}\n`);
        }
      } finally {
        await Promise.all([browserPool.close(), server.close()]);
      }
    });
  });

program
  .command('render-check')
  .description('Render canvas screens and report pass/fail/prototype status.')
  .argument('[workflow]', 'Workflow id to check')
  .option('--workflow <id>', 'Workflow id to check (alternative to the positional argument)')
  .option('--json', 'Output machine-readable JSON')
  .action(async (workflowArgument: string | undefined, options: RenderCheckCommandOptions, command: Command) => {
    await runCommand(command, async () => {
      const workflowId = resolveRenderCheckWorkflow(workflowArgument, options.workflow);
      const context = await resolveProjectContext(process.cwd(), { requireCanvas: true });
      const server = await acquireServer(context);

      try {
        const result = await renderCheck({
          canvasDir: context.canvasDir,
          projectRoot: context.projectRoot,
          workflowId,
          serverUrl: server.url
        });

        if (options.json) {
          writeJson(result);
        } else {
          process.stdout.write(`${formatRenderCheckTable(result)}\n${formatRenderCheckSummary(result)}\n`);
        }

        if (result.summary.fail > 0) {
          process.exitCode = 1;
        }
      } finally {
        await server.close();
      }
    });
  });

program
  .command('init')
  .description('Initialize component-canvas config and sample workflow files.')
  .option('--json', 'Output machine-readable JSON')
  .action(async (options: InitCommandOptions, command: Command) => {
    await runCommand(command, async () => {
      const result = await initProject(process.cwd());

      if (options.json) {
        writeJson({
          config: result.config,
          canvasDir: result.canvasDir,
          detected: result.detected
        });
        return;
      }

      process.stdout.write(`${formatInitSummary(result)}\n`);
    });
  });

await program.parseAsync(process.argv);

async function runCommand(command: Command, action: () => Promise<void>): Promise<void> {
  const options = command.optsWithGlobals<JsonFlagOptions>();

  try {
    await action();
  } catch (error) {
    reportError(error, Boolean(options.json));
    process.exitCode = 1;
  }
}

function reportError(error: unknown, asJson: boolean): void {
  const message = getErrorMessage(error);
  const details = error instanceof CliError ? error.details : undefined;

  if (asJson) {
    writeJson(details === undefined ? { error: message } : { error: message, details });
    return;
  }

  process.stderr.write(`Error: ${message}\n`);

  if (details && Array.isArray(details)) {
    for (const detail of details) {
      if (isManifestError(detail)) {
        process.stderr.write(`- ${detail.file}: ${detail.message}\n`);
      }
    }
  }
}

async function resolveProjectContext(
  startDir: string,
  options: { requireCanvas: boolean }
): Promise<ProjectContext> {
  const cwd = resolve(startDir);
  let currentDir = cwd;

  while (true) {
    const configPath = join(currentDir, CANVAS_CONFIG_FILE_NAME);
    const defaultCanvasDir = join(currentDir, '.canvas');
    const hasConfig = await pathExists(configPath);
    const hasCanvas = await directoryExists(defaultCanvasDir);

    if (hasConfig || hasCanvas) {
      const config = hasConfig ? await loadConfig(currentDir) : null;
      const canvasDir = resolveCanvasDir(currentDir, config);

      if (options.requireCanvas && !(await directoryExists(canvasDir))) {
        throw new CliError(
          `No .canvas directory found at ${displayPath(canvasDir)}. Run "component-canvas init" to create one.`,
          {
            projectRoot: currentDir,
            configPath: hasConfig ? configPath : undefined,
            canvasDir
          }
        );
      }

      return {
        cwd,
        projectRoot: currentDir,
        canvasDir,
        configPath: hasConfig ? configPath : undefined,
        config
      };
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  const canvasDir = join(cwd, '.canvas');

  if (options.requireCanvas && !(await directoryExists(canvasDir))) {
    throw new CliError(
      `No .canvas directory found in ${displayPath(cwd)}. Run "component-canvas init" to create one.`
    );
  }

  return {
    cwd,
    projectRoot: cwd,
    canvasDir,
    config: null
  };
}

function resolveCanvasDir(projectRoot: string, config: CanvasConfig | null): string {
  const configuredCanvasDir = config?.canvasDir;

  if (configuredCanvasDir) {
    return resolve(projectRoot, configuredCanvasDir);
  }

  return resolve(projectRoot, '.canvas');
}

function toServerOptions(context: ProjectContext): {
  canvasDir: string;
  projectRoot: string;
} {
  return {
    canvasDir: context.canvasDir,
    projectRoot: context.projectRoot
  };
}

async function acquireServer(context: ProjectContext): Promise<ServerLease> {
  const runningServer = await readRunningServerState(context);

  if (runningServer && (await isServerReachable(runningServer.url))) {
    return {
      url: runningServer.url,
      close: async () => {}
    };
  }

  if (runningServer) {
    await removeRunningServerState(context);
  }

  const server = await startServer({
    ...toServerOptions(context),
    logLevel: 'silent'
  });

  return {
    url: server.url,
    close: server.close
  };
}

async function writeRunningServerState(context: ProjectContext, url: string): Promise<void> {
  const statePath = resolve(context.canvasDir, DEV_SERVER_STATE_FILE);
  const payload: RunningServerState = {
    url,
    port: getPortFromUrl(url),
    pid: process.pid
  };

  await writeFile(statePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function readRunningServerState(context: ProjectContext): Promise<RunningServerState | null> {
  const statePath = resolve(context.canvasDir, DEV_SERVER_STATE_FILE);

  if (!(await pathExists(statePath))) {
    return null;
  }

  try {
    const raw = await readFile(statePath, 'utf8');
    const value = JSON.parse(raw) as unknown;

    if (
      !isPlainObject(value) ||
      typeof value.url !== 'string' ||
      typeof value.port !== 'number' ||
      typeof value.pid !== 'number'
    ) {
      return null;
    }

    return {
      url: value.url,
      port: value.port,
      pid: value.pid
    };
  } catch {
    return null;
  }
}

async function removeRunningServerState(context: ProjectContext): Promise<void> {
  const statePath = resolve(context.canvasDir, DEV_SERVER_STATE_FILE);

  try {
    await rm(statePath, { force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

async function isServerReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1_500)
    });

    return response.ok;
  } catch {
    return false;
  }
}

function createWorkflowSummaries(workflows: WorkflowManifest[]): WorkflowSummary[] {
  return workflows.map((workflow) => ({
    id: workflow.id,
    title: workflow.title,
    screens: workflow.screens.length,
    transitions: workflow.transitions.length,
    variants: workflow.variants?.length ?? 0
  }));
}

function formatWorkflowTable(workflows: WorkflowSummary[]): string {
  return formatTable(
    ['ID', 'TITLE', 'SCREENS', 'TRANSITIONS', 'VARIANTS'],
    workflows.map((workflow) => [
      workflow.id,
      workflow.title,
      String(workflow.screens),
      String(workflow.transitions),
      String(workflow.variants)
    ])
  );
}

function formatRenderCheckTable(result: RenderCheckResult): string {
  return formatTable(
    ['WORKFLOW', 'SCREEN', 'STATUS'],
    result.screens.map((screen) => [screen.workflow, screen.screen, screen.status])
  );
}

function formatRenderCheckSummary(result: RenderCheckResult): string {
  return `${result.summary.pass} passed, ${result.summary.fail} failed, ${result.summary.prototype} prototype`;
}

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => {
    return Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0));
  });
  const formatRow = (columns: string[]) => {
    return columns
      .map((column, index) => column.padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  };

  return [formatRow(headers), formatRow(widths.map((width) => '-'.repeat(width))), ...rows.map(formatRow)].join(
    '\n'
  );
}

function formatInitSummary(result: InitProjectResult): string {
  const lines = ['Initialized component-canvas.'];

  if (result.created.length > 0) {
    lines.push('', 'Created:');

    for (const entry of result.created) {
      lines.push(`- ${entry}`);
    }
  } else {
    lines.push('', 'Nothing new was created. Existing files were left unchanged.');
  }

  lines.push('', 'Detected project features:');
  lines.push(`- src/lib: ${result.detected.lib ? 'yes' : 'no'}`);
  lines.push(`- svelte.config.js: ${result.svelteConfig ? 'yes' : 'no'}`);

  if (result.config === null) {
    lines.push('', 'No canvas.config.ts was created because no project-mode features were detected.');
  }

  return lines.join('\n');
}

function assertManifestSuccess(errors: ManifestError[]): void {
  if (errors.length === 0) {
    return;
  }

  throw new CliError(
    `Manifest validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}.`,
    errors
  );
}

function resolveRenderCheckWorkflow(
  workflowArgument: string | undefined,
  workflowOption: string | undefined
): string | undefined {
  if (workflowArgument && workflowOption && workflowArgument !== workflowOption) {
    throw new CliError(
      `Positional workflow id "${workflowArgument}" does not match --workflow "${workflowOption}".`
    );
  }

  return workflowArgument ?? workflowOption;
}

function resolveScreenshotOutputRoot(context: ProjectContext, output?: string): string {
  if (output) {
    return resolve(process.cwd(), output);
  }

  return resolve(context.canvasDir, 'screenshots');
}

function parsePortOption(value: string): number {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port <= 0) {
    throw new InvalidArgumentError('Port must be a positive integer.');
  }

  return port;
}

function getPortFromUrl(url: string): number {
  const parsedUrl = new URL(url);
  return Number(parsedUrl.port);
}

async function waitForShutdownSignal(): Promise<'SIGINT' | 'SIGTERM'> {
  return new Promise<'SIGINT' | 'SIGTERM'>((resolveSignal) => {
    const onSigint = () => {
      cleanup();
      resolveSignal('SIGINT');
    };
    const onSigterm = () => {
      cleanup();
      resolveSignal('SIGTERM');
    };
    const cleanup = () => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    };

    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
  });
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const metadata = await stat(path);
    return metadata.isDirectory();
  } catch {
    return false;
  }
}

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function displayPath(path: string): string {
  const relativePath = relative(process.cwd(), path);

  if (relativePath && !relativePath.startsWith('..')) {
    return relativePath;
  }

  return path;
}

function isManifestError(value: unknown): value is ManifestError {
  return isPlainObject(value) && typeof value.file === 'string' && typeof value.message === 'string';
}

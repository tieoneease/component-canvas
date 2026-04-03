import { execFile as execFileCallback, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { renderCheck } from '../lib/render-check.ts';
import { createViteConfigSource, extractFirstJsonObject } from './helpers.ts';

const execFile = promisify(execFileCallback);
const cliPath = resolve(process.cwd(), 'bin/cli.ts');
const tempDirs: string[] = [];
const activeChildren = new Set<ChildProcessWithoutNullStreams>();
const PNG_SIGNATURE_HEX = '89504e470d0a1a0a';
const DEV_STATE_FILE = '.component-canvas-dev.json';

interface DevCommandPayload {
  url: string;
  port: number;
}

interface ListCommandPayload {
  workflows: Array<{
    id: string;
    title: string;
    screens: number;
    transitions: number;
    variants: number;
  }>;
}

interface ScreenshotCommandPayload {
  screenshots: Array<{
    workflow: string;
    screen: string;
    path: string;
    width: number;
    height: number;
  }>;
}

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

interface CliCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface StartedDevCommand {
  child: ChildProcessWithoutNullStreams;
  payload: DevCommandPayload;
  stdout: () => string;
  stderr: () => string;
}

afterEach(async () => {
  await Promise.all(
    Array.from(activeChildren, (child) => stopChildProcess(child).catch(() => undefined))
  );
  activeChildren.clear();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('component-canvas acceptance workflow', () => {
  it(
    'runs init → custom workflow creation → dev → list → screenshot → stop in a fresh project',
    async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-acceptance-'));
      tempDirs.push(projectRoot);

      const initPayload = await runJsonCli<{ config: string | null; canvasDir: string; detected: { lib: boolean } }>(
        projectRoot,
        ['init', '--json']
      );

      expect(initPayload).toEqual({
        config: null,
        canvasDir: '.canvas/',
        detected: {
          lib: false
        }
      });
      await expect(access(resolve(projectRoot, '.canvas', 'workflows', 'example', '_flow.ts'))).resolves.toBeUndefined();
      await expect(
        access(resolve(projectRoot, '.canvas', 'workflows', 'example', 'ExampleScreen.svelte'))
      ).resolves.toBeUndefined();

      const canvasRealPath = await realpath(resolve(projectRoot, '.canvas'));

      await createSignupWorkflow(projectRoot);

      const devCommand = await startDevCommand(projectRoot);
      const devUrl = devCommand.payload.url;
      const devStatePath = resolve(projectRoot, '.canvas', DEV_STATE_FILE);

      expect(devCommand.payload.port).toBe(Number.parseInt(new URL(devUrl).port, 10));
      expect(await isUrlReachable(devUrl)).toBe(true);
      expect(await readJsonFile<{ url: string; port: number; pid: number }>(devStatePath)).toMatchObject({
        url: devUrl,
        port: devCommand.payload.port
      });

      const devResponse = await fetch(devUrl, { signal: AbortSignal.timeout(10_000) });
      const devHtml = await devResponse.text();
      expect(devResponse.ok).toBe(true);
      expect(devHtml).toContain('id="shell-app"');

      const listPayload = await runJsonCli<ListCommandPayload>(projectRoot, ['list', '--json']);
      expect(sortWorkflows(listPayload.workflows)).toEqual([
        {
          id: 'example',
          title: 'Example Workflow',
          screens: 1,
          transitions: 0,
          variants: 0
        },
        {
          id: 'signup',
          title: 'Signup Flow',
          screens: 2,
          transitions: 1,
          variants: 0
        }
      ]);

      // Workflow-level screenshot: captures entire canvas (all screens + arrows)
      const signupScreenshotPayload = await runJsonCli<ScreenshotCommandPayload>(projectRoot, [
        'screenshot',
        'signup',
        '--json'
      ]);

      expect(signupScreenshotPayload.screenshots).toHaveLength(1);
      expect(signupScreenshotPayload.screenshots[0].workflow).toBe('signup');
      expect(signupScreenshotPayload.screenshots[0].screen).toBe('*');
      expect(signupScreenshotPayload.screenshots[0].path).toBe(
        resolve(canvasRealPath, 'screenshots', 'signup.png')
      );
      await assertScreenshotOutputs(signupScreenshotPayload.screenshots);
      expect(await isUrlReachable(devUrl)).toBe(true);

      // --all captures each workflow as one canvas image
      const allScreenshotPayload = await runJsonCli<ScreenshotCommandPayload>(projectRoot, [
        'screenshot',
        '--all',
        '--json'
      ]);
      const allScreenshots = sortScreenshots(allScreenshotPayload.screenshots);

      expect(allScreenshots).toHaveLength(2);
      expect(allScreenshots.map(({ workflow }) => workflow)).toEqual(['example', 'signup']);
      expect(allScreenshots.every(({ screen }) => screen === '*')).toBe(true);
      await assertScreenshotOutputs(allScreenshots);
      expect(await isUrlReachable(devUrl)).toBe(true);

      const stopResult = await stopChildProcess(devCommand.child);
      activeChildren.delete(devCommand.child);

      expect(stopResult.code).toBe(0);
      expect(stopResult.signal).toBeNull();
      expect(stripIgnorableDevWarnings(devCommand.stderr())).toBe('');
      await expect(access(devStatePath)).rejects.toThrow();
      expect(await isUrlReachable(devUrl)).toBe(false);
    },
    90_000
  );

  // TODO: restore once preview-server purity enforcement is wired end-to-end for project-vite-driven imports.
  it.skip(
    'reports purity violations as render-check failures end-to-end',
    async () => {
      const projectRoot = await createPurityViolationAcceptanceFixture();
      const canvasDir = resolve(projectRoot, '.canvas');
      const devCommand = await startDevCommand(projectRoot);

      try {
        const result = await renderCheck({
          canvasDir,
          projectRoot,
          serverUrl: devCommand.payload.url
        });

        expect(result.screens).toEqual([
          {
            workflow: 'impure',
            screen: 'blocked',
            status: 'fail',
            error: expect.stringContaining('Purity violation')
          }
        ]);
        expect(result.summary).toEqual({
          pass: 0,
          fail: 1,
          prototype: 0,
          total: 1
        });
      } finally {
        await stopChildProcess(devCommand.child);
        activeChildren.delete(devCommand.child);
      }
    },
    60_000
  );

  it(
    'returns the full render-check JSON shape for pass/fail/prototype screens',
    async () => {
      const projectRoot = await createRenderCheckAcceptanceFixture();

      const result = await runJsonCli<RenderCheckCommandPayload>(projectRoot, ['render-check', '--json'], {
        expectedExitCode: 1
      });

      expect(result).toEqual({
        screens: [
          {
            workflow: 'adopted',
            screen: 'ready',
            status: 'pass'
          },
          {
            workflow: 'broken',
            screen: 'crashed',
            status: 'fail',
            error: expect.stringContaining('Broken screen exploded')
          },
          {
            workflow: 'prototype',
            screen: 'concept',
            status: 'prototype'
          }
        ],
        summary: {
          pass: 1,
          fail: 1,
          prototype: 1,
          total: 3
        }
      });
    },
    60_000
  );

  it(
    'filters render-check output to a single workflow with --workflow',
    async () => {
      const projectRoot = await createRenderCheckAcceptanceFixture();

      const result = await runJsonCli<RenderCheckCommandPayload>(projectRoot, [
        'render-check',
        '--workflow',
        'adopted',
        '--json'
      ]);

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
    60_000
  );
});

async function runJsonCli<T>(
  cwd: string,
  args: string[],
  options: { expectedExitCode?: number } = {}
): Promise<T> {
  const result = await runCliCommand(cwd, args);
  const jsonSource = extractFirstJsonObject(result.stdout);

  expect(result.exitCode).toBe(options.expectedExitCode ?? 0);
  expect(result.stderr).toBe('');
  expect(jsonSource).not.toBeNull();

  return JSON.parse(jsonSource ?? '{}') as T;
}

async function runCliCommand(cwd: string, args: string[]): Promise<CliCommandResult> {
  try {
    const { stdout, stderr } = await execFile('npx', ['tsx', cliPath, ...args], {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    });

    return {
      stdout,
      stderr,
      exitCode: 0
    };
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };

    if (typeof execError.stdout === 'string' || typeof execError.stderr === 'string') {
      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
        exitCode: typeof execError.code === 'number' ? execError.code : 1
      };
    }

    throw error;
  }
}

async function createSignupWorkflow(projectRoot: string): Promise<void> {
  const workflowDir = resolve(projectRoot, '.canvas', 'workflows', 'signup');

  await writeFile(resolve(projectRoot, 'vite.config.ts'), createViteConfigSource(), 'utf8');
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    resolve(workflowDir, '_flow.ts'),
    [
      'export default {',
      "  id: 'signup',",
      "  title: 'Signup Flow',",
      '  screens: [',
      '    {',
      "      id: 'signup-form',",
      "      component: './SignupForm.svelte',",
      "      title: 'Signup Form'",
      '    },',
      '    {',
      "      id: 'welcome',",
      "      component: './Welcome.svelte',",
      "      title: 'Welcome'",
      '    }',
      '  ],',
      '  transitions: [',
      '    {',
      "      from: 'signup-form',",
      "      to: 'welcome',",
      "      trigger: 'Create account'",
      '    }',
      '  ]',
      '};',
      ''
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    resolve(workflowDir, 'SignupForm.svelte'),
    [
      '<section class="signup-screen">',
      '  <div class="signup-card">',
      '    <p class="signup-kicker">Account</p>',
      '    <h1>Create your workspace</h1>',
      '    <p>Start your free trial with a guided setup.</p>',
      '  </div>',
      '</section>',
      '',
      '<style>',
      '  .signup-screen {',
      '    box-sizing: border-box;',
      '    min-height: 100%;',
      '    padding: 2.5rem;',
      '    display: grid;',
      '    place-items: center;',
      '    background: linear-gradient(135deg, #0f172a, #1d4ed8 60%, #38bdf8);',
      '    color: white;',
      '    font-family: Inter, system-ui, sans-serif;',
      '  }',
      '',
      '  .signup-card {',
      '    width: min(32rem, 100%);',
      '    padding: 2rem;',
      '    border-radius: 1.5rem;',
      '    background: rgba(15, 23, 42, 0.45);',
      '    border: 1px solid rgba(255, 255, 255, 0.24);',
      '    box-shadow: 0 20px 48px rgba(15, 23, 42, 0.28);',
      '  }',
      '',
      '  .signup-kicker {',
      '    margin: 0 0 0.75rem;',
      '    font-size: 0.78rem;',
      '    letter-spacing: 0.12em;',
      '    text-transform: uppercase;',
      '    color: rgba(191, 219, 254, 0.9);',
      '  }',
      '',
      '  h1 {',
      '    margin: 0 0 0.75rem;',
      '    font-size: 2.4rem;',
      '    line-height: 1.05;',
      '  }',
      '',
      '  p {',
      '    margin: 0;',
      '    font-size: 1.05rem;',
      '    line-height: 1.6;',
      '  }',
      '</style>',
      ''
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    resolve(workflowDir, 'Welcome.svelte'),
    [
      '<section class="welcome-screen">',
      '  <div class="welcome-card">',
      '    <p class="welcome-badge">Ready</p>',
      '    <h1>Workspace created</h1>',
      '    <ul>',
      '      <li>Invite teammates</li>',
      '      <li>Import components</li>',
      '      <li>Capture a walkthrough</li>',
      '    </ul>',
      '  </div>',
      '</section>',
      '',
      '<style>',
      '  .welcome-screen {',
      '    box-sizing: border-box;',
      '    min-height: 100%;',
      '    padding: 2.5rem;',
      '    display: grid;',
      '    place-items: center;',
      '    background:',
      '      radial-gradient(circle at top, rgba(16, 185, 129, 0.28), transparent 34%),',
      '      linear-gradient(180deg, #ecfeff 0%, #dcfce7 100%);',
      '    color: #064e3b;',
      '    font-family: Inter, system-ui, sans-serif;',
      '  }',
      '',
      '  .welcome-card {',
      '    width: min(34rem, 100%);',
      '    padding: 2rem;',
      '    border-radius: 1.5rem;',
      '    background: rgba(255, 255, 255, 0.84);',
      '    border: 1px solid rgba(16, 185, 129, 0.2);',
      '    box-shadow: 0 20px 48px rgba(5, 150, 105, 0.18);',
      '  }',
      '',
      '  .welcome-badge {',
      '    display: inline-flex;',
      '    align-items: center;',
      '    margin: 0 0 0.9rem;',
      '    padding: 0.35rem 0.65rem;',
      '    border-radius: 999px;',
      '    background: rgba(16, 185, 129, 0.12);',
      '    color: #047857;',
      '    font-size: 0.78rem;',
      '    font-weight: 700;',
      '    letter-spacing: 0.08em;',
      '    text-transform: uppercase;',
      '  }',
      '',
      '  h1 {',
      '    margin: 0 0 0.9rem;',
      '    font-size: 2.3rem;',
      '    line-height: 1.08;',
      '  }',
      '',
      '  ul {',
      '    margin: 0;',
      '    padding-left: 1.25rem;',
      '    display: grid;',
      '    gap: 0.55rem;',
      '    font-size: 1.02rem;',
      '    line-height: 1.5;',
      '  }',
      '</style>',
      ''
    ].join('\n'),
    'utf8'
  );
}

async function createPurityViolationAcceptanceFixture(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-acceptance-purity-'));
  tempDirs.push(projectRoot);

  await mkdir(resolve(projectRoot, '.canvas', 'workflows', 'impure'), { recursive: true });
  await mkdir(resolve(projectRoot, 'src', 'lib', 'components'), { recursive: true });
  await mkdir(resolve(projectRoot, 'src', 'lib', 'stores'), { recursive: true });

  await writeFile(resolve(projectRoot, 'vite.config.ts'), createViteConfigSource({ includeLibAlias: true }), 'utf8');
  await writeFile(
    resolve(projectRoot, 'canvas.config.ts'),
    [
      'export default {',
      '  purity: {',
      "    componentPaths: ['./src/lib/components/'],",
      "    forbiddenImports: ['./src/lib/stores/']",
      '  }',
      '};',
      ''
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    resolve(projectRoot, 'src', 'lib', 'stores', 'conversation.ts'),
    'export const conversationTitle = "Impure conversation";\n',
    'utf8'
  );
  await writeFile(
    resolve(projectRoot, 'src', 'lib', 'components', 'Chat.svelte'),
    [
      '<script>',
      "  import { conversationTitle } from '../stores/conversation.ts';",
      '</script>',
      '',
      '<div data-chat>{conversationTitle}</div>',
      ''
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    resolve(projectRoot, '.canvas', 'workflows', 'impure', 'ImpureScreen.svelte'),
    [
      '<script>',
      "  import Chat from '$lib/components/Chat.svelte';",
      '</script>',
      '',
      '<Chat />',
      ''
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    resolve(projectRoot, '.canvas', 'workflows', 'impure', '_flow.ts'),
    [
      'export default {',
      "  id: 'impure',",
      "  title: 'Impure Flow',",
      '  screens: [',
      '    {',
      "      id: 'blocked',",
      "      component: 'ImpureScreen.svelte',",
      "      title: 'Blocked'",
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

async function createRenderCheckAcceptanceFixture(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-acceptance-render-check-'));
  tempDirs.push(projectRoot);

  await mkdir(resolve(projectRoot, '.canvas', 'workflows', 'adopted'), { recursive: true });
  await mkdir(resolve(projectRoot, '.canvas', 'workflows', 'broken'), { recursive: true });
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
      '<GreetingCard message="Acceptance render-check" />',
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
    resolve(projectRoot, '.canvas', 'workflows', 'broken', 'BrokenScreen.svelte'),
    [
      '<script>',
      "  import { onMount } from 'svelte';",
      "  import GreetingCard from '$lib/components/GreetingCard.svelte';",
      '',
      '  onMount(() => {',
      "    throw new Error('Broken screen exploded');",
      '  });',
      '</script>',
      '',
      '<GreetingCard message="This screen should fail" />',
      ''
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    resolve(projectRoot, '.canvas', 'workflows', 'broken', '_flow.ts'),
    [
      'export default {',
      "  id: 'broken',",
      "  title: 'Broken Flow',",
      '  screens: [',
      '    {',
      "      id: 'crashed',",
      "      component: 'BrokenScreen.svelte',",
      "      title: 'Crashed'",
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

async function startDevCommand(cwd: string): Promise<StartedDevCommand> {
  const child = spawn('npx', ['tsx', cliPath, 'dev', '--json'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  activeChildren.add(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  const payload = await new Promise<DevCommandPayload>((resolvePayload, rejectPayload) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectPayload(
        new Error(
          `Timed out waiting for dev server JSON output.\nstdout:\n${stdoutChunks.join('')}\nstderr:\n${stderrChunks.join('')}`
        )
      );
    }, 30_000);

    const onStdout = (chunk: string) => {
      stdoutChunks.push(chunk);
      const jsonSource = extractFirstJsonObject(stdoutChunks.join(''));

      if (!jsonSource) {
        return;
      }

      try {
        const parsed = JSON.parse(jsonSource) as DevCommandPayload;

        if (typeof parsed.url !== 'string' || typeof parsed.port !== 'number') {
          return;
        }

        cleanup();
        resolvePayload(parsed);
      } catch {
        // Keep waiting until the full JSON document arrives.
      }
    };
    const onStderr = (chunk: string) => {
      stderrChunks.push(chunk);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      rejectPayload(
        new Error(
          `dev command exited before producing JSON (code=${String(code)}, signal=${String(signal)}).\nstdout:\n${stdoutChunks.join('')}\nstderr:\n${stderrChunks.join('')}`
        )
      );
    };
    const onError = (error: Error) => {
      cleanup();
      rejectPayload(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
      child.off('error', onError);
    };

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('exit', onExit);
    child.once('error', onError);
  });

  return {
    child,
    payload,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join('')
  };
}

async function stopChildProcess(
  child: ChildProcessWithoutNullStreams
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      code: child.exitCode,
      signal: child.signalCode
    };
  }

  child.kill('SIGINT');

  try {
    const [code, signal] = (await withTimeout(
      once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>,
      15_000,
      'Timed out waiting for child process to exit after SIGINT.'
    )) as [number | null, NodeJS.Signals | null];

    return { code, signal };
  } catch (error) {
    child.kill('SIGKILL');
    await once(child, 'exit').catch(() => undefined);
    throw error;
  }
}

function stripIgnorableDevWarnings(stderr: string): string {
  return stderr
    .split(/\r?\n/u)
    .filter((line) => {
      if (!line.trim()) {
        return false;
      }

      return !(
        line.startsWith('WebSocket server error:') ||
        line.startsWith('Failed to resolve dependency:')
      );
    })
    .join('\n');
}

async function assertScreenshotOutputs(
  screenshots: ScreenshotCommandPayload['screenshots']
): Promise<void> {
  for (const screenshot of screenshots) {
    expect(screenshot.width).toBeGreaterThan(0);
    expect(screenshot.height).toBeGreaterThan(0);

    const [metadata, file] = await Promise.all([stat(screenshot.path), readFile(screenshot.path)]);

    expect(metadata.isFile()).toBe(true);
    expect(metadata.size).toBeGreaterThan(1_000);
    expect(file.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE_HEX);
  }
}

function sortWorkflows(workflows: ListCommandPayload['workflows']): ListCommandPayload['workflows'] {
  return [...workflows].sort((left, right) => left.id.localeCompare(right.id));
}

function sortScreenshots(
  screenshots: ScreenshotCommandPayload['screenshots']
): ScreenshotCommandPayload['screenshots'] {
  return [...screenshots].sort((left, right) => {
    const workflowOrder = left.workflow.localeCompare(right.workflow);

    if (workflowOrder !== 0) {
      return workflowOrder;
    }

    return left.screen.localeCompare(right.screen);
  });
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2_000)
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

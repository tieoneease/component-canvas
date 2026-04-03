import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const cliPath = resolve(process.cwd(), 'bin/cli.ts');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('component-canvas init', () => {
  it('creates the .canvas scaffold and AGENTS guidance without generating canvas.config.ts by default', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-init-project-'));
    tempDirs.push(projectRoot);

    await mkdir(resolve(projectRoot, 'src', 'lib'), { recursive: true });

    const { stdout, stderr } = await execFile('npx', ['tsx', cliPath, 'init', '--json'], {
      cwd: projectRoot
    });
    const payload = JSON.parse(stdout);
    const agentsSource = await readFile(resolve(projectRoot, '.canvas', 'AGENTS.md'), 'utf8');

    expect(stderr).toBe('');
    expect(payload).toEqual({
      config: null,
      canvasDir: '.canvas/',
      detected: {}
    });
    expect(agentsSource).toContain('canvas.config.ts');
    expect(agentsSource).toContain('vite.config.ts');
    expect(agentsSource).toContain('component-canvas explore <path>');
    expect(agentsSource).toContain("component-canvas render <path> --props '{...}'");
    await expect(access(resolve(projectRoot, '.canvas', 'workflows', 'example', '_flow.ts'))).resolves.toBeUndefined();
    await expect(access(resolve(projectRoot, '.canvas', 'workflows', 'example', 'ExampleScreen.svelte'))).resolves.toBeUndefined();
    await expect(access(resolve(projectRoot, 'canvas.config.ts'))).rejects.toThrow();
  });

  it('preserves an existing canvas.config.ts and reports it in json output', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-init-existing-config-'));
    tempDirs.push(projectRoot);

    const existingConfig = ['export default {', "  mocks: { '@api/client': './src/mocks/api-client.ts' }", '};', ''].join(
      '\n'
    );
    await writeFile(resolve(projectRoot, 'canvas.config.ts'), existingConfig, 'utf8');

    const { stdout, stderr } = await execFile('npx', ['tsx', cliPath, 'init', '--json'], {
      cwd: projectRoot
    });
    const payload = JSON.parse(stdout);

    expect(stderr).toBe('');
    expect(payload).toEqual({
      config: 'canvas.config.ts',
      canvasDir: '.canvas/',
      detected: {}
    });
    await expect(access(resolve(projectRoot, '.canvas', 'AGENTS.md'))).resolves.toBeUndefined();
    expect(await readFile(resolve(projectRoot, 'canvas.config.ts'), 'utf8')).toBe(existingConfig);
  });
});

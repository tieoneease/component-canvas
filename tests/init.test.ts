import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
  it('creates canvas.config.ts and sample workflow files when project features are detected', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-init-project-'));
    tempDirs.push(projectRoot);

    await mkdir(resolve(projectRoot, 'src', 'lib'), { recursive: true });

    const { stdout, stderr } = await execFile('npx', ['tsx', cliPath, 'init', '--json'], {
      cwd: projectRoot
    });
    const payload = JSON.parse(stdout);
    const configSource = await readFile(resolve(projectRoot, 'canvas.config.ts'), 'utf8');

    expect(stderr).toBe('');
    expect(payload).toEqual({
      config: 'canvas.config.ts',
      canvasDir: '.canvas/',
      detected: { lib: true }
    });
    expect(configSource).toContain("lib: './src/lib'");
    await expect(access(resolve(projectRoot, '.canvas', 'workflows', 'example', '_flow.ts'))).resolves.toBeUndefined();
  });

  it('creates only the .canvas scaffold in standalone directories', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'component-canvas-init-standalone-'));
    tempDirs.push(projectRoot);

    const { stdout, stderr } = await execFile('npx', ['tsx', cliPath, 'init', '--json'], {
      cwd: projectRoot
    });
    const payload = JSON.parse(stdout);

    expect(stderr).toBe('');
    expect(payload).toEqual({
      config: null,
      canvasDir: '.canvas/',
      detected: { lib: false }
    });
    await expect(access(resolve(projectRoot, '.canvas', 'workflows', 'example', '_flow.ts'))).resolves.toBeUndefined();
    await expect(access(resolve(projectRoot, 'canvas.config.ts'))).rejects.toThrow();
  });
});

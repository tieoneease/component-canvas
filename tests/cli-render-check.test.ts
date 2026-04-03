import { execFile as execFileCallback } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { createRenderCheckFixture, extractFirstJsonObject } from './helpers.ts';

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
      tempDirs.push(projectRoot);

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
      tempDirs.push(projectRoot);

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


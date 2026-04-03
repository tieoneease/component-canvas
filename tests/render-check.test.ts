import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderCheck } from '../lib/render-check.ts';
import { startServer } from '../lib/server.ts';
import { createRenderCheckFixture } from './helpers.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('renderCheck', () => {
  it(
    'classifies passing and prototype screens and reports the correct summary',
    async () => {
      const projectRoot = await createRenderCheckFixture();
      tempDirs.push(projectRoot);
      const canvasDir = resolve(projectRoot, '.canvas');

      const result = await renderCheck({ canvasDir, projectRoot });

      expect(result.screens).toEqual([
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
      ]);
      expect(result.summary).toEqual({
        pass: 1,
        fail: 0,
        prototype: 1,
        total: 2
      });
    },
    30_000
  );

  it(
    'filters to a single workflow and can reuse a provided server URL',
    async () => {
      const projectRoot = await createRenderCheckFixture();
      tempDirs.push(projectRoot);
      const canvasDir = resolve(projectRoot, '.canvas');
      const server = await startServer({ canvasDir, projectRoot });

      try {
        const result = await renderCheck({
          canvasDir,
          projectRoot,
          workflowId: 'adopted',
          serverUrl: server.url
        });

        expect(result.screens).toEqual([
          {
            workflow: 'adopted',
            screen: 'ready',
            status: 'pass'
          }
        ]);
        expect(result.summary).toEqual({
          pass: 1,
          fail: 0,
          prototype: 0,
          total: 1
        });
      } finally {
        await server.close();
      }
    },
    30_000
  );
});


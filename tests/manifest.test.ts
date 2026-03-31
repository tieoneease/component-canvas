import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseWorkflowManifests } from '../lib/manifest.ts';

const fixturesDir = resolve(process.cwd(), 'tests/fixtures');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('parseWorkflowManifests', () => {
  it('parses a valid workflow fixture', async () => {
    const canvasDir = resolve(fixturesDir, 'valid-workflow/.canvas');
    const result = await parseWorkflowManifests(canvasDir);

    expect(result.errors).toEqual([]);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0]).toMatchObject({
      id: 'login',
      title: 'Login Flow'
    });
    expect(result.workflows[0].screens).toHaveLength(3);
    expect(result.workflows[0].transitions).toHaveLength(2);
    expect(result.workflows[0].variants).toHaveLength(1);
    expect(result.workflows[0].screens.map((screen) => screen.id)).toEqual([
      'login-form',
      'loading',
      'dashboard'
    ]);
  });

  it('returns specific validation errors for an invalid workflow', async () => {
    const canvasDir = resolve(fixturesDir, 'invalid-workflow/.canvas');
    const result = await parseWorkflowManifests(canvasDir);

    expect(result.workflows).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.stringContaining('_flow.ts'),
          message: 'Component file "./MissingComponent.svelte" for screen "start" does not exist.'
        }),
        expect.objectContaining({
          file: expect.stringContaining('_flow.ts'),
          message: 'Transition at index 0 references unknown screen "missing-screen" in "to".'
        })
      ])
    );
  });

  it('returns no workflows and no errors for an empty directory', async () => {
    const canvasDir = await mkdtemp(join(tmpdir(), 'component-canvas-empty-'));
    tempDirs.push(canvasDir);

    const result = await parseWorkflowManifests(canvasDir);

    expect(result).toEqual({
      workflows: [],
      errors: []
    });
  });
});

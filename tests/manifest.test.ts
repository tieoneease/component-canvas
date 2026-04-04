import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    expect(result.warnings).toEqual([]);
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
    expect(result.warnings).toEqual([]);
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

  it('returns no workflows and no issues for an empty directory', async () => {
    const canvasDir = await mkdtemp(join(tmpdir(), 'component-canvas-empty-'));
    tempDirs.push(canvasDir);

    const result = await parseWorkflowManifests(canvasDir);

    expect(result).toEqual({
      workflows: [],
      errors: [],
      warnings: []
    });
  });

  it('parses valid position, group, and groups metadata without warnings', async () => {
    const canvasDir = await createWorkflowFixture({
      componentFiles: ['Login.svelte', 'Dashboard.svelte'],
      manifestSource: `export default {
  id: 'curated',
  title: 'Curated Flow',
  groups: [
    { id: 'auth', title: 'Authentication' },
    { id: 'post-auth', title: 'Post-auth' }
  ],
  screens: [
    {
      id: 'login',
      component: './Login.svelte',
      position: { x: 120, y: 48 },
      group: 'auth'
    },
    {
      id: 'dashboard',
      component: './Dashboard.svelte',
      group: 'post-auth'
    }
  ],
  transitions: []
};`
    });
    const result = await parseWorkflowManifests(canvasDir);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0]).toMatchObject({
      groups: [
        { id: 'auth', title: 'Authentication' },
        { id: 'post-auth', title: 'Post-auth' }
      ],
      screens: [
        {
          id: 'login',
          position: { x: 120, y: 48 },
          group: 'auth'
        },
        {
          id: 'dashboard',
          group: 'post-auth'
        }
      ]
    });
  });

  it('warns and drops malformed screen positions', async () => {
    const canvasDir = await createWorkflowFixture({
      componentFiles: ['MissingX.svelte', 'InfiniteY.svelte', 'NullPosition.svelte'],
      manifestSource: `export default {
  id: 'positions',
  title: 'Position Validation',
  screens: [
    {
      id: 'missing-x',
      component: './MissingX.svelte',
      position: { y: 32 }
    },
    {
      id: 'non-finite-y',
      component: './InfiniteY.svelte',
      position: { x: 10, y: Number.POSITIVE_INFINITY }
    },
    {
      id: 'null-position',
      component: './NullPosition.svelte',
      position: null
    }
  ],
  transitions: []
};`
    });
    const result = await parseWorkflowManifests(canvasDir);

    expect(result.errors).toEqual([]);
    expect(messages(result.warnings)).toEqual([
      'Screen "missing-x" has invalid "position"; expected an object with finite numeric "x" and "y".',
      'Screen "non-finite-y" has invalid "position"; expected an object with finite numeric "x" and "y".',
      'Screen "null-position" has invalid "position"; expected an object with finite numeric "x" and "y".'
    ]);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].screens.map((screen) => screen.position)).toEqual([undefined, undefined, undefined]);
  });

  it('warns and drops invalid screen groups', async () => {
    const canvasDir = await createWorkflowFixture({
      componentFiles: ['NumberGroup.svelte', 'BlankGroup.svelte'],
      manifestSource: `export default {
  id: 'screen-groups',
  title: 'Screen Group Validation',
  screens: [
    {
      id: 'number-group',
      component: './NumberGroup.svelte',
      group: 123
    },
    {
      id: 'blank-group',
      component: './BlankGroup.svelte',
      group: '   '
    }
  ],
  transitions: []
};`
    });
    const result = await parseWorkflowManifests(canvasDir);

    expect(result.errors).toEqual([]);
    expect(messages(result.warnings)).toEqual([
      'Screen "number-group" has invalid "group"; expected a non-empty string.',
      'Screen "blank-group" has invalid "group"; expected a non-empty string.'
    ]);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].screens.map((screen) => screen.group)).toEqual([undefined, undefined]);
  });

  it('warns and drops invalid group entries', async () => {
    const canvasDir = await createWorkflowFixture({
      componentFiles: ['Login.svelte'],
      manifestSource: `export default {
  id: 'groups',
  title: 'Groups Validation',
  groups: [
    { id: 'auth', title: 'Authentication' },
    { id: 'missing-title' },
    { title: 'Missing ID' },
    null,
    'oops'
  ],
  screens: [
    {
      id: 'login',
      component: './Login.svelte'
    }
  ],
  transitions: []
};`
    });
    const result = await parseWorkflowManifests(canvasDir);

    expect(result.errors).toEqual([]);
    expect(messages(result.warnings)).toEqual([
      'Group at index 1 must include non-empty string "id" and "title".',
      'Group at index 2 must include non-empty string "id" and "title".',
      'Group at index 3 must include non-empty string "id" and "title".',
      'Group at index 4 must include non-empty string "id" and "title".'
    ]);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].groups).toEqual([{ id: 'auth', title: 'Authentication' }]);
  });

  it('warns when a screen references an unknown group without dropping the field', async () => {
    const canvasDir = await createWorkflowFixture({
      componentFiles: ['Login.svelte'],
      manifestSource: `export default {
  id: 'missing-group-reference',
  title: 'Missing Group Reference',
  groups: [
    { id: 'auth', title: 'Authentication' }
  ],
  screens: [
    {
      id: 'login',
      component: './Login.svelte',
      group: 'missing'
    }
  ],
  transitions: []
};`
    });
    const result = await parseWorkflowManifests(canvasDir);

    expect(result.errors).toEqual([]);
    expect(messages(result.warnings)).toEqual(['Screen "login" references unknown group "missing".']);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].screens[0]?.group).toBe('missing');
  });
});

async function createWorkflowFixture(options: {
  manifestSource: string;
  componentFiles: string[];
  workflowDirName?: string;
}): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'component-canvas-manifest-'));
  tempDirs.push(rootDir);

  const canvasDir = join(rootDir, '.canvas');
  const workflowDir = join(canvasDir, 'workflows', options.workflowDirName ?? 'example');

  await mkdir(workflowDir, { recursive: true });
  await writeFile(join(workflowDir, '_flow.ts'), options.manifestSource);

  await Promise.all(
    options.componentFiles.map((componentFile) =>
      writeFile(join(workflowDir, componentFile), `<div>${componentFile}</div>\n`)
    )
  );

  return canvasDir;
}

function messages(entries: Array<{ message: string }>): string[] {
  return entries.map((entry) => entry.message);
}

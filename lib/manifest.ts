import { readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getErrorMessage, isNonEmptyString, isPlainObject, pathExists } from './utils.ts';

export interface Screen {
  id: string;
  component: string;
  title?: string;
  props?: Record<string, unknown>;
}

export interface Transition {
  from: string;
  to: string;
  trigger: string;
}

export interface Variant {
  id: string;
  screenId: string;
  title: string;
  props: Record<string, unknown>;
}

export interface WorkflowManifest {
  id: string;
  title: string;
  screens: Screen[];
  transitions: Transition[];
  variants?: Variant[];
}

export interface ManifestError {
  file: string;
  message: string;
}

export interface ParseWorkflowManifestsResult {
  workflows: WorkflowManifest[];
  errors: ManifestError[];
}

export async function parseWorkflowManifests(canvasDir: string): Promise<ParseWorkflowManifestsResult> {
  const workflowsDir = resolve(canvasDir, 'workflows');

  if (!(await pathExists(workflowsDir))) {
    return { workflows: [], errors: [] };
  }

  const entries = await readdir(workflowsDir, { withFileTypes: true });
  const workflowDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(workflowsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const workflows: WorkflowManifest[] = [];
  const errors: ManifestError[] = [];

  for (const workflowDir of workflowDirs) {
    const manifestFile = join(workflowDir, '_flow.ts');

    if (!(await pathExists(manifestFile))) {
      continue;
    }

    let manifestModule: unknown;

    try {
      manifestModule = await import(pathToFileURL(manifestFile).href);
    } catch (error) {
      errors.push({
        file: manifestFile,
        message: `Failed to import manifest: ${getErrorMessage(error)}`
      });
      continue;
    }

    if (!isObject(manifestModule) || !('default' in manifestModule)) {
      errors.push({
        file: manifestFile,
        message: 'Manifest must have a default export.'
      });
      continue;
    }

    const manifest = manifestModule.default;
    const validationErrors = await validateManifest(workflowDir, manifest);

    if (validationErrors.length > 0) {
      errors.push(...validationErrors.map((message) => ({ file: manifestFile, message })));
      continue;
    }

    workflows.push(manifest as WorkflowManifest);
  }

  return { workflows, errors };
}

async function validateManifest(workflowDir: string, manifest: unknown): Promise<string[]> {
  if (!isPlainObject(manifest)) {
    return ['Manifest default export must be an object.'];
  }

  const errors: string[] = [];
  const screenIds = new Set<string>();

  if (!isNonEmptyString(manifest.id)) {
    errors.push('Manifest field "id" must be a non-empty string.');
  }

  if (!isNonEmptyString(manifest.title)) {
    errors.push('Manifest field "title" must be a non-empty string.');
  }

  if (!Array.isArray(manifest.screens)) {
    errors.push('Manifest field "screens" must be an array.');
  } else {
    for (const [index, screen] of manifest.screens.entries()) {
      await validateScreen(screen, index, workflowDir, screenIds, errors);
    }
  }

  if (!Array.isArray(manifest.transitions)) {
    errors.push('Manifest field "transitions" must be an array.');
  } else {
    for (const [index, transition] of manifest.transitions.entries()) {
      validateTransition(transition, index, screenIds, errors);
    }
  }

  if (manifest.variants !== undefined) {
    if (!Array.isArray(manifest.variants)) {
      errors.push('Manifest field "variants" must be an array when provided.');
    } else {
      for (const [index, variant] of manifest.variants.entries()) {
        validateVariant(variant, index, screenIds, errors);
      }
    }
  }

  return errors;
}

async function validateScreen(
  screen: unknown,
  index: number,
  workflowDir: string,
  screenIds: Set<string>,
  errors: string[]
): Promise<void> {
  if (!isPlainObject(screen)) {
    errors.push(`Screen at index ${index} must be an object.`);
    return;
  }

  const screenLabel = isNonEmptyString(screen.id) ? screen.id : String(index);

  if (!isNonEmptyString(screen.id)) {
    errors.push(`Screen at index ${index} is missing a non-empty string "id".`);
  } else if (screenIds.has(screen.id)) {
    errors.push(`Duplicate screen id "${screen.id}".`);
  } else {
    screenIds.add(screen.id);
  }

  if (!isNonEmptyString(screen.component)) {
    errors.push(`Screen "${screenLabel}" is missing a non-empty string "component".`);
  } else {
    const componentPath = resolve(workflowDir, screen.component);

    if (extname(componentPath) !== '.svelte') {
      errors.push(`Component "${screen.component}" for screen "${screenLabel}" must point to a .svelte file.`);
    } else if (!(await pathExists(componentPath))) {
      errors.push(`Component file "${screen.component}" for screen "${screenLabel}" does not exist.`);
    }
  }

  if ('title' in screen && screen.title !== undefined && !isNonEmptyString(screen.title)) {
    errors.push(`Screen "${screenLabel}" has an invalid "title".`);
  }

  if ('props' in screen && screen.props !== undefined && !isPlainObject(screen.props)) {
    errors.push(`Screen "${screenLabel}" has invalid "props"; expected an object.`);
  }
}

function validateTransition(
  transition: unknown,
  index: number,
  screenIds: Set<string>,
  errors: string[]
): void {
  if (!isPlainObject(transition)) {
    errors.push(`Transition at index ${index} must be an object.`);
    return;
  }

  if (!isNonEmptyString(transition.from)) {
    errors.push(`Transition at index ${index} is missing a non-empty string "from".`);
  } else if (!screenIds.has(transition.from)) {
    errors.push(`Transition at index ${index} references unknown screen "${transition.from}" in "from".`);
  }

  if (!isNonEmptyString(transition.to)) {
    errors.push(`Transition at index ${index} is missing a non-empty string "to".`);
  } else if (!screenIds.has(transition.to)) {
    errors.push(`Transition at index ${index} references unknown screen "${transition.to}" in "to".`);
  }

  if (!isNonEmptyString(transition.trigger)) {
    errors.push(`Transition at index ${index} is missing a non-empty string "trigger".`);
  }
}

function validateVariant(
  variant: unknown,
  index: number,
  screenIds: Set<string>,
  errors: string[]
): void {
  if (!isPlainObject(variant)) {
    errors.push(`Variant at index ${index} must be an object.`);
    return;
  }

  if (!isNonEmptyString(variant.id)) {
    errors.push(`Variant at index ${index} is missing a non-empty string "id".`);
  }

  if (!isNonEmptyString(variant.screenId)) {
    errors.push(`Variant at index ${index} is missing a non-empty string "screenId".`);
  } else if (!screenIds.has(variant.screenId)) {
    errors.push(`Variant at index ${index} references unknown screen "${variant.screenId}".`);
  }

  if (!isNonEmptyString(variant.title)) {
    errors.push(`Variant at index ${index} is missing a non-empty string "title".`);
  }

  if (!isPlainObject(variant.props)) {
    errors.push(`Variant at index ${index} has invalid "props"; expected an object.`);
  }
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

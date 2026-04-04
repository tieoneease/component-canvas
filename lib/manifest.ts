import { readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  getErrorMessage,
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
  pathExists
} from './utils.ts';

export interface ScreenPosition {
  x: number;
  y: number;
}

export interface Screen {
  id: string;
  component: string;
  title?: string;
  props?: Record<string, unknown>;
  position?: ScreenPosition;
  group?: string;
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

export interface ScreenGroup {
  id: string;
  title: string;
}

export interface WorkflowManifest {
  id: string;
  title: string;
  screens: Screen[];
  transitions: Transition[];
  variants?: Variant[];
  groups?: ScreenGroup[];
}

export interface ManifestError {
  file: string;
  message: string;
}

export interface ManifestWarning {
  file: string;
  message: string;
}

export interface ParseWorkflowManifestsResult {
  workflows: WorkflowManifest[];
  errors: ManifestError[];
  warnings: ManifestWarning[];
}

interface ManifestValidationResult {
  errors: string[];
  warnings: string[];
}

export async function parseWorkflowManifests(canvasDir: string): Promise<ParseWorkflowManifestsResult> {
  const workflowsDir = resolve(canvasDir, 'workflows');

  if (!(await pathExists(workflowsDir))) {
    return { workflows: [], errors: [], warnings: [] };
  }

  const entries = await readdir(workflowsDir, { withFileTypes: true });
  const workflowDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(workflowsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const workflows: WorkflowManifest[] = [];
  const errors: ManifestError[] = [];
  const warnings: ManifestWarning[] = [];

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
    const validationResult = await validateManifest(workflowDir, manifest);

    if (validationResult.warnings.length > 0) {
      warnings.push(
        ...validationResult.warnings.map((message) => ({
          file: manifestFile,
          message
        }))
      );
    }

    if (validationResult.errors.length > 0) {
      errors.push(
        ...validationResult.errors.map((message) => ({
          file: manifestFile,
          message
        }))
      );
      continue;
    }

    workflows.push(manifest as WorkflowManifest);
  }

  return { workflows, errors, warnings };
}

async function validateManifest(workflowDir: string, manifest: unknown): Promise<ManifestValidationResult> {
  if (!isPlainObject(manifest)) {
    return {
      errors: ['Manifest default export must be an object.'],
      warnings: []
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
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
      await validateScreen(screen, index, workflowDir, screenIds, errors, warnings);
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

  const groupIds = validateGroups(manifest, warnings);

  if (Array.isArray(manifest.screens)) {
    validateScreenGroupReferences(manifest.screens, groupIds, warnings);
  }

  return { errors, warnings };
}

async function validateScreen(
  screen: unknown,
  index: number,
  workflowDir: string,
  screenIds: Set<string>,
  errors: string[],
  warnings: string[]
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

  validateScreenPosition(screen, screenLabel, warnings);
  validateScreenGroup(screen, screenLabel, warnings);
}

function validateScreenPosition(
  screen: Record<string, unknown>,
  screenLabel: string,
  warnings: string[]
): void {
  if (!('position' in screen) || screen.position === undefined) {
    return;
  }

  if (!isScreenPosition(screen.position)) {
    warnings.push(
      `Screen "${screenLabel}" has invalid "position"; expected an object with finite numeric "x" and "y".`
    );
    delete screen.position;
    return;
  }

  screen.position = {
    x: screen.position.x,
    y: screen.position.y
  };
}

function validateScreenGroup(screen: Record<string, unknown>, screenLabel: string, warnings: string[]): void {
  if (!('group' in screen) || screen.group === undefined) {
    return;
  }

  if (!isNonEmptyString(screen.group)) {
    warnings.push(`Screen "${screenLabel}" has invalid "group"; expected a non-empty string.`);
    delete screen.group;
  }
}

function validateGroups(manifest: Record<string, unknown>, warnings: string[]): Set<string> {
  if (manifest.groups === undefined) {
    return new Set<string>();
  }

  if (!Array.isArray(manifest.groups)) {
    warnings.push('Manifest field "groups" must be an array when provided.');
    delete manifest.groups;
    return new Set<string>();
  }

  const validGroups: ScreenGroup[] = [];
  const groupIds = new Set<string>();

  for (const [index, group] of manifest.groups.entries()) {
    if (!isPlainObject(group) || !isNonEmptyString(group.id) || !isNonEmptyString(group.title)) {
      warnings.push(`Group at index ${index} must include non-empty string "id" and "title".`);
      continue;
    }

    validGroups.push({
      id: group.id,
      title: group.title
    });
    groupIds.add(group.id);
  }

  manifest.groups = validGroups;

  return groupIds;
}

function validateScreenGroupReferences(
  screens: unknown[],
  groupIds: Set<string>,
  warnings: string[]
): void {
  for (const [index, screen] of screens.entries()) {
    if (!isPlainObject(screen) || !isNonEmptyString(screen.group)) {
      continue;
    }

    if (groupIds.has(screen.group)) {
      continue;
    }

    const screenLabel = isNonEmptyString(screen.id) ? screen.id : String(index);
    warnings.push(`Screen "${screenLabel}" references unknown group "${screen.group}".`);
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

function isScreenPosition(value: unknown): value is ScreenPosition {
  return isPlainObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

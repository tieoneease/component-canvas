import { join, resolve } from 'node:path';

import { loadConfigFromFile, type ConfigEnv } from 'vite';

import type { PurityConfig } from './adapter.ts';
import { isPlainObject, pathExists } from './utils.ts';

export interface CanvasConfig {
  /** Optional path to the project's .canvas directory. */
  canvasDir?: string;
  /** Import path → mock module path mappings. */
  mocks?: Record<string, string>;
  /** Purity enforcement rules for visual components. */
  purity?: PurityConfig;
}

export const CANVAS_CONFIG_FILE_NAME = 'canvas.config.ts';

const CONFIG_ENV: ConfigEnv = {
  command: 'serve',
  mode: 'development',
  isSsrBuild: false,
  isPreview: false
};

const SUPPORTED_CONFIG_FIELDS = ['canvasDir', 'mocks', 'purity'] as const;
const REMOVED_CONFIG_FIELDS = new Set(['aliases', 'globalCss', 'lib']);

export async function loadConfig(cwd: string): Promise<CanvasConfig | null> {
  const resolvedCwd = resolve(cwd);
  const configPath = join(resolvedCwd, CANVAS_CONFIG_FILE_NAME);

  if (!(await pathExists(configPath))) {
    return null;
  }

  const loadedConfig = await loadConfigFromFile(CONFIG_ENV, configPath, resolvedCwd, 'silent');

  if (!loadedConfig) {
    return null;
  }

  validateConfig(loadedConfig.config, loadedConfig.path);

  return loadedConfig.config;
}

function validateConfig(config: unknown, configPath: string): asserts config is CanvasConfig {
  if (!isPlainObject(config)) {
    throw new Error(`${configPath} must default export an object.`);
  }

  validateKnownFields(config, configPath);
  validateOptionalString(config, 'canvasDir', configPath);
  validateOptionalStringRecord(config, 'mocks', configPath);
  validateOptionalPurityConfig(config, configPath);
}

function validateKnownFields(config: Record<string, unknown>, configPath: string): void {
  const supportedFields = new Set<string>(SUPPORTED_CONFIG_FIELDS);

  for (const key of Object.keys(config)) {
    if (supportedFields.has(key)) {
      continue;
    }

    if (REMOVED_CONFIG_FIELDS.has(key)) {
      throw new Error(
        `${configPath} field "${key}" has been removed. canvas.config.ts now only supports "canvasDir", "mocks", and "purity"; project aliases and global CSS should be configured in vite.config.ts.`
      );
    }

    throw new Error(
      `${configPath} field "${key}" is not supported. canvas.config.ts only supports "canvasDir", "mocks", and "purity".`
    );
  }
}

function validateOptionalString(
  config: Record<string, unknown>,
  key: 'canvasDir',
  configPath: string
): void {
  const value = config[key];

  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${configPath} field "${key}" must be a string when provided.`);
  }
}

function validateOptionalStringRecord(
  config: Record<string, unknown>,
  key: 'mocks',
  configPath: string
): void {
  const value = config[key];

  if (value === undefined) {
    return;
  }

  if (!isPlainObject(value)) {
    throw new Error(`${configPath} field "${key}" must be an object when provided.`);
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== 'string') {
      throw new Error(`${configPath} field "${key}.${entryKey}" must be a string.`);
    }
  }
}

function validateOptionalPurityConfig(config: Record<string, unknown>, configPath: string): void {
  const value = config.purity;

  if (value === undefined) {
    return;
  }

  if (!isPlainObject(value)) {
    throw new Error(`${configPath} field "purity" must be an object when provided.`);
  }

  validateRequiredStringArray(value, 'componentPaths', configPath, 'purity');
  validateRequiredStringArray(value, 'forbiddenImports', configPath, 'purity');
}

function validateRequiredStringArray(
  config: Record<string, unknown>,
  key: keyof PurityConfig,
  configPath: string,
  parentKey: 'purity'
): void {
  const value = config[key];

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `${configPath} field "${parentKey}.${key}" must be a non-empty array of strings.`
    );
  }

  for (const [index, entryValue] of value.entries()) {
    if (typeof entryValue !== 'string') {
      throw new Error(`${configPath} field "${parentKey}.${key}[${index}]" must be a string.`);
    }
  }
}

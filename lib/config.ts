import { join, resolve } from 'node:path';

import { loadConfigFromFile, type ConfigEnv } from 'vite';

import type { PurityConfig } from './adapter.ts';
import { isPlainObject, pathExists } from './utils.ts';

export interface CanvasConfig {
  /** Optional path to the project's .canvas directory. */
  canvasDir?: string;
  /** Path to project's src/lib (for $lib alias). */
  lib?: string;
  /** Path to global CSS file to inject. */
  globalCss?: string;
  /** Import path → mock module path mappings. */
  mocks?: Record<string, string>;
  /** Additional Vite resolve aliases. */
  aliases?: Record<string, string>;
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

  validateOptionalString(config, 'canvasDir', configPath);
  validateOptionalString(config, 'lib', configPath);

  validateOptionalString(config, 'globalCss', configPath);
  validateOptionalStringRecord(config, 'mocks', configPath);
  validateOptionalStringRecord(config, 'aliases', configPath);
  validateOptionalPurityConfig(config, configPath);
}

function validateOptionalString(
  config: Record<string, unknown>,
  key: 'canvasDir' | 'lib' | 'globalCss',
  configPath: string
): void {
  const value = config[key];

  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${configPath} field "${key}" must be a string when provided.`);
  }
}

function validateOptionalStringRecord(
  config: Record<string, unknown>,
  key: 'mocks' | 'aliases',
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


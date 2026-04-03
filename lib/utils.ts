import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizePath } from 'vite';

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function sanitizePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');

  return sanitized.length > 0 ? sanitized : 'screen';
}

export function escapeAttributeValue(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

export function toFsImportPath(path: string): string {
  return `/@fs/${normalizePath(resolve(path))}`;
}

export function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function resolvePreviewUrl(serverUrl: string): string {
  const normalizedUrl = ensureTrailingSlash(serverUrl);
  const parsedUrl = new URL(normalizedUrl);

  if (parsedUrl.pathname.endsWith('/preview/')) {
    return parsedUrl.toString();
  }

  return new URL('preview/', parsedUrl).toString();
}

export function getRequestPath(req: Pick<IncomingMessage, 'url'>): string {
  return getRequestPathFromUrl(req.url);
}

export function getRequestPathFromUrl(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://component-canvas.local').pathname;
  } catch {
    return '/';
  }
}

export async function importFreshModule(modulePath: string): Promise<unknown> {
  const moduleUrl = pathToFileURL(modulePath);
  const metadata = await stat(modulePath);

  moduleUrl.searchParams.set('t', String(metadata.mtimeMs));

  return import(moduleUrl.href);
}

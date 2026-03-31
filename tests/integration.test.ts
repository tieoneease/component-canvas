import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';

import { captureScreenshot } from '../lib/screenshot.ts';
import { startServer } from '../lib/server.ts';

const execFile = promisify(execFileCallback);
const fixturesDir = resolve(process.cwd(), 'tests/fixtures');
const cliPath = resolve(process.cwd(), 'bin/cli.ts');
const PNG_SIGNATURE_HEX = '89504e470d0a1a0a';
const DEFAULT_VIEWPORT = {
  width: 1_280,
  height: 720
};

describe('component-canvas integration pipeline', () => {
  it(
    'renders workflow component content in the browser DOM via the real Vite server',
    async () => {
      const projectRoot = resolve(fixturesDir, 'valid-workflow');
      const server = await startServer({
        canvasDir: resolve(projectRoot, '.canvas'),
        projectRoot
      });
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];

      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      });
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      try {
        await page.goto(`${server.url}#/workflow/login`, {
          waitUntil: 'domcontentloaded'
        });
        await page.waitForSelector('[data-workflow-id="login"]');
        await page.waitForFunction(() => {
          const text = document.body.textContent ?? '';
          return (
            text.includes('Login Form Screen') &&
            text.includes('Loading Screen') &&
            text.includes('Dashboard Screen')
          );
        });

        const loginScreenText = await page.locator('[data-screen-id="login-form"]').textContent();
        const loadingScreenText = await page.locator('[data-screen-id="loading"]').textContent();
        const dashboardScreenText = await page.locator('[data-screen-id="dashboard"]').textContent();

        expect(loginScreenText).toContain('Login Form Screen');
        expect(loadingScreenText).toContain('Loading Screen');
        expect(dashboardScreenText).toContain('Dashboard Screen');
        expect(await page.locator('[data-screen-frame]').count()).toBeGreaterThanOrEqual(3);
        expect(consoleErrors).toEqual([]);
        expect(pageErrors).toEqual([]);
      } finally {
        await page.close();
        await browser.close();
        await server.close();
      }
    },
    30_000
  );

  it(
    'captures a non-trivial PNG for the login workflow route',
    async () => {
      const projectRoot = resolve(fixturesDir, 'valid-workflow');
      const outputDir = await mkdtemp(join(tmpdir(), 'component-canvas-integration-'));
      const outputPath = join(outputDir, 'login-workflow.png');
      const server = await startServer({
        canvasDir: resolve(projectRoot, '.canvas'),
        projectRoot
      });

      try {
        const result = await captureScreenshot({
          url: `${server.url}#/workflow/login`,
          outputPath,
          viewport: DEFAULT_VIEWPORT,
          waitForSelector: '[data-workflow-id="login"]'
        });
        const [fileStats, file] = await Promise.all([stat(result.path), readFile(result.path)]);

        expect(fileStats.isFile()).toBe(true);
        expect(result.path).toBe(outputPath);
        expect(result.bytes).toBeGreaterThan(10_000);
        expect(fileStats.size).toBe(result.bytes);
        expect(file.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE_HEX);
        expect(result.width).toBe(DEFAULT_VIEWPORT.width);
        expect(result.height).toBe(DEFAULT_VIEWPORT.height);
      } finally {
        await server.close();
        await rm(outputDir, { recursive: true, force: true });
      }
    },
    30_000
  );

  it('reports workflow counts through list --json', async () => {
    const projectRoot = resolve(fixturesDir, 'valid-workflow');
    const { stdout, stderr } = await execFile('node', [cliPath, 'list', '--json'], {
      cwd: projectRoot
    });

    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({
      workflows: [
        {
          id: 'login',
          title: 'Login Flow',
          screens: 3,
          transitions: 2,
          variants: 1
        }
      ]
    });
  });
});

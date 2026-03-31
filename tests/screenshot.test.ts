import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { captureScreenshot, createBrowserPool } from '../lib/screenshot.ts';

describe('screenshot capture', () => {
  it(
    'captures a PNG from a simple HTTP server with the default viewport',
    async () => {
      const server = await startFixtureServer();
      const outputDir = await mkdtemp(join(tmpdir(), 'component-canvas-screenshot-'));
      const outputPath = join(outputDir, 'page.png');

      try {
        const result = await captureScreenshot({
          url: server.url,
          outputPath
        });

        const fileStats = await stat(result.path);
        const dimensions = await readPngDimensions(result.path);

        expect(fileStats.isFile()).toBe(true);
        expect(result.path).toBe(outputPath);
        expect(result.bytes).toBeGreaterThan(5_000);
        expect(fileStats.size).toBe(result.bytes);
        expect(result.width).toBe(1_280);
        expect(result.height).toBe(720);
        expect(dimensions).toEqual({ width: 1_280, height: 720 });
      } finally {
        await stopFixtureServer(server.server);
        await rm(outputDir, { recursive: true, force: true });
      }
    },
    30_000
  );

  it(
    'reuses a browser instance across multiple captures via the browser pool',
    async () => {
      const server = await startFixtureServer();
      const outputDir = await mkdtemp(join(tmpdir(), 'component-canvas-browser-pool-'));
      const firstPath = join(outputDir, 'first.png');
      const secondPath = join(outputDir, 'second.png');
      const pool = await createBrowserPool();

      try {
        const first = await pool.capture({
          url: server.url,
          outputPath: firstPath,
          viewport: { width: 960, height: 540 }
        });
        const second = await pool.capture({
          url: server.url,
          outputPath: secondPath,
          viewport: { width: 800, height: 600 }
        });

        expect(first.width).toBe(960);
        expect(first.height).toBe(540);
        expect(first.bytes).toBeGreaterThan(5_000);
        expect(await readPngDimensions(first.path)).toEqual({ width: 960, height: 540 });

        expect(second.width).toBe(800);
        expect(second.height).toBe(600);
        expect(second.bytes).toBeGreaterThan(5_000);
        expect(await readPngDimensions(second.path)).toEqual({ width: 800, height: 600 });
      } finally {
        await pool.close();
        await stopFixtureServer(server.server);
        await rm(outputDir, { recursive: true, force: true });
      }
    },
    30_000
  );
});

async function startFixtureServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8'
    });
    response.end(renderFixtureHtml());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Fixture server did not expose a network address.');
  }

  return {
    server,
    url: `http://127.0.0.1:${(address as AddressInfo).port}/`
  };
}

async function stopFixtureServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function renderFixtureHtml(): string {
  const cards = Array.from({ length: 12 }, (_value, index) => {
    return `<div class="card"><span>Stage ${index + 1}</span><strong>Screenshot test content</strong></div>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>component-canvas screenshot fixture</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, system-ui, sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: #f8fafc;
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.4), transparent 32%),
          radial-gradient(circle at top right, rgba(236, 72, 153, 0.35), transparent 28%),
          linear-gradient(135deg, #0f172a 0%, #1d4ed8 46%, #7c3aed 100%);
      }

      #app {
        min-height: 100vh;
        padding: 48px;
        display: grid;
        place-items: center;
      }

      .panel {
        width: min(1080px, 100%);
        padding: 40px;
        border-radius: 28px;
        background: rgba(15, 23, 42, 0.52);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.35);
        backdrop-filter: blur(18px);
      }

      .eyebrow {
        margin: 0;
        font-size: 14px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(226, 232, 240, 0.76);
      }

      h1 {
        margin: 16px 0 12px;
        font-size: 56px;
        line-height: 1;
      }

      p {
        margin: 0;
        max-width: 58ch;
        font-size: 20px;
        line-height: 1.6;
        color: rgba(248, 250, 252, 0.88);
      }

      .cards {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
        margin-top: 32px;
      }

      .card {
        min-height: 120px;
        padding: 18px;
        border-radius: 20px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.08));
        border: 1px solid rgba(255, 255, 255, 0.22);
      }

      .card span {
        font-size: 14px;
        color: rgba(224, 231, 255, 0.78);
      }

      .card strong {
        font-size: 19px;
      }
    </style>
  </head>
  <body>
    <div id="app">
      <section class="panel">
        <p class="eyebrow">component-canvas</p>
        <h1>Screenshot Fixture</h1>
        <p>
          This page is served by Node's built-in HTTP server so the screenshot module can capture
          a real browser-rendered PNG with known content and dimensions.
        </p>
        <div class="cards">${cards}</div>
      </section>
    </div>
  </body>
</html>`;
}

async function readPngDimensions(path: string): Promise<{ width: number; height: number }> {
  const file = await readFile(path);

  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20)
  };
}

import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';

export interface ScreenshotViewport {
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  url: string;
  selector?: string;
  outputPath: string;
  viewport?: ScreenshotViewport;
  waitForSelector?: string;
}

export interface ScreenshotResult {
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export interface BrowserPool {
  capture: (options: ScreenshotOptions) => Promise<ScreenshotResult>;
  close: () => Promise<void>;
}

const DEFAULT_VIEWPORT: ScreenshotViewport = {
  width: 1280,
  height: 720
};

const DEFAULT_WAIT_FOR_SELECTOR = '#app';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function captureScreenshot(options: ScreenshotOptions): Promise<ScreenshotResult> {
  const pool = await createBrowserPool();

  try {
    return await pool.capture(options);
  } finally {
    await pool.close();
  }
}

export async function createBrowserPool(): Promise<BrowserPool> {
  const browser = await chromium.launch({ headless: true });
  let closed = false;

  return {
    capture: async (options) => {
      if (closed) {
        throw new Error('Browser pool is already closed.');
      }

      return captureWithBrowser(browser, options);
    },

    close: async () => {
      if (closed) {
        return;
      }

      closed = true;
      await browser.close();
    }
  };
}

async function captureWithBrowser(browser: Browser, options: ScreenshotOptions): Promise<ScreenshotResult> {
  const viewport = normalizeViewport(options.viewport);
  const waitForSelector = options.waitForSelector ?? DEFAULT_WAIT_FOR_SELECTOR;
  const outputPath = resolve(options.outputPath);

  await mkdir(dirname(outputPath), { recursive: true });

  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1
  });

  try {
    const page = await context.newPage();

    await page.goto(options.url, { waitUntil: 'load' });
    await waitForRenderableSelector(page, waitForSelector);

    if (options.selector && options.selector !== waitForSelector) {
      await waitForRenderableSelector(page, options.selector);
    }

    if (options.selector) {
      await page.locator(options.selector).first().screenshot({
        path: outputPath,
        type: 'png',
        animations: 'disabled'
      });
    } else {
      await page.screenshot({
        path: outputPath,
        type: 'png',
        animations: 'disabled'
      });
    }
  } finally {
    await context.close();
  }

  return readScreenshotResult(outputPath);
}

function normalizeViewport(viewport?: ScreenshotViewport): ScreenshotViewport {
  return {
    width: viewport?.width ?? DEFAULT_VIEWPORT.width,
    height: viewport?.height ?? DEFAULT_VIEWPORT.height
  };
}

async function waitForRenderableSelector(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible' });
  await page.waitForFunction(
    (targetSelector: string) => {
      const element = document.querySelector(targetSelector);

      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
    selector
  );
}

async function readScreenshotResult(path: string): Promise<ScreenshotResult> {
  const [file, metadata] = await Promise.all([readFile(path), stat(path)]);
  const { width, height } = readPngDimensions(file);

  return {
    path,
    width,
    height,
    bytes: metadata.size
  };
}

function readPngDimensions(file: Buffer): { width: number; height: number } {
  if (file.byteLength < 24 || !file.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Screenshot output is not a valid PNG file.');
  }

  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20)
  };
}

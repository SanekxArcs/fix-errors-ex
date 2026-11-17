// Shared Playwright harness for the store screenshots and the promo video: loads the BUILT
// extension (.output/chrome-mv3) into a fresh persistent Chromium profile, points it at the demo
// server and calls the same worker entry points the e2e tests use (handleCommand,
// handleContextMenuClick), because Chrome's own shortcuts and native menu cannot be driven
// from Playwright. Nothing in the product is patched.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

export const extRoot = path.resolve(import.meta.dirname, '../..');
export const repoRoot = path.resolve(extRoot, '..');
// Brand logo: the ONE input for every generated store image and the promo video (store icon, tiles,
// screenshot captions, video intro/outro and frame icon). Square PNG, the artwork fills the canvas.
// To change the logo, replace these files (or point these paths elsewhere) and re-run
// `npm run store:assets` and `npm run promo:build`.
export const LOGO = path.join(repoRoot, 'brand/logo-1024.png');
export const LOGO_SMALL = path.join(repoRoot, 'brand/logo-small-1024.png'); // simplified, used at 32 px and below
export const extensionDir = path.resolve(extRoot, process.env.EXT_DIR || '.output/chrome-mv3');

export function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(homedir(), process.platform === 'win32' ? 'AppData/Local/ms-playwright' : '.cache/ms-playwright');
  const builds = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : [];
  for (const build of builds) {
    for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      if (existsSync(path.join(cache, build, exe))) return path.join(cache, build, exe);
    }
  }
  throw new Error('No Chromium found. Run "npx playwright-core install chromium" or set CHROME_PATH.');
}

/** Plain browser (no extension) for composing HTML into images and video frames. */
export const launchPlain = (opts = {}) => chromium.launch({ executablePath: findChromium(), headless: true, ...opts });

export async function launchWithExtension({ viewport = { width: 1280, height: 800 }, deviceScaleFactor = 2, headless = !process.env.HEADED } = {}) {
  if (!existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`No built extension at ${extensionDir}. Run "npm run build" first.`);
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'fix-errors-store-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: findChromium(),
    headless,
    viewport,
    deviceScaleFactor,
    colorScheme: 'light',
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--hide-scrollbars'],
  });
  context.setDefaultTimeout(15000);

  let live = null;
  context.on('serviceworker', (w) => { if (w.url().startsWith('chrome-extension://')) live = w; });
  live = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) || (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(live.url()).host;

  // The worker can go idle between scenes; wake it from an extension page and find the live handle.
  async function worker() {
    const ok = await Promise.race([live.evaluate(() => typeof handleCommand === 'function').catch(() => false), new Promise((r) => setTimeout(() => r(false), 800))]);
    if (ok) return live;
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/popup.html`);
    await p.evaluate(() => chrome.runtime.sendMessage({ action: 'ping' }).catch(() => {}));
    await p.close();
    for (let i = 0; i < 50; i++) {
      for (const w of context.serviceWorkers().filter((w) => w.url().startsWith('chrome-extension://')).reverse()) {
        if (await Promise.race([w.evaluate(() => typeof handleCommand === 'function').catch(() => false), new Promise((r) => setTimeout(() => r(false), 500))])) return (live = w);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Could not reach the extension service worker');
  }

  async function seed(values) {
    await (await worker()).evaluate(async (values) => {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
      await chrome.storage.local.set(values);
    }, values);
  }

  const tabIdOf = async (page) => (await worker()).evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, page.url());

  /** Same entry point as a click on one of the extension's menu items. Not awaited by callers that want to film the progress toast. */
  async function menuClick(page, menuItemId) {
    const selectionText = await page.evaluate(() => String(getSelection()).replace(/\s+/g, ' '));
    const tabId = await tabIdOf(page);
    await page.bringToFront();
    return (await worker()).evaluate(({ info, tabId }) => chrome.tabs.get(tabId).then((tab) => handleContextMenuClick(info, tab)), { info: { menuItemId, selectionText, frameId: 0 }, tabId });
  }

  /** Same entry point as the extension's keyboard shortcuts (manifest "commands"). */
  async function command(page, name) {
    await page.bringToFront();
    return (await worker()).evaluate((c) => handleCommand(c), name);
  }

  async function close() {
    await context.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  return { context, extensionId, worker, seed, menuClick, command, close };
}

/** Settings that point the extension at the demo server (same shape the e2e tests seed). */
export const demoSettings = (serverUrl, extra = {}) => ({
  aiProvider: 'lmstudio',
  lmStudioUrl: serverUrl,
  lmStudioModel: 'local-writing-model',
  fallbackProvider: 'none',
  modelLimitsEnabled: false,
  autoSelectAll: false,
  requestTimeoutSeconds: 20,
  ...extra,
});

// Raw captures for the Chrome Web Store images. Run after npm run build:
//   node tests/store/store-assets.mjs [--lang en]
// Loads the built extension into a fresh Chromium profile, seeds demo settings that point at
// the local demo server (canned AI answers), drives the real flows on demo pages and saves PNGs
// at deviceScaleFactor 2 to <repo>/.artifacts/store-raw/<lang>/. store-compose.mjs turns them
// into store images. The right-click menu is the only recreated element (see context-menu.mjs).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchWithExtension, demoSettings, repoRoot } from './harness.mjs';
import { startDemoServer } from './demo-server.mjs';
import { menuTree, menuScript } from './context-menu.mjs';
import { parseLang, demo } from './store-i18n.mjs';

const lang = parseLang();
const D = demo(lang);
const out = path.join(repoRoot, '.artifacts/store-raw', lang);
await mkdir(out, { recursive: true });
const PAGE = { width: 860, height: 600 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startDemoServer({ lang });
const ext = await launchWithExtension({ viewport: PAGE, deviceScaleFactor: 2 });
const { context, extensionId, seed, menuClick, command } = ext;
const errors = [];
const geometry = {};

const delay = (ms) => fetch(`${server.url}/__demo`, { method: 'POST', body: JSON.stringify({ delayMs: ms }) });
const shot = async (target, name, opts = {}) => {
  await sleep(opts.wait ?? 350);
  await target.screenshot({ path: path.join(out, name), animations: 'disabled', ...opts.shot });
  console.log(`captured ${name}`);
};
const toast = (page) => page.locator('#lbx-ai-toast');
const waitToast = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#lbx-ai-toast')?.innerText || ''), re.source);
const review = (page) => page.locator('#lbx-inline-review');
const reviewReady = (page) => page.waitForFunction(() => {
  const s = document.querySelector('#lbx-inline-review')?.shadowRoot;
  return s && s.getElementById('badge').textContent === 'Editable';
});

async function openDemo(view) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.url}/?view=${view}`);
  await page.addScriptTag({ content: menuScript });
  return page;
}

try {
  await seed({ ...demoSettings(server.url) });
  for (const p of context.pages()) if (!p.url().startsWith('http')) await p.close().catch(() => {});

  // 1. Fix in place: selection + recreated menu, progress toast, result.
  {
    const page = await openDemo('mail');
    await page.evaluate(() => window.__select('#typo'));
    const end = await page.evaluate(() => window.__selectionEnd());
    const tree = menuTree();
    await page.evaluate(({ end, tree, icon }) => window.__contextMenu.show({ x: end.x - 300, y: end.y - 8, tree, icon, path: ['fixGrammar'] }), { end, tree, icon: `${server.url}/icons/icon16.png` });
    await shot(page, 'mail-menu.png');
    await page.evaluate(() => window.__contextMenu.hide());
    await delay(4000);
    const run = menuClick(page, 'fixGrammar');
    await waitToast(page, /Waiting for/);
    await sleep(1300);
    await shot(page, 'mail-working.png', { wait: 0 });
    await shot(toast(page), 'toast-working.png', { wait: 0 });
    await run;
    await waitToast(page, /Done/);
    await page.evaluate(() => getSelection().removeAllRanges());
    await shot(page, 'mail-done.png', { wait: 500 });
    await shot(toast(page), 'toast-done.png', { wait: 0 });
    geometry.fixed = await page.evaluate(() => window.__text('#typo'));
    await page.close();
  }

  // 2. Review before applying: the real panel with different actions on the same text.
  await delay(700);
  {
    const page = await openDemo('mail');
    await page.evaluate(() => window.__select('#ask'));
    command(page, 'open_refine');
    await reviewReady(page);
    for (const action of ['toneFormal', 'toneEmojis', 'translateUkrainian', 'fixGrammar']) {
      await review(page).locator('#action').selectOption(action);
      await page.waitForFunction(() => document.querySelector('#lbx-inline-review').shadowRoot.getElementById('badge').textContent === 'Processing').catch(() => {});
      await reviewReady(page);
      await page.evaluate(() => document.activeElement?.blur?.());
      await shot(review(page).locator('.panel'), `review-${action}.png`);
      if (action === 'toneFormal') await shot(page, 'review-page.png', { wait: 0 });
    }
    await page.close();
  }

  // 3. Reply Assist on a chat thread.
  {
    const page = await openDemo('chat');
    await page.evaluate(() => window.__select('#draft'));
    command(page, 'ai_prompt');
    const panel = page.locator('#lbx-reply-assist-panel');
    await panel.waitFor();
    await panel.locator('textarea').fill(D.chat.context);
    await page.evaluate(() => document.activeElement?.blur?.());
    await shot(page, 'chat-assist.png');
    await shot(panel, 'chat-assist-panel.png', { wait: 0 });
    await delay(900);
    await panel.locator('button', { hasText: 'Refine' }).click();
    await waitToast(page, /Done/);
    await page.evaluate(() => getSelection().removeAllRanges());
    await shot(page, 'chat-done.png', { wait: 500 });
    await page.close();
  }

  // 4. Popup: settings, history and prompts, with seeded demo history.
  {
    const now = Date.now();
    const history = D.history.map((h) => ({
      timestamp: new Date(now - h.minutesAgo * 60000).toISOString(),
      original: h.original, fixed: h.fixed, action: h.action, applied: true,
      tokens: { input: h.input, output: h.output, total: h.input + h.output }, responseTimeMs: h.ms,
    }));
    await seed({
      ...demoSettings(server.url),
      aiProvider: 'gemini',
      geminiApiKey: 'demo-key-not-real-0000000000000000',
      geminiModel: 'gemini-3.5-flash-lite',
      fallbackProvider: 'lmstudio',
      fallbackLmStudioUrl: 'http://localhost:1234',
      fallbackLmStudioModel: 'local-writing-model',
      history,
      lifetimeStats: D.lifetime,
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 400, height: 720 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForLoadState('networkidle');
    // The popup is as tall as its content (the view scrolls at 480px), like Chrome's popup window.
    const fullShot = async (name) => {
      await page.setViewportSize({ width: 400, height: 100 });
      const h = await page.evaluate(() => Math.ceil(document.body.scrollHeight));
      await page.setViewportSize({ width: 400, height: h });
      geometry[name] = h;
      await shot(page, name);
    };
    await fullShot('popup-settings.png');
    await page.click('#view-history-btn');
    await fullShot('popup-history.png');
    await page.click('#view-prompts-btn');
    await fullShot('popup-prompts.png');
    await page.close();
  }

  await writeFile(path.join(out, 'geometry.json'), JSON.stringify(geometry, null, 2));
  if (errors.length) console.warn('page errors:', errors);
} finally {
  await ext.close();
  await server.close();
}

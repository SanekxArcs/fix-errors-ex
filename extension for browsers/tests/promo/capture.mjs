// Records real Fix Errors AI footage for the promo video. Run after npm run build:
//   node tests/promo/capture.mjs [--lang en] [clipName ...]
// Loads the built extension into a fresh profile (harness.mjs), points it at the local demo server
// (canned AI answers), keeps a CDP screencast running on the demo page and drives it with real
// mouse and keyboard input. Keyboard shortcuts and menu clicks go through the same worker entry
// points Chrome calls (handleCommand / handleContextMenuClick); the right-click menu itself is
// the HTML recreation from tests/store/context-menu.mjs, injected into the page so it is filmed.
// Writes frames plus a clip manifest with cursor/click/key events to <repo>/.artifacts/promo/<lang>/raw/.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchWithExtension, demoSettings, repoRoot } from '../store/harness.mjs';
import { startDemoServer } from '../store/demo-server.mjs';
import { menuTree, menuScript } from '../store/context-menu.mjs';
import { parseLang, demo } from '../store/store-i18n.mjs';

const argv = process.argv.slice(2);
const lang = parseLang(argv);
const D = demo(lang);
const only = argv.filter((a, i) => a !== '--lang' && argv[i - 1] !== '--lang');
const out = path.join(repoRoot, '.artifacts/promo', lang, 'raw');
await rm(path.join(out, 'frames'), { recursive: true, force: true });
await mkdir(path.join(out, 'frames'), { recursive: true });

const VIEW = { width: 960, height: 600 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const clips = [];
const events = [];
const frames = [];
const writes = [];
const errors = [];
let n = 0;
let pos = { x: 700, y: 520 };
let current = null;

const server = await startDemoServer({ lang });
const ext = await launchWithExtension({ viewport: VIEW, deviceScaleFactor: 2 });
const { context, extensionId, seed, menuClick, command } = ext;
const delay = (ms) => fetch(`${server.url}/__demo`, { method: 'POST', body: JSON.stringify({ delayMs: ms }) });
const tree = menuTree();
const icon = `${server.url}/icons/icon16.png`;

try {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
  await seed(demoSettings(server.url));
  for (const p of context.pages()) await p.close().catch(() => {});

  // --- One page + screencast per clip ---------------------------------------------------
  let page = null;
  const log = (type, extra = {}) => events.push({ t: now(), type, x: pos.x, y: pos.y, ...extra });
  const mark = (label) => current?.marks.push({ t: now(), label });
  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  const move = async (x, y, ms = 650) => {
    const from = { ...pos };
    const steps = Math.max(2, Math.round(ms / 16));
    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const p = ease(i / steps);
      pos = { x: from.x + (x - from.x) * p, y: from.y + (y - from.y) * p };
      await page.mouse.move(pos.x, pos.y);
      log('move');
      const wait = t0 + (ms * i) / steps - Date.now();
      if (wait > 0) await sleep(wait);
    }
  };
  const center = async (locator) => {
    await locator.waitFor();
    const b = await locator.boundingBox();
    if (!b) throw new Error('no box');
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const click = async (locator, ms = 650, { real = true } = {}) => {
    if (locator) {
      const c = await center(locator);
      await move(c.x, c.y, ms);
    }
    log('down');
    if (real) await page.mouse.down();
    await sleep(90);
    if (real) await page.mouse.up();
    log('click');
  };
  const type = async (text, delay = 55) => {
    for (const ch of text) {
      await page.keyboard.type(ch);
      log('key', { key: ch });
      await sleep(delay + ((ch.charCodeAt(0) * 17) % 30));
    }
  };
  // Real drag selection over a text; falls back to a scripted selection if the drag missed.
  const dragSelect = async (selector, needle) => {
    const { from, to } = await page.evaluate(([s, n]) => window.__dragPoints(s, n), [selector, needle]);
    await move(from.x - 2, from.y, 750);
    await sleep(150);
    log('down');
    await page.mouse.down();
    await move(to.x + 3, to.y, 1000);
    await page.mouse.up();
    log('click');
    const want = await page.evaluate(([s, n]) => (n ?? document.querySelector(s).innerText).replace(/\s+/g, ' ').trim(), [selector, needle]);
    const got = await page.evaluate(() => String(getSelection()).replace(/\s+/g, ' ').trim());
    if (got !== want) {
      console.log(`  drag selected "${got.slice(0, 40)}…", using a scripted selection`);
      await page.evaluate(([s, n]) => window.__select(s, n), [selector, needle]);
    }
  };
  // Right-click on the selection, then walk the recreated menu down to one of our items.
  const contextMenu = async (pathIds) => {
    const at = { ...pos };
    log('down', { button: 'right' });
    await sleep(110);
    log('click', { button: 'right' });
    const x = Math.min(at.x + 2, VIEW.width - 600);
    const y = Math.min(at.y + 2, VIEW.height - 330);
    await page.evaluate(({ x, y, tree, icon }) => window.__contextMenu.show({ x, y, tree, icon, openRoot: false }), { x, y, tree, icon });
    await sleep(450);
    const root = await page.evaluate((id) => window.__contextMenu.point(id), tree.id);
    await move(root.x, root.y, 650);
    await page.evaluate(({ x, y, tree, icon }) => window.__contextMenu.show({ x, y, tree, icon, path: [] }), { x, y, tree, icon });
    await sleep(380);
    for (let i = 0; i < pathIds.length; i++) {
      const p = await page.evaluate((id) => window.__contextMenu.point(id), pathIds[i]);
      // Slide right into the submenu first, then down to the row (like a real hand).
      await move(p.x, pos.y + (p.y - pos.y) * 0.15, 280);
      await move(p.x, p.y, 520);
      await page.evaluate(({ x, y, tree, icon, path }) => window.__contextMenu.show({ x, y, tree, icon, path }), { x, y, tree, icon, path: pathIds.slice(0, i + 1) });
      await sleep(i === pathIds.length - 1 ? 420 : 300);
    }
    log('down');
    await sleep(90);
    log('click');
    await page.evaluate(() => window.__contextMenu.hide());
  };
  const waitToast = (re, timeout = 15000) =>
    page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#lbx-ai-toast')?.innerText || ''), re.source, { timeout });
  const review = () => page.locator('#lbx-inline-review');
  const badgeIs = (text) =>
    page.waitForFunction((text) => document.querySelector('#lbx-inline-review')?.shadowRoot?.getElementById('badge')?.textContent === text, text);

  const clip = async (name, url, fn, setup) => {
    if (only.length && !only.includes(name)) return;
    console.log(`clip ${name}`);
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(url);
    if (url.startsWith('http')) await page.addScriptTag({ content: menuScript });
    if (setup) await setup();
    await sleep(700);
    await page.bringToFront();
    const cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      const file = `f${String(n++).padStart(6, '0')}.jpg`;
      frames.push({ file, t: metadata.timestamp });
      writes.push(writeFile(path.join(out, 'frames', file), Buffer.from(data, 'base64')));
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: VIEW.width * 2, maxHeight: VIEW.height * 2, everyNthFrame: 1 });
    // Nudge a repaint so the clip has a first frame, then start the clock.
    await page.evaluate(() => { document.body.style.outline = '0 solid transparent'; });
    await sleep(500);
    await page.mouse.move(pos.x, pos.y);
    current = { name, start: now(), marks: [] };
    log('move');
    try {
      await fn();
    } catch (e) {
      console.log(`  clip ${name} failed:`, e.message.split('\n')[0]);
      current.failed = true;
    }
    current.end = now();
    current.cursorEnd = { ...pos };
    clips.push(current);
    current = null;
    await cdp.send('Page.stopScreencast').catch(() => {});
    await page.screenshot({ path: path.join(out, `end-${name}.png`) });
    await cdp.detach().catch(() => {});
    await page.close();
  };
  const demoUrl = (q) => `${server.url}/?${q}`;

  // --- Clips ---------------------------------------------------------------------------
  // 1. Right-click → AI Text Tools → Fix grammar, with the real progress toast and in-place result.
  pos = { x: 760, y: 470 };
  await clip('fix', demoUrl('view=mail'), async () => {
    await sleep(500);
    await delay(2300);
    await dragSelect('#typo');
    await sleep(350);
    await contextMenu(['fixGrammar']);
    const run = menuClick(page, 'fixGrammar').catch((e) => console.log('  fix:', e.message));
    await waitToast(/Waiting for/);
    mark('working');
    await run;
    await waitToast(/Done/);
    mark('done');
    await page.evaluate(() => getSelection().removeAllRanges());
    await sleep(400);
    await move(640, 470, 900);
    await sleep(1500);
  });

  // 2. Review panel: open with the shortcut, switch actions, then apply.
  pos = { x: 700, y: 480 };
  await clip('review', demoUrl('view=mail'), async () => {
    await delay(1000);
    await sleep(400);
    await dragSelect('#ask');
    await sleep(300);
    mark('key:Alt+Shift+R');
    await sleep(450);
    command(page, 'open_refine').catch((e) => console.log('  review:', e.message));
    await badgeIs('Editable');
    mark('ready');
    await sleep(1300);
    for (const action of ['toneFormal', 'toneEmojis', 'translateUkrainian', 'toneFormal']) {
      await click(review().locator('#action'), 600, { real: false });
      await review().locator('#action').selectOption(action);
      mark(`action:${action}`);
      await badgeIs('Processing').catch(() => {});
      await badgeIs('Editable');
      await sleep(action === 'toneFormal' ? 1000 : 1350);
    }
    await click(review().locator('#done'), 650);
    mark('applied');
    await review().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await sleep(400);
    await move(560, 520, 800);
    await sleep(1300);
  });

  // 3. Reply Assist on a chat thread: shortcut, a hint about the tone, Refine.
  pos = { x: 760, y: 360 };
  await clip('reply', demoUrl('view=chat'), async () => {
    await delay(1500);
    await sleep(400);
    await dragSelect('#draft');
    await sleep(300);
    mark('key:Alt+Shift+A');
    await sleep(450);
    command(page, 'ai_prompt').catch((e) => console.log('  reply:', e.message));
    const panel = page.locator('#lbx-reply-assist-panel');
    await panel.waitFor();
    await sleep(700);
    await click(panel.locator('textarea'), 650);
    await sleep(200);
    await type(D.chat.context);
    await sleep(500);
    await click(panel.locator('button', { hasText: 'Refine' }), 600);
    await waitToast(/Done/);
    mark('done');
    await page.evaluate(() => getSelection().removeAllRanges());
    await sleep(400);
    await move(560, 300, 900);
    await sleep(1500);
  });

  // 4. Wrong keyboard layout fixed locally (no AI call).
  pos = { x: 760, y: 360 };
  await clip('translit', demoUrl('view=chat&thread=translit'), async () => {
    await sleep(400);
    await dragSelect('#draft');
    await sleep(300);
    await contextMenu(['translit']);
    await menuClick(page, 'translit');
    mark('done');
    await page.evaluate(() => getSelection().removeAllRanges());
    await sleep(300);
    await move(560, 300, 900);
    await sleep(1400);
  });

  // 5. Popup: settings, history with stats, editable prompts. Seeded demo history; the popup is
  // centred on a dark backdrop by a test-side stylesheet (the product popup is unchanged).
  {
    const now = Date.now();
    await seed({
      ...demoSettings(server.url),
      aiProvider: 'gemini',
      geminiApiKey: 'demo-key-not-real-0000000000000000',
      geminiModel: 'gemini-3.5-flash-lite',
      fallbackProvider: 'lmstudio',
      fallbackLmStudioUrl: 'http://localhost:1234',
      fallbackLmStudioModel: 'local-writing-model',
      history: D.history.map((h) => ({
        timestamp: new Date(now - h.minutesAgo * 60000).toISOString(),
        original: h.original, fixed: h.fixed, action: h.action, applied: true,
        tokens: { input: h.input, output: h.output, total: h.input + h.output }, responseTimeMs: h.ms,
      })),
      lifetimeStats: D.lifetime,
    });
  }
  pos = { x: 760, y: 420 };
  await clip('popup', `chrome-extension://${extensionId}/popup.html`, async () => {
    await sleep(1100);
    await click(page.locator('#view-history-btn'), 750);
    await sleep(1500);
    const list = page.locator('#view-history-btn');
    const b = await center(list);
    await move(b.x + 20, 330, 600);
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 90);
      log('wheel');
      await sleep(260);
    }
    await sleep(900);
    await click(page.locator('#view-prompts-btn'), 650);
    await sleep(1400);
    await move(760, 300, 700);
    await sleep(1200);
  }, async () => {
    await page.waitForLoadState('networkidle');
    await page.addStyleTag({
      content: `html{min-height:100%;background:radial-gradient(ellipse at 50% 0%,#24324d 0%,#10151e 62%) fixed}
        body{margin:9px auto!important;border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px #ffffff1f,0 28px 70px #000000b0}`,
    });
  });

  await sleep(300);
  await Promise.all(writes);
} catch (error) {
  console.error('Fatal:', error);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ view: VIEW, scale: 2, frames, clips, events }, null, 1));
  await ext.close();
  await server.close();
}
if (errors.length) console.warn('page errors:', errors);
console.log(`frames: ${frames.length}, clips: ${clips.map((c) => `${c.name}${c.failed ? '(failed)' : ''} ${(c.end - c.start).toFixed(1)}s`).join(', ')}`);

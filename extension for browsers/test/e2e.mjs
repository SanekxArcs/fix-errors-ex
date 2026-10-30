// Browser test environment: loads the built extension into Chromium, points it
// at the mock AI server, and drives every editor on test/test-page.html.
//   npm run test:e2e              build, then run all scenarios headless
//   HEADED=1 npm run test:e2e     watch it run
//   ONLY=iframe npm run test:e2e  run scenarios whose name contains "iframe"
import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockServer, mockFix } from './mock-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = resolve(root, process.env.EXT_DIR || '.output/chrome-mv3');
const FEEDBACK_LIMIT_MS = 15000; // Any request must end with visible feedback within this time.

function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === 'win32' ? 'AppData/Local/ms-playwright' : '.cache/ms-playwright');
  const builds = existsSync(cache) ? readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : [];
  for (const build of builds) {
    for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      if (existsSync(join(cache, build, exe))) return join(cache, build, exe);
    }
  }
  throw new Error('No Chromium found. Run "npx playwright-core install chromium" or set CHROME_PATH (branded Chrome cannot load unpacked extensions from the command line).');
}

if (!existsSync(join(extensionDir, 'manifest.json'))) throw new Error(`No built extension at ${extensionDir}. Run "npm run build" first.`);
const mock = await startMockServer();
const userDataDir = mkdtempSync(join(tmpdir(), 'fix-errors-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: findChromium(),
  headless: !process.env.HEADED,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
});
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: mock.url });

let extensionId = null;
let liveWorker = null;
context.on('serviceworker', w => { if (w.url().startsWith('chrome-extension://')) liveWorker = w; });
async function worker() {
  if (!extensionId) return context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://')) || context.waitForEvent('serviceworker', { timeout: 10000 });
  if (liveWorker) return liveWorker;
  // A stopped worker restarts on the next extension event; send one from an extension page.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate(() => chrome.runtime.sendMessage({ action: 'ping' }).catch(() => {}));
  await page.close();
  // Playwright may not announce the restarted worker; probe every known handle.
  for (let i = 0; i < 50 && !liveWorker; i++) {
    for (const w of context.serviceWorkers().filter(w => w.url().startsWith('chrome-extension://')).reverse()) {
      const alive = await Promise.race([w.evaluate(() => typeof handleCommand === 'function').catch(() => false), new Promise(r => setTimeout(() => r(false), 500))]);
      if (alive) { liveWorker = w; break; }
    }
    if (!liveWorker) await new Promise(r => setTimeout(r, 200));
  }
  if (!liveWorker) throw new Error(`Could not reconnect to the restarted worker (${context.serviceWorkers().length} handles).`);
  return liveWorker;
}
liveWorker = await worker();
extensionId = new URL(liveWorker.url()).host;

const BASE_SETTINGS = { aiProvider: 'lmstudio', lmStudioUrl: mock.url, lmStudioModel: 'mock-model', fallbackProvider: 'none', modelLimitsEnabled: false, autoSelectAll: false, requestTimeoutSeconds: 4 };
async function settings(extra = {}) {
  await (await worker()).evaluate(async values => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.storage.local.set(values);
  }, { ...BASE_SETTINGS, ...extra });
}

async function openTestPage() {
  const page = await context.newPage();
  await page.goto(`${mock.url}/`);
  await page.waitForFunction(() => window.__toasts && document.querySelector('#frame-textarea').contentWindow.__select);
  return page;
}

const toastMark = page => page.evaluate(() => window.__toasts.length);
async function waitForFeedback(page, mark, { timeout = FEEDBACK_LIMIT_MS, type } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const toasts = await page.evaluate(m => window.__toasts.slice(m), mark);
    const final = toasts.find(t => t.type !== 'working' && (!type || t.type === type) && !/^Cancelling/.test(t.text));
    if (final) return { ...final, toasts, ms: Date.now() - started };
    await page.waitForTimeout(100);
  }
  const toasts = await page.evaluate(m => window.__toasts.slice(m), mark);
  throw new Error(`No ${type || 'final'} feedback within ${timeout / 1000}s. Toasts seen: ${JSON.stringify(toasts.map(t => `${t.type}: ${t.text}`))}`);
}

// Runs a shortcut/menu handler in the worker without blocking on it.
function trigger(page, fn, arg) {
  return page.bringToFront().then(worker).then(w => w.evaluate(fn, arg)).catch(error => ({ triggerError: error.message }));
}
const command = (page, name) => trigger(page, c => handleCommand(c), name);
async function contextMenu(page, menuItemId, frameUrlPart = null) {
  const w = await worker();
  const tabId = await w.evaluate(async url => (await chrome.tabs.query({ url: `${url}/*` }))[0]?.id, mock.url);
  const frameId = frameUrlPart ? await w.evaluate(async ({ tabId, part }) => {
    const frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => location.href });
    return frames.find(f => f.result.includes(part))?.frameId ?? 0;
  }, { tabId, part: frameUrlPart }) : 0;
  const selectionText = await page.evaluate(() => {
    const frames = [window, ...[...document.querySelectorAll('iframe')].map(f => f.contentWindow)];
    for (const w of frames) {
      const el = w.document.activeElement;
      if (el && typeof el.selectionStart === 'number' && el.selectionEnd > el.selectionStart) return el.value.slice(el.selectionStart, el.selectionEnd);
      const host = el?.shadowRoot?.activeElement;
      if (host && host.selectionEnd > host.selectionStart) return host.value.slice(host.selectionStart, host.selectionEnd);
      if (String(w.getSelection())) return String(w.getSelection());
    }
    return '';
  });
  return trigger(page, ({ info, tabId }) => chrome.tabs.get(tabId).then(tab => handleContextMenuClick(info, tab)), { info: { menuItemId, selectionText: selectionText.replace(/\s+/g, ' '), frameId }, tabId });
}

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const value = (page, selector) => page.evaluate(s => window.__value(s), selector);

// Select, trigger, wait for feedback, then verify the field.
async function fixField(page, { selector, needle = null, via = 'fix_selected', expectType = 'success', frame = null }) {
  const target = frame || page;
  const selected = await target.evaluate(([s, n]) => window.__select(s, n), [selector, needle]);
  const before = await target.evaluate(s => window.__value(s), selector);
  const mark = await toastMark(page);
  if (via.startsWith('menu:')) contextMenu(page, via.slice(5), frame ? new URL(frame.url()).pathname || 'srcdoc' : null);
  else command(page, via);
  const feedback = await waitForFeedback(page, mark);
  const after = await target.evaluate(s => window.__value(s), selector);
  assert(feedback.type === expectType, `Expected ${expectType} feedback, got ${feedback.type}: "${feedback.text}"`);
  if (expectType === 'success') {
    const expected = before.replace(selected, mockFix(selected));
    assert(after.replace(/​/g, '').trim() === expected.trim(), `Field not updated as expected.\n      selected: ${JSON.stringify(selected)}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(after)}`);
  }
  return { feedback, before, after, selected };
}

const scenarios = [];
const scenario = (name, run, setup = {}) => scenarios.push({ name, run, setup });

// ── Editors ────────────────────────────────────────────────────────────────
scenario('input: whole value', page => fixField(page, { selector: '#plain-input' }));
scenario('textarea: one line of several', page => fixField(page, { selector: '#textarea', needle: 'Line three is wierd.' }));
scenario('textarea: all lines', page => fixField(page, { selector: '#textarea' }));
scenario('React-style controlled input', async page => {
  await fixField(page, { selector: '#react-input' });
  await page.waitForTimeout(400);
  assert(!/teh|adress/.test(await value(page, '#react-input')), 'React state reverted the replacement');
});
scenario('contenteditable: single line', page => fixField(page, { selector: '#ce-single' }));
scenario('contenteditable: partial word range', page => fixField(page, { selector: '#ce-single', needle: 'check teh adress' }));
scenario('contenteditable: multiple paragraphs (Gmail style)', page => fixField(page, { selector: '#ce-multi' }));
scenario('Slack-style editor with @mention chip', async page => {
  await fixField(page, { selector: '#ce-mention' });
  assert(await page.evaluate(() => document.querySelector('#ce-mention .mention')?.textContent === '@Anna'), 'Mention chip was damaged');
});
scenario('editor rebuilds its DOM while the AI works', page => fixField(page, { selector: '#ce-rerender' }), { mode: 'slow', delayMs: 1200 });
scenario('double-clicked word keeps its trailing space', async page => {
  // Windows selects "word " on double-click; the AI's trimmed answer must not glue words together.
  await fixField(page, { selector: '#plain-input', needle: 'teh ' });
  assert(/the package/.test(await value(page, '#plain-input')), await value(page, '#plain-input'));
});
scenario('editor that rejects edits gives a copyable error', async page => {
  const { feedback } = await fixField(page, { selector: '#ce-reject', expectType: 'error' });
  assert(await page.evaluate(() => [...document.querySelectorAll('#lbx-ai-toast button')].some(b => /Copy/.test(b.innerText))), `No Copy button on: ${feedback.text}`);
});
scenario('textarea inside a shadow root', async page => {
  const selected = await page.evaluate(() => window.__select('#shadow-textarea', null, document.getElementById('shadow-host').shadowRoot));
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark);
  const after = await page.evaluate(() => document.getElementById('shadow-host').shadowRoot.querySelector('textarea').value);
  assert(feedback.type === 'success' && after === mockFix(selected), `Got ${feedback.type} "${feedback.text}", value ${JSON.stringify(after)}`);
});
scenario('iframe textarea via shortcut', page => fixField(page, { selector: '#frame-field', frame: page.frame({ url: /frame\.html/ }) }));
scenario('iframe textarea via right-click menu', page => fixField(page, { selector: '#frame-field', frame: page.frame({ url: /frame\.html/ }), via: 'menu:fixGrammar' }));
scenario('rich-text iframe (TinyMCE style) via shortcut', async page => {
  const frame = page.frames().find(f => f.url() === 'about:srcdoc');
  const selected = await frame.evaluate(() => { document.body.focus(); const r = document.createRange(); r.selectNodeContents(document.body); getSelection().removeAllRanges(); getSelection().addRange(r); return String(getSelection()); });
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark);
  const after = await frame.evaluate(() => document.body.innerText.trim());
  assert(feedback.type === 'success' && after === mockFix(selected), `Got ${feedback.type} "${feedback.text}", body ${JSON.stringify(after)}`);
});
scenario('read-only page text via right-click menu', async page => {
  const selected = await page.evaluate(() => window.__select('#readonly'));
  const mark = await toastMark(page);
  contextMenu(page, 'fixGrammar');
  const feedback = await waitForFeedback(page, mark);
  const offersCopy = await page.evaluate(() => [...document.querySelectorAll('#lbx-ai-toast button')].some(b => /Copy/.test(b.innerText)));
  const after = await value(page, '#readonly');
  assert(feedback.type === 'success' ? after === mockFix(selected) : offersCopy, `Got ${feedback.type} "${feedback.text}" without a usable result`);
});
scenario('Alt+Shift+F with auto-select on a multi-paragraph editor', async page => {
  await page.evaluate(() => { const el = document.getElementById('ce-multi'); el.focus(); getSelection().collapse(el.firstChild.firstChild, 2); });
  const before = await value(page, '#ce-multi');
  const mark = await toastMark(page);
  command(page, 'fix_grammar');
  const feedback = await waitForFeedback(page, mark);
  const after = await value(page, '#ce-multi');
  assert(feedback.type === 'success' && after.trim() === mockFix(before).trim(), `Got ${feedback.type} "${feedback.text}", value ${JSON.stringify(after)}`);
}, { settings: { autoSelectAll: true } });

// ── Feedback and failure handling ──────────────────────────────────────────
scenario('nothing selected explains why', async page => {
  await page.evaluate(() => { const el = document.getElementById('plain-input'); el.focus(); el.setSelectionRange(2, 2); });
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark, { timeout: 3000 });
  assert(feedback.type === 'error' && /Nothing selected/.test(feedback.text), feedback.text);
});
scenario('slow AI (5s): progress shown immediately, then applied', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  await page.waitForFunction(m => window.__toasts.slice(m).some(t => t.type === 'working'), mark, { timeout: 1500 });
  const feedback = await waitForFeedback(page, mark);
  assert(feedback.type === 'success', feedback.text);
  assert(feedback.ms >= 4000, `Finished suspiciously fast (${feedback.ms}ms)`);
}, { mode: 'slow', delayMs: 5000, settings: { requestTimeoutSeconds: 10 } });
scenario('AI never answers: times out with a clear error', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const before = await value(page, '#plain-input');
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark);
  assert(feedback.type === 'error' && /respond|time/i.test(feedback.text), `Got ${feedback.type}: "${feedback.text}"`);
  assert(await value(page, '#plain-input') === before, 'Text changed after a timeout');
  assert(await page.locator('#lbx-ai-toast button', { hasText: 'Choose model' }).count() === 1, 'Timeout did not offer a retry');
}, { mode: 'hang' });
scenario('server error 500', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark);
  assert(feedback.type === 'error' && /internal error/.test(feedback.text), feedback.text);
}, { mode: 'error500' });
scenario('connection dropped by server', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark);
  assert(feedback.type === 'error', feedback.text);
}, { mode: 'drop' });
scenario('provider server offline', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark);
  assert(feedback.type === 'error', feedback.text);
}, { settings: { lmStudioUrl: 'http://127.0.0.1:9' } });
scenario('empty AI answer keeps the original', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const before = await value(page, '#plain-input');
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark);
  assert(feedback.type === 'error' && await value(page, '#plain-input') === before, `${feedback.type}: ${feedback.text}`);
}, { mode: 'empty' });
scenario('reasoning model <think> block is not pasted', async page => {
  await fixField(page, { selector: '#plain-input' });
  assert(!/think/.test(await value(page, '#plain-input')), 'Pasted the <think> block');
}, { mode: 'think' });
scenario('user edits the field while waiting: result not forced in', async page => {
  await page.evaluate(() => window.__select('#edited-input'));
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  await page.waitForTimeout(500);
  await page.locator('#edited-input').press('End');
  await page.locator('#edited-input').pressSequentially(' plus more');
  const feedback = await waitForFeedback(page, mark);
  const after = await value(page, '#edited-input');
  assert(feedback.type === 'error' && after.endsWith('plus more'), `${feedback.type}: ${feedback.text} / ${after}`);
  assert(await page.evaluate(() => [...document.querySelectorAll('#lbx-ai-toast button')].some(b => /Copy/.test(b.innerText))), 'No Copy button offered');
}, { mode: 'slow', delayMs: 2000 });
scenario('cancel from the toast leaves text unchanged', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const before = await value(page, '#plain-input');
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  await page.waitForFunction(m => window.__toasts.slice(m).some(t => t.type === 'working'), mark, { timeout: 2000 });
  await page.locator('#lbx-ai-toast button[title^="Cancel"]').click();
  const feedback = await waitForFeedback(page, mark);
  await page.waitForTimeout(3000);
  assert(/Cancel/i.test(feedback.text), feedback.text);
  assert(await value(page, '#plain-input') === before, 'Cancelled request still changed the text');
}, { mode: 'slow', delayMs: 2500 });
scenario('model overloaded: retry picker works', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark);
  assert(/overloaded/i.test(feedback.text), feedback.text);
  await page.locator('#lbx-ai-toast button', { hasText: 'Choose model' }).click();
  mock.setMode('ok');
  const mark2 = await toastMark(page);
  await page.locator('#lbx-model-picker-panel button', { hasText: 'LM Studio' }).click();
  const retried = await waitForFeedback(page, mark2);
  assert(retried.type === 'success' && !/recieve/.test(await value(page, '#plain-input')), `${retried.type}: ${retried.text}`);
}, { mode: 'overloaded' });
scenario('retry still works after the worker forgot its state', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  await waitForFeedback(page, mark);
  await page.locator('#lbx-ai-toast button', { hasText: 'Choose model' }).click();
  await simulateWorkerRestart();
  mock.setMode('ok');
  const mark2 = await toastMark(page);
  await page.locator('#lbx-model-picker-panel button', { hasText: 'LM Studio' }).click();
  const retried = await waitForFeedback(page, mark2, { timeout: 8000 });
  assert(retried.type === 'success', `${retried.type}: ${retried.text}`);
}, { mode: 'overloaded' });
scenario('Reply Assist submits after the worker forgot its state', async page => {
  const selected = await page.evaluate(() => window.__select('#plain-input'));
  await command(page, 'ai_prompt');
  await page.waitForSelector('#lbx-reply-assist-panel');
  await simulateWorkerRestart();
  await page.locator('#lbx-reply-assist-panel textarea').fill('Casual chat with a friend');
  const mark = await toastMark(page);
  await page.locator('#lbx-reply-assist-panel button', { hasText: 'Refine' }).click();
  const feedback = await waitForFeedback(page, mark, { timeout: 8000 });
  assert(feedback.type === 'success' && await value(page, '#plain-input') === mockFix(selected), `${feedback.type}: ${feedback.text}`);
});
scenario('Review panel: apply result to a contenteditable', async page => {
  const selected = await page.evaluate(() => window.__select('#ce-single'));
  await command(page, 'open_refine');
  const status = page.locator('#lbx-inline-review #status');
  await status.filter({ hasText: /Ready|Try|error|time/i }).waitFor({ timeout: FEEDBACK_LIMIT_MS });
  assert(/Ready/.test(await status.innerText()), await status.innerText());
  await page.locator('#lbx-inline-review #done').click();
  await status.filter({ hasText: /Applied|Copied|not|could/i }).waitFor({ timeout: 5000 });
  assert(/Applied/.test(await status.innerText()), await status.innerText());
  assert(await value(page, '#ce-single') === mockFix(selected), await value(page, '#ce-single'));
});
scenario('Review panel: AI never answers shows an error quickly', async page => {
  await page.evaluate(() => window.__select('#ce-single'));
  const started = Date.now();
  await command(page, 'open_refine');
  const status = page.locator('#lbx-inline-review #status.error');
  await status.waitFor({ timeout: FEEDBACK_LIMIT_MS });
  assert(/respond|time/i.test(await status.innerText()), await status.innerText());
  return { ms: Date.now() - started };
}, { mode: 'hang' });
scenario('two tabs: cancelling one does not cancel the other', async (page) => {
  const other = await openTestPage();
  try {
    await page.evaluate(() => window.__select('#plain-input'));
    const markA = await toastMark(page);
    command(page, 'fix_selected');
    await page.waitForFunction(m => window.__toasts.slice(m).some(t => t.type === 'working'), markA, { timeout: 2000 });
    await other.evaluate(() => window.__select('#plain-input'));
    const markB = await toastMark(other);
    command(other, 'fix_selected');
    await other.waitForFunction(m => window.__toasts.slice(m).some(t => t.type === 'working'), markB, { timeout: 2000 });
    await page.locator('#lbx-ai-toast button[title^="Cancel"]').click();
    const [a, b] = await Promise.all([waitForFeedback(page, markA), waitForFeedback(other, markB)]);
    assert(/Cancel/i.test(a.text), `Tab A: ${a.type} ${a.text}`);
    assert(b.type === 'success', `Tab B was affected: ${b.type} ${b.text}`);
  } finally { await other.close(); }
}, { mode: 'slow', delayMs: 3000 });

// ── Gemini (requests intercepted and served by the mock) ───────────────────
const GEMINI = { aiProvider: 'gemini', geminiApiKey: 'test-key', geminiModel: 'gemini-3.5-flash-lite' };
scenario('Gemini: fix applied', page => fixField(page, { selector: '#ce-multi' }), { settings: GEMINI, gemini: true });
scenario('Gemini: output budget exhausted explains why', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark);
  assert(feedback.type === 'error' && /MAX_TOKENS|output|budget|limit/i.test(feedback.text), `${feedback.type}: ${feedback.text}`);
}, { settings: GEMINI, gemini: true, mode: 'maxTokens' });
scenario('Gemini: never answers times out', async page => {
  await page.evaluate(() => window.__select('#plain-input'));
  const mark = await toastMark(page);
  command(page, 'fix_selected');
  const feedback = await waitForFeedback(page, mark);
  assert(feedback.type === 'error' && /respond|time/i.test(feedback.text), `${feedback.type}: ${feedback.text}`);
}, { settings: GEMINI, gemini: true, mode: 'hang' });
scenario('Gemini fails, LM Studio fallback answers', page => fixField(page, { selector: '#plain-input' }), {
  settings: { ...GEMINI, fallbackProvider: 'lmstudio', fallbackLmStudioUrl: 'MOCK', fallbackLmStudioModel: 'mock' }, gemini: 'error'
});

// Stop the extension worker the way Chrome does after ~30s idle. Its in-memory
// state is lost; the next extension event starts a fresh worker.
async function simulateWorkerRestart() {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const cdp = await context.newCDPSession(page);
  let known;
  const ready = new Promise(r => { known = r; setTimeout(r, 2000); });
  const stopped = new Promise(r => {
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      known();
      if (versions.length && versions.every(v => v.runningStatus === 'stopped')) r(true);
    });
    setTimeout(() => r(false), 5000);
  });
  await cdp.send('ServiceWorker.enable');
  await ready;
  await cdp.send('ServiceWorker.stopAllWorkers');
  const ok = await stopped;
  await page.close();
  if (!ok) throw new Error('Could not stop the extension service worker.');
  liveWorker = null;
}

let geminiRouteMode = null, geminiRequests = 0;
await context.route('https://generativelanguage.googleapis.com/**', async route => {
  geminiRequests += 1;
  if (geminiRouteMode === 'error' && route.request().url().includes(':generateContent')) return route.fulfill({ status: 500, json: { error: { message: 'Gemini mock failure' } } });
  const url = new URL(route.request().url());
  try {
    const response = await route.fetch({ url: `${mock.url}${url.pathname}${url.search}`, timeout: 0 });
    await route.fulfill({ response });
  } catch { await route.abort().catch(() => {}); }
});

// ── Runner ─────────────────────────────────────────────────────────────────
const results = [];
const only = process.env.ONLY?.toLowerCase();
for (const { name, run, setup } of scenarios) {
  if (only && !name.toLowerCase().includes(only)) continue;
  const extra = { ...setup.settings };
  if (extra.fallbackLmStudioUrl === 'MOCK') extra.fallbackLmStudioUrl = mock.url;
  await settings(extra);
  mock.setMode(setup.mode || 'ok', setup.delayMs ?? 3000);
  geminiRouteMode = setup.gemini === 'error' ? 'error' : null;
  const before = geminiRequests;
  const page = await openTestPage();
  const started = Date.now();
  let error = null, detail = null;
  try { detail = await Promise.race([run(page), new Promise((_, reject) => setTimeout(() => reject(new Error('Scenario exceeded 45s')), 45000))]); }
  catch (e) { error = e; }
  const ms = Date.now() - started;
  if (setup.gemini && !error && geminiRequests === before) error = new Error('Gemini traffic was not intercepted; the scenario did not exercise the mock.');
  results.push({ name, ok: !error, ms, error: error?.message, feedback: detail?.feedback?.text });
  console.log(`${error ? 'FAIL' : 'PASS'}  ${name}  (${(ms / 1000).toFixed(1)}s)${error ? `\n      ${error.message.split('\n').join('\n      ')}` : ''}`);
  mock.setMode('ok');
  await page.close().catch(() => {});
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
await context.close();
await mock.close();
rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
process.exitCode = failed.length ? 1 : 0;

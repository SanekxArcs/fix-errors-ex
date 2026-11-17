// Deterministic "AI" plus the demo pages for the store screenshots and the promo video.
// It speaks LM Studio's /v1/chat/completions, so the built extension reaches it through its
// existing http://localhost/* host permission: no product code changes and no request routing.
// Answers come from cannedAnswers() (store-i18n.mjs) keyed by action and selected text; anything
// else falls back to mockFix() from test/mock-server.mjs, the same fixer the e2e tests use.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { mockFix } from '../../test/mock-server.mjs';
import { cannedAnswers, demo, norm } from './store-i18n.mjs';

const ext = path.resolve(import.meta.dirname, '../..');

// DEFAULT_PROMPTS from constants.js, to tell which action a prompt belongs to.
function loadPrompts() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${readFileSync(path.join(ext, 'constants.js'), 'utf8')}\nthis.DEFAULT_PROMPTS = DEFAULT_PROMPTS;`, ctx);
  return ctx.DEFAULT_PROMPTS;
}

/** Splits a prompt built by background.js into { action, text, context }. */
export function parsePrompt(prompt, prompts = loadPrompts()) {
  const action = Object.keys(prompts).find((k) => prompts[k] && prompt.startsWith(prompts[k])) ?? 'aiPrompt';
  if (action === 'replyAssist') {
    const m = prompt.match(/Context \(surrounding conversation\):\n"([\s\S]*)"\n\nText to refine:\n"([\s\S]*)"$/);
    if (m) return { action, context: m[1], text: m[2] };
    const t = prompt.match(/Text to refine:\n"([\s\S]*)"$/);
    return { action, context: '', text: t ? t[1] : prompt };
  }
  const t = prompt.match(/\n\nText: "([\s\S]*)"$/);
  return { action, text: t ? t[1] : prompt, context: '' };
}

export async function startDemoServer({ lang = 'en', port = 0, delayMs = 900 } = {}) {
  const prompts = loadPrompts();
  const canned = cannedAnswers(lang);
  const state = { delayMs, requests: [] };
  const D = demo(lang);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.end();
    try {
      if (url.pathname === '/' || url.pathname === '/demo') {
        const html = (await readFile(path.join(import.meta.dirname, 'demo-page.html'), 'utf8')).replace(
          '/*DEMO*/null',
          JSON.stringify(D).replace(/</g, '\u003c'),
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      if (url.pathname.startsWith('/icons/')) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(await readFile(path.join(ext, 'icons', path.basename(url.pathname))));
      }
      if (url.pathname === '/__demo' && req.method === 'POST') {
        const next = JSON.parse(body || '{}');
        if (next.delayMs != null) state.delayMs = Number(next.delayMs);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ delayMs: state.delayMs }));
      }
      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        const prompt = JSON.parse(body).messages?.at(-1)?.content || '';
        const { action, text, context } = parsePrompt(prompt, prompts);
        const answer = canned[action]?.[norm(text)] ?? mockFix(text);
        state.requests.push({ action, text, context, answer });
        await new Promise((r) => setTimeout(r, state.delayMs));
        const input = Math.ceil(prompt.length / 4);
        const output = Math.ceil(answer.length / 4);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: answer } }],
          usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
        }));
      }
      if (url.pathname === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'local-writing-model' }] }));
      }
      res.writeHead(404).end('Not found');
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;
  return {
    url: `http://127.0.0.1:${actual}`,
    state,
    close() { server.closeAllConnections?.(); return new Promise((r) => server.close(r)); },
  };
}

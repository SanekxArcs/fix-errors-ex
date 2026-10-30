// Mock AI provider and test-page host for the browser test environment.
// LM Studio (/v1/chat/completions) and Gemini (/v1beta/models/...) compatible.
// Run directly for manual testing: node test/mock-server.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TYPOS = { teh: 'the', recieve: 'receive', wierd: 'weird', adress: 'address', definately: 'definitely', seperate: 'separate' };

// Deterministic "AI": fixes a few known typos so tests can predict the result.
export function mockFix(text) {
  return text.replace(/\b[a-z]+\b/gi, word => TYPOS[word.toLowerCase()] ?? word);
}

function extractText(prompt) {
  const marker = prompt.lastIndexOf('Text: "') >= 0 ? 'Text: "' : 'Text to refine:\n"';
  const start = prompt.lastIndexOf(marker);
  if (start < 0) return prompt;
  return prompt.slice(start + marker.length, prompt.lastIndexOf('"'));
}

const MODES = ['ok', 'slow', 'hang', 'error500', 'overloaded', 'ratelimit', 'empty', 'think', 'maxTokens', 'drop'];

export async function startMockServer(port = 0) {
  const state = { mode: 'ok', delayMs: 3000, requests: [] };
  const hanging = new Set();
  const page = name => readFile(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

  async function respondAI(res, provider, prompt) {
    const text = extractText(prompt);
    state.requests.push({ at: Date.now(), provider, mode: state.mode, text });
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    switch (state.mode) {
      case 'hang': hanging.add(res); res.on('close', () => hanging.delete(res)); return;
      case 'drop': res.socket.destroy(); return;
      case 'slow': await new Promise(r => setTimeout(r, state.delayMs)); break;
      case 'error500': return json(500, { error: { message: 'Mock server: internal error' } });
      case 'overloaded': return json(503, { error: { message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } });
      case 'ratelimit': return json(429, { error: { message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } }, { 'Retry-After': '1' });
    }
    if (res.destroyed) return;
    let answer = mockFix(text);
    if (state.mode === 'empty' || state.mode === 'maxTokens') answer = '';
    if (state.mode === 'think') answer = `<think>The user wants typo fixes.</think>\n${answer}`;
    if (provider === 'gemini') {
      return json(200, {
        candidates: [{ content: { parts: answer ? [{ text: answer }] : [] }, finishReason: state.mode === 'maxTokens' ? 'MAX_TOKENS' : 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }
      });
    }
    json(200, { choices: [{ message: { role: 'assistant', content: answer } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.end();
    try {
      if (url.pathname === '/' || url.pathname === '/test-page.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(await page('test-page.html'));
      }
      if (url.pathname === '/frame.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(await page('frame.html'));
      }
      if (url.pathname === '/__mock') {
        if (req.method === 'POST') {
          const next = JSON.parse(body || '{}');
          if (next.mode && !MODES.includes(next.mode)) throw new Error(`Unknown mode ${next.mode}`);
          Object.assign(state, next.mode ? { mode: next.mode } : {}, next.delayMs != null ? { delayMs: Number(next.delayMs) } : {});
          if (next.reset) state.requests = [];
          if (state.mode !== 'hang') for (const pending of hanging) pending.destroy();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ mode: state.mode, delayMs: state.delayMs, modes: MODES, requests: state.requests.length }));
      }
      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        const data = JSON.parse(body);
        return respondAI(res, 'lmstudio', data.messages?.at(-1)?.content || '');
      }
      const gemini = url.pathname.match(/^\/v1beta\/models\/([^/:]+)(?::(countTokens|generateContent))?$/);
      if (gemini) {
        res.setHeader('Content-Type', 'application/json');
        if (!gemini[2]) return res.end(JSON.stringify({ name: `models/${gemini[1]}`, inputTokenLimit: 1048576, outputTokenLimit: 65536 }));
        const prompt = JSON.parse(body).contents?.[0]?.parts?.[0]?.text || '';
        if (gemini[2] === 'countTokens') return res.end(JSON.stringify({ totalTokens: Math.ceil(prompt.length / 4) }));
        return respondAI(res, 'gemini', prompt);
      }
      res.writeHead(404).end('Not found');
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise(resolve => server.listen(port, resolve));
  const actualPort = server.address().port;
  return {
    url: `http://localhost:${actualPort}`,
    port: actualPort,
    state,
    setMode(mode, delayMs) { state.mode = mode; if (delayMs != null) state.delayMs = delayMs; if (mode !== 'hang') for (const r of hanging) r.destroy(); },
    close() { for (const r of hanging) r.destroy(); server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mock = await startMockServer(Number(process.argv[2]) || 1235);
  console.log(`Test page:      ${mock.url}/`);
  console.log(`Mock LM Studio: ${mock.url}  (Settings → Provider: LM Studio, Server URL: ${mock.url})`);
  console.log('Switch failure modes from the test page, or POST /__mock {"mode":"slow","delayMs":5000}.');
}

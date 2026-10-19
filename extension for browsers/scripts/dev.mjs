import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = new Set(['background.js', 'constants.js', 'model-limits.js', 'content.js', 'popup.js', 'popup.html', 'popup.css']);
let timer;
let queue = Promise.resolve();
function sync() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    queue = queue.then(() => import(`./sync-public.mjs?revision=${Date.now()}`)).catch(console.error);
  }, 100);
}
const watchers = [
  watch(root, (_, file) => { if (files.has(String(file))) sync(); }),
  watch(resolve(root, 'icons'), sync),
];
const child = spawn(process.execPath, [resolve(root, 'node_modules/wxt/bin/wxt.mjs'), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
child.on('exit', code => {
  watchers.forEach(watcher => watcher.close());
  clearTimeout(timer);
  process.exitCode = code || 0;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'public'), { recursive: true });
for (const file of ['constants.js', 'model-limits.js', 'content.js', 'popup.js', 'popup.html', 'popup.css']) {
  await copyFile(resolve(root, file), resolve(root, 'public', file));
}
const background = await readFile(resolve(root, 'background.js'), 'utf8');
await writeFile(resolve(root, 'public/legacy-background.js'), background.replace(/^\s*importScripts\([^;]+\);\s*/, ''));
for (const size of [16, 48, 128]) {
  await mkdir(resolve(root, 'public/icons'), { recursive: true });
  await copyFile(resolve(root, `icons/icon${size}.png`), resolve(root, `public/icons/icon${size}.png`));
}

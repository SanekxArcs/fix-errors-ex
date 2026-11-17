// Builds the finished promo videos. Run after npm run build (or use npm run promo:build):
//   node tests/promo/build.mjs [--lang en ...] [--skip-capture] [--formats 16x9,9x16]
// For each language: capture.mjs → prepare.mjs → render.mjs per format → audio.py → ffmpeg mux.
// Output: <repo>/.artifacts/promo/out/<lang>/fix-errors-ai-promo-<lang>-<format>.mp4, copied to
// <repo>/Fix Errors AI promo/. Needs ffmpeg and Python 3 with numpy on PATH.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { extRoot, repoRoot } from '../store/harness.mjs';
import { LANGS } from '../store/store-i18n.mjs';

const args = process.argv.slice(2);
const langs = args.flatMap((a, i) => (args[i - 1] === '--lang' ? [a] : []));
const fi = args.indexOf('--formats');
const formats = fi >= 0 ? args[fi + 1].split(',') : ['16x9', '9x16'];
const skipCapture = args.includes('--skip-capture');
const finals = path.join(repoRoot, 'Fix Errors AI promo');

const run = (cmd, argv) => {
  console.log(`> ${cmd} ${argv.join(' ')}`);
  const r = spawnSync(cmd, argv, { cwd: extRoot, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status ?? r.error}`);
};
const python = process.platform === 'win32' ? 'python' : 'python3';

for (const lang of langs.length ? langs : LANGS) {
  const out = path.join(repoRoot, '.artifacts/promo/out', lang);
  if (!skipCapture) run(process.execPath, ['tests/promo/capture.mjs', '--lang', lang]);
  run(process.execPath, ['tests/promo/prepare.mjs', '--lang', lang]);
  for (const format of formats) {
    run(process.execPath, ['tests/promo/render.mjs', format, '--lang', lang]);
    const wav = path.join(out, `${format}-audio.wav`);
    run(python, ['tests/promo/audio.py', path.join(out, `cues-${format}.json`), wav]);
    const file = path.join(out, `fix-errors-ai-promo-${lang}-${format}.mp4`);
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', path.join(out, `${format}-video.mp4`), '-i', wav,
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart',
      file,
    ]);
    mkdirSync(finals, { recursive: true });
    copyFileSync(file, path.join(finals, path.basename(file)));
    console.log(`final → ${path.join(finals, path.basename(file))}`);
  }
}

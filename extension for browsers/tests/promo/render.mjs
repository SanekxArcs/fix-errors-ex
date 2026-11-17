// Renders the promo composition frame by frame:
//   node tests/promo/render.mjs 16x9|9x16 [--lang en] [--fps 60] [--stills 1,4.5,9] [--from 0 --to 10]
// Video goes to <repo>/.artifacts/promo/out/<lang>/<format>-video.mp4, sound cues to cues-<format>.json.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchPlain, extRoot, repoRoot } from '../store/harness.mjs';
import { parseLang } from '../store/store-i18n.mjs';

const args = process.argv.slice(2);
const lang = parseLang(args);
const outDir = path.join(repoRoot, '.artifacts/promo/out', lang);
await mkdir(outDir, { recursive: true });
const format = args[0] === '9x16' ? '9x16' : '16x9';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const fps = Number(opt('fps', 60));
const stills = opt('stills', null);
const [W, H] = format === '9x16' ? [1080, 1920] : [1920, 1080];

const browser = await launchPlain({ args: ['--allow-file-access-from-files'] });
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${pathToFileURL(path.join(extRoot, 'tests/promo/comp.html')).href}?format=${format}&lang=${lang}`);
  await page.evaluate(() => window.READY);
  const duration = await page.evaluate(() => window.DURATION);
  const cdp = await ctx.newCDPSession(page);
  const grab = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data, 'base64');
  console.log(`${format}: ${duration.toFixed(2)}s`);

  if (stills) {
    const dir = path.join(outDir, `stills-${format}`);
    await mkdir(dir, { recursive: true });
    for (const t of stills.split(',').map(Number)) {
      await page.evaluate((t) => window.renderFrame(t), t);
      await writeFile(path.join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`), await grab());
    }
    console.log(`stills → ${dir}`);
  } else {
    await writeFile(
      path.join(outDir, `cues-${format}.json`),
      JSON.stringify(await page.evaluate(() => ({ duration: window.DURATION, cues: window.CUES, music: window.MUSIC })), null, 1),
    );
    const from = Number(opt('from', 0));
    const to = Math.min(duration, Number(opt('to', duration)));
    const file = path.join(outDir, `${format}-video.mp4`);
    const ff = spawn(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-movflags', '+faststart', file,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const done = new Promise((r) => ff.on('close', r));
    const total = Math.round((to - from) * fps);
    const t0 = Date.now();
    for (let f = 0; f < total; f++) {
      await page.evaluate((t) => window.renderFrame(t), from + f / fps);
      const buf = await grab();
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 300 === 0) console.log(`${format} frame ${f}/${total}  ${(f / Math.max((Date.now() - t0) / 1000, 0.001)).toFixed(1)} fps`);
    }
    ff.stdin.end();
    await done;
    console.log(`video → ${file} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
} finally {
  await browser.close();
}

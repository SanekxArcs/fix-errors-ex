// Turns the variable-rate screencast from capture.mjs into constant-rate clips for the composition:
//   node tests/promo/prepare.mjs [--lang en]
// Writes <repo>/.artifacts/promo/<lang>/clips.js (window.CLIPS) with per-clip frame lists and input events.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, LOGO, LOGO_SMALL } from '../store/harness.mjs';
import { parseLang } from '../store/store-i18n.mjs';

const dir = path.join(repoRoot, '.artifacts/promo', parseLang());
const m = JSON.parse(await readFile(path.join(dir, 'raw/manifest.json'), 'utf8'));
const FPS = 30;
const frames = m.frames;
if (!frames.length) throw new Error('no frames');

// Screencast timestamps and Date.now() share the epoch clock; report drift so a mismatch shows up.
console.log(`frames ${frames.length}, first ${frames[0].t.toFixed(3)}, first event ${m.events[0]?.t.toFixed(3)}`);

const clips = {};
for (const c of m.clips) {
  if (c.failed) console.log(`warning: clip ${c.name} failed during capture`);
  const dur = c.end - c.start;
  const list = [];
  let j = 0;
  for (let i = 0; i * (1 / FPS) <= dur; i++) {
    const t = c.start + i / FPS;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
    list.push(frames[j].file);
  }
  const before = m.events.filter((e) => e.t < c.start).at(-1);
  const events = m.events
    .filter((e) => e.t >= c.start && e.t <= c.end)
    .map((e) => ({ ...e, t: +(e.t - c.start).toFixed(4), x: +e.x.toFixed(2), y: +e.y.toFixed(2) }));
  clips[c.name] = {
    dur: +dur.toFixed(3),
    fps: FPS,
    frames: list,
    cursorStart: events[0] ? { x: events[0].x, y: events[0].y } : before ? { x: before.x, y: before.y } : { x: 700, y: 500 },
    events,
    marks: c.marks.map((k) => ({ label: k.label, t: +(k.t - c.start).toFixed(3) })),
  };
  console.log(`${c.name.padEnd(9)} ${dur.toFixed(2)}s  ${list.length} frames  ${c.marks.map((k) => `${k.label}@${(k.t - c.start).toFixed(2)}`).join(' ')}`);
}
await writeFile(path.join(dir, 'clips.js'), `window.CLIPS = ${JSON.stringify(clips)};\nwindow.VIEW = ${JSON.stringify(m.view)};\n` +
  `window.LOGO = ${JSON.stringify({ full: pathToFileURL(LOGO).href, small: pathToFileURL(LOGO_SMALL).href })};\n`);
console.log('wrote clips.js');

// Composes the Chrome Web Store images from .artifacts/store-raw/<lang> (see store-assets.mjs):
//   node tests/store/store-compose.mjs [--lang en]   (default: every captured language)
// Writes screenshots (1280x800) and promo tiles (440x280, 1400x560) to
// docs/chrome-web-store/assets/<lang>/ and the 128x128 store icon to docs/chrome-web-store/assets/.
// Colours come from the extension itself: popup.css :root and the UI object in content.js.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchPlain, repoRoot, LOGO, LOGO_SMALL } from './harness.mjs';
import { LANGS } from './store-i18n.mjs';
import { COPY } from './store-copy.mjs';

const assets = path.join(repoRoot, 'docs/chrome-web-store/assets');
let lang = 'en';
const raw = (f) => pathToFileURL(path.join(repoRoot, '.artifacts/store-raw', lang, f)).href;
const logoUrl = pathToFileURL(LOGO).href;
const logoSmallUrl = pathToFileURL(LOGO_SMALL).href;
await mkdir(assets, { recursive: true });

// The logo (harness.mjs LOGO) fills its square canvas, so it is simply scaled; small sizes use LOGO_SMALL.
const icon = (size, style = '') =>
  `<span class="icon" style="width:${size}px;height:${size}px;${style}"><img src="${size <= 32 ? logoSmallUrl : logoUrl}" style="width:${size}px;height:${size}px;left:0;top:0"></span>`;

// Extension tokens: UI.bg #181f2a, UI.field #10151e, UI.fg #e8ebf3, UI.mutedFg #97a1af, UI.border #303b4a,
// UI.primary #b3c8ff, UI.success #76cb9a; popup --background hsl(218 31% 9%).
const base = `
*{box-sizing:border-box;margin:0}
html,body{width:100%;height:100%}
body{font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;color:#e8ebf3;overflow:hidden;position:relative;
  background:radial-gradient(1100px 700px at 88% -12%,#2c3e6e 0%,transparent 62%),
             radial-gradient(900px 600px at -10% 112%,#1d2a47 0%,transparent 60%),#0a1121}
.grid{position:absolute;inset:0;background-image:linear-gradient(#ffffff07 1px,transparent 1px),linear-gradient(90deg,#ffffff07 1px,transparent 1px);background-size:40px 40px;mask-image:radial-gradient(circle at 70% 40%,#000 0%,transparent 75%)}
.icon{position:relative;display:inline-block;overflow:hidden;flex:none}
.icon img{position:absolute;max-width:none;filter:drop-shadow(0 0 1px #b3c8ff40) drop-shadow(0 8px 22px #000a)}
.icon{overflow:visible!important}
.copy{position:absolute;left:68px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:440px}
.brand{display:flex;align-items:center;gap:14px;font-weight:700;font-size:22px;letter-spacing:-.01em;color:#dfe6fb}
.eyebrow{font-size:14px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#b3c8ff;margin-bottom:18px}
h1{font-size:var(--h1,52px);text-wrap:balance;line-height:1.06;letter-spacing:-.03em;font-weight:800;margin:0 0 22px}
h1 em{font-style:normal;color:#b3c8ff}
p.lead{font-size:19px;line-height:1.5;color:#aab4c4;margin-bottom:28px}
ul{list-style:none;padding:0;display:grid;gap:12px}
li{font-size:17.5px;color:#dce2ee;display:flex;gap:12px;align-items:flex-start;line-height:1.4}
li::before{content:"";flex:none;width:22px;height:22px;margin-top:1px;border-radius:7px;background:#76cb9a url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23142a1d' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E") center/15px no-repeat}
.win{position:absolute;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px #ffffff26,0 30px 80px #000a,0 8px 24px #0007}
.win .bar{height:34px;background:#e9ecf2;display:flex;align-items:center;gap:7px;padding:0 14px;border-bottom:1px solid #d9dde5}
.win .bar i{width:11px;height:11px;border-radius:50%;background:#c9ced8;display:block}
.win .bar b{margin-left:14px;height:20px;flex:1;max-width:58%;border-radius:6px;background:#f7f8fb;border:1px solid #dde1e8}
.win img{display:block}
.panel{position:absolute;border-radius:12px;overflow:hidden;box-shadow:0 0 0 1px #ffffff1f,0 30px 80px #000b,0 8px 24px #0007;background:#181f2a}
.panel img{display:block}
.crop{position:absolute;overflow:hidden}
.crop img{position:absolute;max-width:none}
.result{position:absolute;z-index:3;background:#fff;border-radius:14px;padding:16px 20px 14px;box-shadow:0 0 0 1px #ffffff26,0 30px 80px #000a,0 8px 24px #0007}
.result .tag{position:static;margin-bottom:10px;box-shadow:none}
.toast{position:absolute;z-index:4;border-radius:12px;overflow:hidden;box-shadow:0 18px 40px #000a}
.toast img{display:block}
.tag{position:absolute;display:inline-flex;align-items:center;gap:8px;padding:7px 13px;border-radius:999px;background:#181f2a;border:1px solid #303b4a;color:#e8ebf3;font-size:14px;font-weight:600;box-shadow:0 8px 20px #0007}
.tag::before{content:"";width:8px;height:8px;border-radius:50%;background:#76cb9a}
`;

const page = (body, extra = '') =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${base}${extra}</style></head><body><div class="grid"></div>${body}</body></html>`;
const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const copy = (c, { width, brand, top } = {}) => `
  <div class="copy"${width || top ? ` style="${width ? `width:${width}px;` : ''}${top ? `justify-content:flex-start;top:${top}px` : ''}"` : ''}>
    ${brand ? `<div class="brand" style="margin-bottom:34px">${icon(48)}Fix Errors AI</div>` : ''}
    <div class="eyebrow">${c.eyebrow}</div>
    <h1>${c.h1}</h1>
    <p class="lead">${c.lead}</p>
    ${c.items ? list(c.items) : ''}
  </div>`;

// Raw page captures are 860x600 CSS px at 2x; shown inside a minimal browser frame.
const PAGE = { w: 860, h: 600 };
const win = (file, x, y, width, { rot = 0, dim = 1, z = 1 } = {}) => {
  const h = Math.round((PAGE.h / PAGE.w) * width);
  return `<div class="win" style="left:${x}px;top:${y}px;width:${width}px;z-index:${z};transform:rotate(${rot}deg);filter:brightness(${dim})"><div class="bar"><i></i><i></i><i></i><b></b></div><img src="${raw(file)}" style="width:${width}px;height:${h}px"></div>`;
};
const panel = (file, x, y, w, h, { rot = 0, dim = 1, z = 2, scale = 1 } = {}) =>
  `<div class="panel" style="left:${x}px;top:${y}px;width:${w * scale}px;height:${h * scale}px;z-index:${z};transform:rotate(${rot}deg);filter:brightness(${dim})"><img src="${raw(file)}" style="width:${w * scale}px;height:${h * scale}px"></div>`;
/** Shows the CSS-px rectangle {x,y,w,h} of a raw capture (natural size nw x nh CSS px) at scale s. */
const crop = (file, nw, nh, r, left, top, s, style = '') =>
  `<div class="crop" style="left:${left}px;top:${top}px;width:${r.w * s}px;height:${r.h * s}px;${style}"><img src="${raw(file)}" style="width:${nw * s}px;height:${nh * s}px;left:${-r.x * s}px;top:${-r.y * s}px"></div>`;

/** A white card holding a crop of the field after the action ran, with a caption pill. */
const resultCard = (file, r, left, top, s, tag) =>
  `<div class="result" style="left:${left}px;top:${top}px"><div class="tag">${tag}</div>
    <div class="crop" style="position:relative;width:${r.w * s}px;height:${r.h * s}px"><img src="${raw(file)}" style="width:${PAGE.w * s}px;height:${PAGE.h * s}px;left:${-r.x * s}px;top:${-r.y * s}px"></div></div>`;
const REVIEW = { w: 340, h: 531 };
const POPUP = { w: 400, h: 581 };

const build = (C) => {
  const shots = [
    ['01-fix-in-place.png', page(`
      ${copy(C.fix, { brand: true })}
      ${win('mail-menu.png', 548, 56, 680, { z: 1 })}
      ${resultCard('mail-done.png', { x: 226, y: 218, w: 600, h: 58 }, 596, 562, 0.9, C.fix.result)}
      <div class="toast" style="left:1124px;top:660px"><img src="${raw('toast-done.png')}" style="width:86px;height:41px"></div>
    `)],
    ['02-review-before-applying.png', page(`
      ${copy(C.review)}
      ${win('review-page.png', 560, 120, 600, { rot: -4, dim: 0.5 })}
      ${panel('review-toneFormal.png', 790, 68, REVIEW.w, REVIEW.h, { scale: 1.25, z: 3 })}
    `, '.copy{width:420px}')],
    ['03-reply-assist.png', page(`
      ${copy(C.reply)}
      ${win('chat-assist.png', 548, 56, 680, { z: 1 })}
      ${resultCard('chat-done.png', { x: 222, y: 464, w: 600, h: 54 }, 596, 562, 0.9, C.reply.result)}
    `)],
    ['04-tone-and-translate.png', page(`
      <div class="copy" style="left:0;right:0;width:auto;top:74px;bottom:auto;align-items:center;text-align:center">
        <div class="eyebrow">${C.tone.eyebrow}</div>
        <h1 style="margin-bottom:16px">${C.tone.h1}</h1>
        <p class="lead" style="max-width:760px;margin:0">${C.tone.lead}</p>
      </div>
      ${['toneFormal', 'toneEmojis', 'translateUkrainian'].map((a, i) => `
        <div class="panel" style="left:${92 + i * 376}px;top:${326 + (i === 1 ? -14 : 0)}px;width:${REVIEW.w}px;height:384px;z-index:${i === 1 ? 3 : 2}">
          ${crop(`review-${a}.png`, REVIEW.w, REVIEW.h, { x: 0, y: 0, w: REVIEW.w, h: 384 }, 0, 0, 1)}
        </div>`).join('')}
    `)],
    ['05-your-ai-your-device.png', page(`
      ${copy(C.yours, { width: 410 })}
      ${panel('popup-prompts.png', 548, 128, POPUP.w, POPUP.h, { rot: -7, scale: 0.86, dim: 0.5, z: 1 })}
      ${panel('popup-settings.png', 676, 104, POPUP.w, POPUP.h, { rot: -3, scale: 0.93, dim: 0.75, z: 2 })}
      ${panel('popup-history.png', 822, 94, POPUP.w, POPUP.h, { z: 3 })}
    `)],
  ];

  const promoSmall = page(`
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 30px">
      ${icon(64, 'margin-bottom:14px')}
      <div style="font-size:32px;font-weight:800;letter-spacing:-.03em;line-height:1.05">Fix Errors<br>AI</div>
      <div style="font-size:14.5px;color:#b3c8ff;margin-top:10px;font-weight:600;line-height:1.4">${C.small}</div>
    </div>
    <div class="panel" style="left:236px;top:30px;width:${REVIEW.w}px;height:${REVIEW.h}px;transform:rotate(7deg) scale(.6);transform-origin:top left">
      <img src="${raw('review-translateUkrainian.png')}" style="width:${REVIEW.w}px;height:${REVIEW.h}px">
    </div>`,
  'body{background:radial-gradient(400px 300px at 100% 0%,#34508f 0%,transparent 70%),#0a1121}');

  const marquee = page(`
    <div class="copy" style="left:84px;width:600px">
      <div class="brand" style="margin-bottom:28px;font-size:26px">${icon(60)}Fix Errors AI</div>
      <h1 style="font-size:52px">${C.marquee.h1}</h1>
      <p class="lead" style="margin:0">${C.marquee.lead}</p>
    </div>
    ${win('mail-menu.png', 720, 70, 560, { rot: -5, dim: 0.55 })}
    ${panel('review-toneFormal.png', 1040, 36, REVIEW.w, REVIEW.h, { scale: 0.92, z: 3 })}`);
  return { shots, promoSmall, marquee };
};

const storeIcon = `<!doctype html><html><head><style>*{margin:0}html,body{width:128px;height:128px;background:transparent}.icon{position:absolute;overflow:hidden}.icon img{position:absolute;max-width:none}</style></head>
<body>${icon(96, 'left:16px;top:16px')}</body></html>`;

const browser = await launchPlain();
// file:// images need a file:// document, so each page is written next to its output first.
const html = async (dir, name, content, w, h, opts) => {
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${name}.html`);
  await writeFile(tmp, content);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(tmp).href);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  const overflow = await p.evaluate(() =>
    [...document.querySelectorAll('h1,p,li,.brand,.tag')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().bottom > innerHeight)
      .map((e) => e.textContent.trim().slice(0, 40)),
  );
  if (overflow.length) console.warn(`  overflow in ${name}:`, overflow);
  await p.screenshot({ path: path.join(dir, name), omitBackground: opts?.transparent });
  await ctx.close();
  await rm(tmp);
  console.log(`wrote ${path.relative(assets, path.join(dir, name))} (${w}x${h})`);
};

const args = process.argv.slice(2);
const requested = args.flatMap((a, i) => (args[i - 1] === '--lang' ? [a] : []));
const langs = (requested.length ? requested : LANGS).filter((l) => {
  const ok = existsSync(path.join(repoRoot, '.artifacts/store-raw', l, 'mail-menu.png'));
  if (!ok) console.warn(`skip ${l}: run node tests/store/store-assets.mjs --lang ${l} first`);
  return ok;
});
try {
  for (lang of langs) {
    const dir = path.join(assets, lang);
    const { shots, promoSmall, marquee } = build(COPY[lang]);
    for (const [name, content] of shots) await html(dir, `screenshot-${name}`, content, 1280, 800);
    await html(dir, 'promo-small-440x280.png', promoSmall, 440, 280);
    await html(dir, 'promo-marquee-1400x560.png', marquee, 1400, 560);
  }
  await html(assets, 'store-icon-128.png', storeIcon, 128, 128, { transparent: true });
} finally {
  await browser.close();
}

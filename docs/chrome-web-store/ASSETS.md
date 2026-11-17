# Chrome Web Store assets

Every image and video below is generated from the **built** extension running in a fresh Chromium
profile against a local demo server (canned AI answers, demo data only). Nothing is hand-edited.

## Dashboard field → file

| Dashboard field | File | Size |
| --- | --- | --- |
| Store icon | `assets/store-icon-128.png` | 128×128 PNG (96×96 artwork from `brand/logo-1024.png` + 16 px transparent padding) |
| Screenshot 1 | `assets/en/screenshot-01-fix-in-place.png` | 1280×800 PNG |
| Screenshot 2 | `assets/en/screenshot-02-review-before-applying.png` | 1280×800 PNG |
| Screenshot 3 | `assets/en/screenshot-03-reply-assist.png` | 1280×800 PNG |
| Screenshot 4 | `assets/en/screenshot-04-tone-and-translate.png` | 1280×800 PNG |
| Screenshot 5 | `assets/en/screenshot-05-your-ai-your-device.png` | 1280×800 PNG |
| Small promo tile | `assets/en/promo-small-440x280.png` | 440×280 PNG |
| Marquee promo tile | `assets/en/promo-marquee-1400x560.png` | 1400×560 PNG |
| Promo video (YouTube URL field) | `Fix Errors AI promo/fix-errors-ai-promo-en-16x9.mp4` (repo root) | 1920×1080, 60 fps, H.264 + AAC, about 62 s |
| (Shorts / social, not a store field) | `Fix Errors AI promo/fix-errors-ai-promo-en-9x16.mp4` | 1080×1920, 60 fps, about 62 s |

The store only takes a YouTube link for the video: upload the 16x9 file to YouTube and paste the URL.
YouTube titles, descriptions, chapters and tags for both videos are in `youtube-en.md`.

## Logo (single input)

Every generated image and the video take the logo from one place: `LOGO` (and `LOGO_SMALL`, used at
32 px and below) in `extension for browsers/tests/store/harness.mjs`, which point at
`brand/logo-1024.png` and `brand/logo-small-1024.png`. To change the logo, replace those PNGs (square,
artwork filling the canvas, transparent corners) or change the two paths, then run
`npm run store:assets` and `npm run promo:build`. Footage and screenshots also show the real extension
icons from `extension for browsers/icons/` (popup header, context menu), so update those too and
rebuild.

## Regenerate

From `extension for browsers/`:

```sh
npm run store:assets            # build → capture raw UI (.artifacts/store-raw/en) → compose images into docs/chrome-web-store/assets
npm run store:capture           # raw captures only (needs a fresh `npm run build`)
npm run store:compose           # re-compose images from existing raw captures

npm run promo:build             # build → capture → prepare → render 16x9 + 9x16 → audio → mux → copy to "Fix Errors AI promo/"
node tests/promo/build.mjs --skip-capture             # re-render from the existing footage
node tests/promo/build.mjs --skip-capture --formats 16x9
node tests/promo/render.mjs 16x9 --stills 8,20,33     # still frames to .artifacts/promo/out/en/stills-16x9
```

Requirements: the `playwright-core` dev dependency plus a Playwright Chromium build
(`npx playwright-core install chromium`, or set `CHROME_PATH`); for the video also `ffmpeg` and
Python 3 with `numpy` on `PATH`. Intermediates go to `<repo>/.artifacts/` (git-ignored). Every
script starts its own demo server and browser and shuts both down when it ends.

Languages: `--lang en` (default). Add a language by adding a block to `DEMO` in
`tests/store/store-i18n.mjs`, `COPY` in `tests/store/store-copy.mjs` and `PROMO_TEXT` in
`tests/promo/comp-text.js`.

## What is real and what is composed

- **Real UI** from the built extension: the progress and done toasts, the Review panel (all action
  results), the Reply Assist panel, the keyboard-layout fix, the in-place text replacement and the
  popup (Settings, History, Prompts, Shortcuts). Menu clicks and shortcuts go through the same
  worker functions Chrome calls (`handleContextMenuClick`, `handleCommand`).
- **Demo pages** (`tests/store/demo-page.html`): a generic mail composer and chat app.
- **Recreated**: the right-click menu (Chrome's native menu cannot be captured). It is HTML built from
  the real `createContextMenus()` tree in `background.js`, so titles and order match.
- **Composed**: browser frames, captions, result cards, the key-press badges and the cursor in the
  video (drawn from the logged real mouse path), backgrounds, intro/outro and the synthesized
  soundtrack (no samples, no voice).
- In the video the popup is shown in a tab with a test-side stylesheet that centres it on a dark
  backdrop; the popup itself is unchanged. The video skips the Shortcuts tab: in a fresh Chromium
  profile Chrome does not assign the suggested Alt+Shift+A / Alt+Shift+R keys (the tab shows
  "Not set"), so the video invokes those commands through `handleCommand` and draws the keys as badges.

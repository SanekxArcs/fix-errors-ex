# Fix Errors AI

Select text anywhere, pick an action, and get the improved version back in place —
grammar fixes, tone changes, translations, formatting, or a drafted reply.

This repository holds two independent applications that share the same idea, the same
action set, and the same "bring your own AI" model:

| | What it is | Where it runs |
|---|---|---|
| [`extension for browsers/`](extension%20for%20browsers/) | Chrome/Edge extension (Manifest V3) | Any website, via right-click or a keyboard shortcut |
| [`desktop-app/`](desktop-app/) | Electron app for Windows | Anywhere, via a global hotkey or a Compose window |

Neither depends on the other. You can install either one, or both side by side.

## Bring your own AI

There is no hosted service behind this project and no AI costs bundled into it. You
point it at a provider you control:

- **Google Gemini** — your own free or paid API key.
- **LM Studio** — a local server on your own machine, for fully offline processing.

Your API key, settings, prompts and history stay on your device. Selected text goes
only to the provider you configured, and nowhere else.

## What it can do

Both apps expose the same actions:

- Fix spelling & grammar
- Add polish — more professional, more eloquent
- Change tone → Formal, Casual, Empathetic, or add emojis
- Rewrite as an official business email
- Make shorter / make longer
- Translate → Polish, Ukrainian, English (US)
- Format as Markdown or as a Slack message
- Fix keyboard layout mix-ups (Ukrainian ↔ English) — done locally, no AI call
- **Reply Assist** — draft a reply that matches the tone of the conversation
- **Custom AI Prompt** — use the selection as a one-off prompt

Every action's system prompt is editable in the Prompts tab, and you can set a
fallback Gemini model for when your primary one is at capacity.

---

## Browser extension

### Install from source

1. Open `chrome://extensions/` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension for browsers/` folder.
3. Open the extension popup and paste your Gemini API key
   ([get one here](https://aistudio.google.com/apikey)), or switch the provider to
   LM Studio and enter your server URL.

No build step — the extension is plain HTML, CSS and JavaScript.

### Using it

Select text in any input, textarea or editable area, then either:

- right-click → **AI Text Tools** → pick an action, or
- press a keyboard shortcut:

  | Shortcut | Action |
  |---|---|
  | `Alt+Shift+F` | Fix spelling & grammar |
  | `Alt+Shift+G` | Fix grammar on a manual selection only |
  | `Alt+Shift+A` | Use the selection as a custom AI prompt |

  Rebind them at `chrome://extensions/shortcuts`.

The result replaces your selection in place. A toast in the bottom-right corner shows
progress and lets you cancel a running request or retry with a different model.

### Cancelling a request

Press `Alt+Shift+Esc` while a request is running — or click the ✕ on the toast — to
abort it. Your text is left exactly as you wrote it; nothing is replaced and nothing is
added to history.

Unlike the three shortcuts above, this one is not registered through
`chrome.commands`, because Chrome reserves `Esc` and will not bind it. It is handled by
the content script instead, which has two consequences: it only fires while the page
itself has focus (not while you are typing in the address bar or another window), and
it does not appear on the `chrome://extensions/shortcuts` page, so it cannot be
rebound there.

### Layout

```
extension for browsers/
  manifest.json     — MV3 manifest: permissions, commands, icons
  background.js     — Service worker: context menus, shortcuts, provider API calls
  content.js        — Injected on demand: selection handling, text replacement, toast + panels
  constants.js      — Shared defaults: prompts, action labels, Gemini model list
  popup.html/.js    — Popup: Settings / History / Prompts / Shortcuts tabs
  popup.css         — shadcn/ui-style design tokens and component classes
  store/            — Chrome Web Store listing copy, privacy policy, permission rationale
  zip-extension.sh  — Builds the upload package
landing-page/       — Public site + hosted privacy policy (GitHub Pages)
```

Settings and prompts save automatically as you edit them; history keeps the last 50
edits plus all-time totals, and can be cleared from the History tab.

There is no content script registered on `<all_urls>`. Nothing runs on a page at load
time — `content.js` is injected into a single tab via `activeTab` + `chrome.scripting`
only at the moment you trigger an action there.

### Publishing to the Chrome Web Store

```sh
cd "extension for browsers"
bash zip-extension.sh        # → fix-errors-ai-v<version>.zip
```

The version comes from `manifest.json`; bump it before every upload, since the Web
Store rejects a package that is not newer than the published one. `store/` and the
script itself are excluded from the archive.

Listing copy, the privacy policy text and the per-permission justifications live in
[`extension for browsers/store/`](extension%20for%20browsers/store/) — start with
`STORE_LISTING.md`, which has the submission checklist.

The privacy policy must be reachable at a public URL before submitting. Enable GitHub
Pages for this repo (Settings → Pages → deploy from `main`, root) and the hosted copy
in [`landing-page/`](landing-page/) becomes available at
`https://sanekxarcs.github.io/fix-errors-ex/landing-page/privacy.html`.

---

## Desktop app

```sh
cd desktop-app
npm install
npm start          # run in development
npm run build      # produce an NSIS installer under dist/
```

Building the Windows installer is simplest on Windows; cross-building from Linux or
macOS needs Wine. See [`desktop-app/README.md`](desktop-app/README.md) for the tray
behaviour, the startup toggle, and per-action global shortcuts.

---

## Privacy

- Settings, prompts and history live on your device only — `chrome.storage.local` in
  the extension, `electron-store` in the desktop app.
- Text you act on is sent only to the provider you configured: Google Gemini, or your
  own LM Studio server.
- Nothing is collected, sold or shared. There are no servers in this project.

Full text: [`extension for browsers/store/PRIVACY_POLICY.md`](extension%20for%20browsers/store/PRIVACY_POLICY.md).

## Notes for contributors

- The Gemini model list and default prompts are duplicated in
  `extension for browsers/constants.js` and `desktop-app/shared/constants.js`. Update
  both when you change one.
- `.github/copilot-instructions.md` documents the architecture and data flow in more
  detail than this file.

# Fix Errors AI

Select text anywhere, pick an action, and get the improved version back in place —
grammar fixes, tone changes, translations, formatting, or a drafted reply.

This repository holds two independent applications that share the same idea, the same
action set, and the same "bring your own AI" model:

| | What it is | Where it runs |
|---|---|---|
| [`extension for browsers/`](extension%20for%20browsers/) | WXT-powered Chrome/Edge extension (Manifest V3) | Any website, via right-click or a keyboard shortcut |
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
fallback provider and model for when your primary one fails or reaches its budget.
Gemini can fall back to LM Studio, and LM Studio can fall back to Gemini or another
configured local model. Fallback server/model settings are separate from primary
settings. Existing saved Gemini fallbacks are preserved when upgrading.

---

## Browser extension

### Install from source

1. In `extension for browsers/`, run `npm install` and `npm run build`.
2. Open `chrome://extensions/` and turn on **Developer mode**.
3. Click **Load unpacked** and select `extension for browsers/.output/chrome-mv3`.
4. Open the extension popup and paste your Gemini API key
   ([get one here](https://aistudio.google.com/apikey)), or switch the provider to
   LM Studio and enter your server URL.

After rebuilding, click **Reload** on the extension card and refresh any page where
you want to use it. Confirm `Alt+Shift+G` is assigned at
`chrome://extensions/shortcuts`.

The browser extension is bundled with WXT. Edit the source files in
`extension for browsers/`; the build and ZIP commands synchronize them into
`public/` automatically. `npm run dev` also watches these source files and keeps
the packaged scripts current. WXT reads the extension metadata from the source
`manifest.json`.

### Using it

Select text in any input, textarea or editable area, then either:

- right-click → **AI Text Tools** → pick an action, or
- press a keyboard shortcut:

  | Shortcut | Action |
  |---|---|
  | `Alt+Shift+F` | Fix spelling & grammar immediately; uses the auto-select setting |
  | `Alt+Shift+G` | Fix only the manually selected text immediately |
  | `Alt+Shift+A` | Original Reply Assist flow with optional context |
  | `Alt+Shift+R` | Additional review panel, with or without selected text |

  Rebind them at `chrome://extensions/shortcuts`.

The original shortcuts and right-click writing actions keep their original
processing and replacement behavior. The additional review panel opens with
`Alt+Shift+R` or **AI Text Tools → Review before applying…**. It shows your text
and an editable result before anything is applied. With no selection, it still
opens so you can type or paste text. Choose **Done & copy** to copy the result
and replace the selected text or insert it at the focused editor's cursor.

### Cancelling a request

Press `Alt+Shift+Esc` while a request is running — or click the ✕ on the toast — to
abort it. Your text is left exactly as you wrote it; nothing is replaced and nothing is
added to history.

Unlike the four shortcuts above, this one is not registered through
`chrome.commands`, because Chrome reserves `Esc` and will not bind it. It is handled by
the content script instead, which has two consequences: it only fires while the page
itself has focus (not while you are typing in the address bar or another window), and
it does not appear on the `chrome://extensions/shortcuts` page, so it cannot be
rebound there.

### Layout

```
extension for browsers/
  wxt.config.ts     — WXT-generated MV3 manifest and permissions
  entrypoints/      — WXT background worker
  public/           — Settings popup, content script, icons, shared prompts and provider logic
  store/            — Chrome Web Store listing copy, privacy policy, permission rationale
  zip-extension.sh  — Builds the upload package
landing-page/       — Public site + hosted privacy policy (GitHub Pages)
```

### Model limits

Settings → Model limits includes an **Enable custom budget limits** switch.
New setups work without manual budget configuration. Existing saved budgets
remain enabled when upgrading; turn the switch off to stop enforcing them.
Profiles and usage counters remain saved when disabled.

Gemini's input/output maximums load automatically with your API key. Google no
longer publishes a universal free-tier RPM/TPM/RPD table in its rate-limit docs;
your project's active rates are shown in
[Google AI Studio](https://aistudio.google.com/rate-limit?timeRange=last-28-days).
To enable personal budgets, copy those rates (or smaller caps) for each primary
and fallback model. Missing profiles block requests only while budgets are on.

When enabled, the extension enforces requests per minute/day, input tokens per minute, an
optional daily input-token cap, and per-request input/output caps. Gemini token
counts include the full prompt and any context. Gemini's actual input/output
maximums are fetched automatically and override larger personal caps. Local
models use a conservative text-size estimate; set their input cap below the
loaded context window, leaving room for output.

Reservations are saved before generation, so concurrent requests, retries,
worker restarts, and failed attempts cannot bypass the configured budgets.
Daily budgets reset at midnight Pacific time. Gemini's actual model token caps
and provider rate-limit cooldowns remain active even with custom budgets off.
Local models use their server's output defaults when budgets are off.

Usage covers this extension on this browser only. Google quotas are shared
across the project; calls from other apps or browsers are not visible here.
These settings do not impose an account-wide spending limit. If the provider
quota is unlimited, choose a personal cap.

Settings and prompts save automatically as you edit them; model limits use an
explicit Save button after all fields are valid. History keeps the last 50
edits plus all-time totals, and can be cleared from the History tab.

There is no content script registered on `<all_urls>`. Nothing runs on a page at load
time — `content.js` is injected into the active tab via `activeTab` + `chrome.scripting`
only when you trigger an action. The refine panel runs in an isolated shadow root on
that page, so the site's styles cannot leak into it.

### Publishing to the Chrome Web Store

```sh
cd "extension for browsers"
npm run zip                  # → WXT-built Chrome package
```

The version comes from `manifest.json`; bump it and the package version before every upload, since the Web
Store rejects a package that is not newer than the published one. `store/` and the
source files are excluded from the built archive.

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

<p align="center">
  <img src="extension%20for%20browsers/icons/icon128.png" width="96" alt="Fix Errors AI icon" />
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/transparent.svg?title=Fix+Errors+AI&subtitle=Select+text+anywhere.+Fix+it,+rewrite+it,+translate+it,+reply+to+it.&mode=dark&align=center" />
    <img alt="Fix Errors AI" src="https://shieldcn.dev/header/transparent.svg?title=Fix+Errors+AI&subtitle=Select+text+anywhere.+Fix+it,+rewrite+it,+translate+it,+reply+to+it.&mode=light&align=center" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/SanekxArcs/fix-errors-ex/stargazers"><img alt="GitHub stars" src="https://shieldcn.dev/github/stars/SanekxArcs/fix-errors-ex.svg?variant=secondary" /></a>
  <a href="https://github.com/SanekxArcs/fix-errors-ex/commits/main"><img alt="Last commit" src="https://shieldcn.dev/github/last-commit/SanekxArcs/fix-errors-ex.svg?variant=secondary" /></a>
  <img alt="Extension 2.0.13" src="https://shieldcn.dev/badge/extension-2.0.13-16A34A.svg?variant=secondary&logo=googlechrome" />
  <img alt="Desktop 1.2.0" src="https://shieldcn.dev/badge/desktop-1.2.0-0078D4.svg?variant=secondary&logo=electron" />
  <img alt="Bring your own AI" src="https://shieldcn.dev/badge/AI-bring%20your%20own-F59E0B.svg?variant=secondary&logo=googlegemini" />
  <img alt="No servers" src="https://shieldcn.dev/badge/servers-none-7C3AED.svg?variant=secondary&logo=shield" />
</p>

<p align="center">
  Highlight any text, press a shortcut or right-click, and the improved version lands back in place.<br/>
  Grammar, tone, translation, formatting, a drafted reply. Powered by <b>your</b> Gemini key or a local LM Studio model.
</p>

---

## Two apps, one idea

| | What it is | Where it works |
|---|---|---|
| [**Browser extension**](extension%20for%20browsers/) | Chrome and Edge, Manifest V3, built with WXT | Any website: inputs, textareas, rich editors |
| [**Desktop app**](desktop-app/) | Electron for Windows with a tray icon | Any application, through global hotkeys or a Compose window |

They share the same actions, the same prompts and the same "bring your own AI" model, and neither depends on the other. Install one or both.

## Why people like it

- **It edits in place.** The result replaces your selection right inside Gmail, Slack, Jira, Notion, a form, anything. No copy and paste round trip.
- **Your key, your data.** There is no service in the middle. Text goes straight from your browser to Google Gemini or to LM Studio on your own machine. Settings, prompts and history never leave the device.
- **Zero footprint until you ask.** No content script on every page. The extension injects itself into the active tab only when you trigger an action, inside an isolated shadow root.
- **Budget guard rails.** Optional per-minute and per-day limits on requests and tokens, reserved before each call, so retries and parallel requests cannot blow past your quota.
- **Fallback provider.** Gemini can fall back to LM Studio, and LM Studio to Gemini or another local model, when the primary fails or hits its budget.
- **Editable prompts.** Every action's system prompt is yours to change in the Prompts tab.
- **Review mode.** `Alt+Shift+R` opens a panel with your text and an editable result before anything is applied.

## What it can do

| Action | Result |
|---|---|
| Fix spelling and grammar | Corrected text, same language, same meaning |
| Add polish | More professional, more eloquent |
| Change tone | Formal, Casual, Empathetic, or with emojis |
| Official email | Rewritten as a business email |
| Shorter / longer | Condensed or expanded |
| Translate | Polish, Ukrainian, English (US) |
| Format | Markdown or a Slack message |
| Fix keyboard layout | Ukrainian and English layout mix-ups, done locally with no AI call |
| **Reply Assist** | Drafts a reply that matches the tone of the conversation |
| **Custom prompt** | Uses the selection as a one-off prompt |

## Quick start

### Browser extension

```sh
cd "extension for browsers"
npm install
npm run build
```

1. Open `chrome://extensions/`, turn on **Developer mode**, click **Load unpacked** and pick `extension for browsers/.output/chrome-mv3`.
2. Open the popup and paste a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey), or switch the provider to **LM Studio** and enter the server URL (default `http://localhost:1234`).
3. Confirm the shortcuts at `chrome://extensions/shortcuts`.

Select text on any page, then right-click → **AI Text Tools**, or press:

| Shortcut | Action |
|---|---|
| `Alt+Shift+F` | Fix spelling and grammar now, using the auto-select setting |
| `Alt+Shift+G` | Fix only the manually selected text now |
| `Alt+Shift+A` | Reply Assist with optional conversation context |
| `Alt+Shift+R` | Review panel: edit the result before applying |
| `Alt+Shift+Esc` | Cancel the running request; your text stays untouched |

### Desktop app

```sh
cd desktop-app
npm install
npm start          # development
npm run build      # NSIS installer under dist/
```

Paste into the Compose tab or run selected text through a global shortcut. Each action can have its own hotkey, the layout fixer defaults to `Shift+Alt+L`, and the app can start hidden in the tray with Windows. Details in [`desktop-app/README.md`](desktop-app/README.md).

## How it works

```
select text ──► background worker ──► Gemini API  or  LM Studio (localhost)
                      │                              │
                      ◄──────── result ──────────────┘
                      ▼
      content script replaces the selection, fires input/change events,
      shows a toast, saves the entry to local history (last 50)
```

Requests carry a 30-second timeout. The content script handles `<input>`, `<textarea>` and `contenteditable` editors and fires the events frameworks like React and Vue listen for, so the page sees the change as if you typed it.

<details>
<summary><b>Model limits and budgets</b></summary>

Settings → Model limits has an **Enable custom budget limits** switch. New setups work without it; existing saved budgets stay enabled after an upgrade.

Gemini's input and output maximums load automatically with your API key. Google no longer publishes a universal free-tier table, so copy your project's active rates from [Google AI Studio](https://aistudio.google.com/rate-limit?timeRange=last-28-days) into the primary and fallback model profiles, or set smaller personal caps.

When enabled, the extension enforces requests per minute and per day, input tokens per minute, an optional daily input-token cap, and per-request input and output caps. Reservations are saved before generation, so concurrent requests, retries, worker restarts and failed attempts cannot bypass them. Daily budgets reset at midnight Pacific time. Local models use a conservative text-size estimate; set their input cap below the loaded context window.

Usage covers this extension in this browser only. Google quotas are shared across the project, so calls from other apps are not visible here.

</details>

<details>
<summary><b>Why <code>Alt+Shift+Esc</code> is different</b></summary>

Chrome reserves `Esc` and will not bind it through `chrome.commands`, so the cancel shortcut is handled by the content script. It fires only while the page has focus, not from the address bar or another window, and it does not appear on the shortcuts page.

</details>

<details>
<summary><b>Repository layout</b></summary>

```
extension for browsers/
  wxt.config.ts       WXT-generated MV3 manifest and permissions
  entrypoints/        Background service worker
  public/             Popup, content script, icons, shared prompts and provider logic
  store/              Chrome Web Store listing, privacy policy, permission rationale
  test/               Mock AI server, test page and Playwright end-to-end run
  zip-extension.sh    Builds the upload package
desktop-app/
  main/ renderer/ shared/   Electron main process, UI, shared constants
landing-page/         Public site and hosted privacy policy for GitHub Pages
.github/copilot-instructions.md   Architecture and data flow in depth
```

</details>

<details>
<summary><b>Publishing to the Chrome Web Store</b></summary>

```sh
cd "extension for browsers"
npm run zip
```

The version comes from `manifest.json`; bump it and `package.json` before every upload, since the store rejects a package that is not newer than the published one. Listing copy, the privacy policy and the per-permission justifications live in [`extension for browsers/store/`](extension%20for%20browsers/store/), starting with `STORE_LISTING.md`.

The privacy policy must be reachable at a public URL. Enable GitHub Pages for this repository (Settings → Pages → deploy from `main`, root) and the copy in [`landing-page/`](landing-page/) is served at `https://sanekxarcs.github.io/fix-errors-ex/landing-page/privacy.html`.

</details>

## Testing

```sh
cd "extension for browsers"
npm test            # text replacement logic
npm run test:env    # local mock AI server and a page with every editor type
npm run test:e2e    # builds the extension and drives it with Playwright
```

## Privacy

- Settings, prompts and history live on your device only: `chrome.storage.local` in the extension, `electron-store` in the desktop app.
- Text you act on is sent only to the provider you configured: Google Gemini, or your own LM Studio server.
- Nothing is collected, sold or shared. There are no servers in this project.

Full text: [`extension for browsers/store/PRIVACY_POLICY.md`](extension%20for%20browsers/store/PRIVACY_POLICY.md).

## Contributing

The Gemini model list and the default prompts are duplicated in `extension for browsers/constants.js` and `desktop-app/shared/constants.js`. Update both when you change one. `.github/copilot-instructions.md` documents the architecture and data flow in more detail than this file.

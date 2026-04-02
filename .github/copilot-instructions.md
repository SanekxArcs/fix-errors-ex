# Fix Errors AI — Copilot Instructions

## Project Overview

**Fix Errors AI** is a Chrome Extension (Manifest V3) that lets users process selected text on any webpage via a right-click context menu or a keyboard shortcut. All text processing is powered by the **Google Gemini 2.5 Flash** API.

---

## File Structure

```
manifest.json     — Extension manifest (MV3): permissions, commands, content scripts
background.js     — Service worker: context menu setup, shortcut handler, Gemini API calls
content.js        — Injected into every page: handles text replacement, toast UI, selection getter
popup.html        — Extension popup: Settings / History / Shortcuts tabs (inline CSS)
popup.js          — Popup logic: view switching, API key save, history rendering, shortcut display
icons/            — PNG icons at 16×16, 48×48, 128×128
```

---

## Architecture & Data Flow

1. User selects text on a page, then either:
   - Right-clicks → **AI Text Tools** context menu → picks an action, **or**
   - Presses the keyboard shortcut (`Alt+Shift+F` by default) → triggers `fix_grammar` command
2. `background.js` (service worker) receives the event, injects `content.js` if not already present, then calls `callGeminiAI(text, apiKey, action)`.
3. `callGeminiAI` maps the `action` string to a tailored prompt and POSTs to the Gemini REST API with a **30-second `AbortSignal` timeout**.
4. The result is sent back to `content.js` via `chrome.tabs.sendMessage` with `action: "replaceText"`.
5. `content.js` replaces the selection in `<input>`, `<textarea>`, or `contenteditable` elements; fires `input` and `change` events for framework compatibility.
6. A toast notification (bottom-right) shows working / success / error state.
7. Each processed entry is saved to `chrome.storage.local` under the `history` key (max 50 items), including the `action` field.

---

## Available Actions

All action IDs are strings used in `ACTION_IDS` (background.js) and `ACTION_LABELS` (popup.js):

| Action ID           | Menu Label                         | Behaviour |
|---------------------|------------------------------------|-----------|
| `addPolish`         | Add polish                         | Refines text for professionalism |
| `fixGrammar`        | Fix spelling and grammar           | Fixes typos/grammar, keeps language |
| `toneFormal`        | Change tone → Formal               | Rewrites in formal register |
| `toneCasual`        | Change tone → Casual               | Rewrites in casual/friendly register |
| `toneEmpathetic`    | Change tone → Empathetic           | Rewrites with warmth and empathy |
| `toneEmojis`        | Change tone → Add emojis           | Adds relevant emojis |
| `emailStyle`        | Rewrite in official email style    | Structures text as a business email |
| `makeShorter`       | Make shorter                       | Condenses while keeping key message |
| `makeLonger`        | Make longer                        | Expands with detail and context |
| `translatePolish`   | Translate → To Polish              | Translates to Polish with grammar fix |
| `translateUkrainian`| Translate → To Ukrainian           | Translates to Ukrainian with grammar fix |
| `translateEnglish`  | Translate → To English (US)        | Translates to American English |
| `formatMarkdown`    | Format in Markdown                 | Applies Markdown syntax |
| `formatSlack`       | Format Slack message               | Uses Slack formatting conventions |

---

## API Key

- Stored in `chrome.storage.local` under the key `geminiApiKey`.
- Set via the **Settings** tab in the popup.
- Never hardcoded, never logged.

---

## Context Menu Structure

```
AI Text Tools (parent, shown on text selection)
├── Add polish
├── Fix spelling and grammar
├── ─────────────
├── Change tone ▶
│   ├── Formal
│   ├── Casual
│   ├── Empathetic
│   └── Add emojis
├── Rewrite in official email style
├── ─────────────
├── Make shorter
├── Make longer
├── ─────────────
├── Translate (with fix & grammar) ▶
│   ├── To Polish
│   ├── To Ukrainian
│   └── To English (US)
├── ─────────────
├── Format in Markdown
└── Format Slack message
```

---

## Keyboard Shortcut

- Command name: `fix_grammar`
- Default: `Alt+Shift+F`
- Defined in `manifest.json` under `"commands"`.
- Triggers `fixGrammar` action on the currently selected text.
- User can override it at `chrome://extensions/shortcuts`.
- The popup's **Shortcuts** tab reads the live binding via `chrome.commands.getAll()`.

---

## Coding Conventions

- **No build step** — plain vanilla JS, no bundler, no TypeScript.
- **Manifest V3** — use `chrome.scripting.executeScript` (not `chrome.tabs.executeScript`), service workers (not background pages), `chrome.storage.local` (not `localStorage`).
- **Every external I/O call must include a timeout.** The Gemini fetch uses `AbortSignal.timeout(30000)`. If adding new network calls, always include a timeout.
- **Injection guard** — `content.js` uses `window.lbxFixErrorsInjected` to prevent double-injection.
- **Safe message passing** — wrap all `chrome.tabs.sendMessage` calls in `.catch()` to avoid uncaught promise rejections on restricted pages (e.g. `chrome://` pages).
- **`action` field on history entries** — always include the `action` string when writing to history so the popup can display a human-readable label.
- Context menu is rebuilt using `chrome.contextMenus.removeAll()` before `createContextMenus()` to avoid duplicate-ID errors on extension reload.

---

## Adding a New Action

1. Add a new `chrome.contextMenus.create` call in `createContextMenus()` in `background.js`.
2. Add the action ID to the `ACTION_IDS` Set in `background.js`.
3. Add a prompt entry to the `prompts` object in `callGeminiAI()` in `background.js`.
4. Add a human-readable label to `ACTION_LABELS` in `popup.js`.

---

## Permissions Used

| Permission | Purpose |
|-----------|---------|
| `contextMenus` | Build right-click submenu |
| `storage` | Persist API key and history |
| `activeTab` | Access the current tab |
| `scripting` | Inject `content.js` on demand |
| `host_permissions: generativelanguage.googleapis.com` | Call Gemini REST API |

---

## Toast Notification Types

Defined in `content.js` `showToast()`:

| Type | Colour | When |
|------|--------|------|
| `working` | Blue `#1a73e8` | AI call in progress (stays until replaced) |
| `success` | Green `#2e7d32` | Text replaced successfully (auto-hides 4 s) |
| `error` | Red `#d32f2f` | API or injection error (auto-hides 4 s) |

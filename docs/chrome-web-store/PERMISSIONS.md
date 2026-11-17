# Permission justifications

Copy each paragraph into the matching field of the Developer Dashboard (Privacy tab). Every paragraph is below the 1,000-character limit. Evidence paths are for maintainers and reviewers of this repo; do not paste them into the Dashboard. Line numbers refer to `extension for browsers/` at version 2.0.13.

Manifest: permissions `contextMenus`, `storage`, `activeTab`, `scripting`, `clipboardWrite`; host permissions `https://generativelanguage.googleapis.com/*`, `http://localhost/*`, `http://127.0.0.1/*`; no `optional_permissions`; no `content_scripts`.

## `contextMenus` — required

Adds the "AI Text Tools" submenu to the right-click menu. Every item is registered with contexts ["selection"], so the menu appears only when the user has selected text. Each item is one action the user can apply to that selection: review before applying, add polish, fix spelling and grammar, change tone (formal, casual, empathetic, emojis), official email style, make shorter or longer, translate (Polish, Ukrainian, English), format as Markdown or Slack, or fix a Ukrainian/English keyboard-layout mix-up. The menu is static, is built once on install, and gives the extension no access to page content by itself.

Evidence: `extension for browsers/background.js:9-95 (createContextMenus); background.js:223-245 (onClicked → handleContextMenuClick)`. Characters: 616.

## `storage` — required

Uses chrome.storage.local to keep, on the user's device only: the AI provider settings the user enters (Gemini API key, model and fallback model, LM Studio server address and model), preferences such as auto-select, edited prompt templates, optional per-model request and token budgets with local usage counters, and a history of the last 50 edits with all-time totals shown in the History tab, which the user can clear. chrome.storage.session holds short-lived state (an open review, a pending retry) so it survives the service worker going idle. Nothing is sent to the developer; there is no backend.

Evidence: `extension for browsers/popup.js:625-637 (saveSettings); popup.js:530 (customPrompts); popup.js:248,279 (model limits); background.js:437-455 (addHistoryEntry); background.js:316-327,597 (session review/retry); model-limits.js:75-99 (modelUsage)`. Characters: 602.

## `activeTab` — required

Gives temporary access to the one tab where the user invoked the extension, by clicking an "AI Text Tools" menu item or pressing one of its keyboard shortcuts. In that tab the extension reads the text the user selected and writes the AI result back in its place. activeTab is used so the extension needs no host permission for websites at all: it has no access to a page until the user acts there, and it never reads or sends page content other than the selection the user asked it to process.

Evidence: `extension for browsers/background.js:225-245 (menu click), 250-308 (shortcuts); background.js:154-157 (readSelection); background.js:494-502 (applyGeneratedText)`. Characters: 493.

## `scripting` — required

Injects the bundled content.js into the active tab with chrome.scripting.executeScript at the moment the user runs an action. The manifest declares no content_scripts, so nothing runs on any page at load time. The injected script reads the current selection, replaces it with the result, and draws the extension's own UI on the page: the progress toast with a cancel button, the Review panel, the Reply Assist panel and the retry model picker. A second executeScript call only checks which frame has focus, so a shortcut acts on the field the user is typing in. All injected code ships in the package.

Evidence: `extension for browsers/background.js:127-134 (injectContentScript); background.js:137-152 (focusedFrameId); manifest.json (no content_scripts key)`. Characters: 601.

## `clipboardWrite` — required

Copies a result to the clipboard only when the user asks: the "Done & copy" button in the Review panel, the "Copy result" button shown when a site refuses programmatic editing (so the result is not lost), the copy button on a History entry, and the button that copies the user's own API key in Settings. The extension never reads the clipboard.

Evidence: `extension for browsers/content.js:1306-1313 (Review copyResult); content.js:653-661 (toast Copy result); popup.js:792 (history copy); popup.js:573 (copy API key)`. Characters: 344.

## `https://generativelanguage.googleapis.com/*` — host

Sends the text the user selected (and, for Reply Assist, the context the user typed) to the Google Gemini API when the user runs an action with Gemini as the provider, authenticated with the user's own API key. The extension also calls the countTokens and model-metadata endpoints of the same API so requests stay within the model's limits and the user's budgets. Requests and responses are JSON over HTTPS; the response is inserted as plain text, never executed.

Evidence: `extension for browsers/background.js:700 (model metadata); background.js:757-790 (countTokens, generateContent)`. Characters: 463.

## `http://localhost/*` — host

Lets a user who prefers to keep text off the internet use an LM Studio server running on their own computer instead of Gemini. When LM Studio is the chosen or fallback provider, the selected text is sent to its OpenAI-compatible /v1/chat/completions endpoint at the address the user entered (default http://localhost:1234). No other local service is contacted.

Evidence: `extension for browsers/constants.js:55 (DEFAULT_LM_STUDIO_URL); background.js:837-855 (callLMStudioAI fetch)`. Characters: 360.

## `http://127.0.0.1/*` — host

The same LM Studio feature as http://localhost/*, for users whose server address is written as 127.0.0.1. Both spellings of the loopback address are listed because LM Studio and users use either. Only the address the user typed in Settings is contacted, and only when they run an action.

Evidence: `extension for browsers/background.js:837-855 (callLMStudioAI fetch); popup.js:635 (lmStudioUrl setting)`. Characters: 287.

## Combined host justification, if the Dashboard provides one field

https://generativelanguage.googleapis.com/* sends the text the user selected (plus any context they typed into Reply Assist) to Google Gemini with the user's own API key when they run an action, and calls the same API's countTokens and model-metadata endpoints to respect model limits. http://localhost/* and http://127.0.0.1/* let the user use an LM Studio server on their own computer instead, at the address they entered (default http://localhost:1234). No website host access is requested: page access comes only from activeTab after a user gesture, in a single tab, and the manifest has no content_scripts.

Characters: 611.

## Single purpose

Fix Errors AI applies a writing action to text the user selects on a webpage and puts the result back in place. The user selects text, then picks an action from the "AI Text Tools" right-click menu or presses a keyboard shortcut: fix spelling and grammar, add polish, change tone, rewrite as an email, make shorter or longer, translate, format as Markdown or Slack, draft a reply that fits a conversation (Reply Assist), or review and edit the result before applying it. The text is sent to the AI provider the user configured, either Google Gemini with the user's own API key or an LM Studio server on the user's own computer, and the result replaces the selection or is copied. A keyboard-layout fix (Ukrainian/English) runs locally without AI.

Characters: 746.

# Privacy practices tab — field-by-field

Copy each block below into the matching field of the Chrome Web Store Developer
Dashboard ("Privacy" / "Конфіденційність" tab). Every field has a 1,000-character
limit; all text here fits. Field labels move around and get retranslated — match by
permission name, not by exact label wording.

Checked against `manifest.json` v1.8.0: permissions `contextMenus`, `storage`,
`activeTab`, `scripting`; host permissions `generativelanguage.googleapis.com`,
`localhost`, `127.0.0.1`; **no** `content_scripts` entry.

---

## Single purpose description ("Опис однієї мети")

```
Fix Errors AI has one purpose: to apply an AI text action to text the user has selected on a webpage, and to replace that selection with the result.

The user selects text in any input, textarea or editable field, then chooses an action from the "AI Text Tools" right-click submenu or presses one of the extension's keyboard shortcuts. The available actions are: fix spelling and grammar, add polish, change tone (formal, casual, empathetic, emojis), rewrite as an official email, make shorter, make longer, translate (Polish, Ukrainian, English), format as Markdown or as a Slack message, fix a Ukrainian/English keyboard-layout mix-up, draft a reply that matches the conversation's tone, and run a custom one-off prompt.

The selected text is sent to the AI provider the user configured - Google Gemini using the user's own API key, or an LM Studio server on the user's own machine - and the returned text replaces the selection in place.
```

## `contextMenus`

```
Used to add the "AI Text Tools" submenu to the browser's right-click menu. The menu is registered with contexts: ["selection"], so it appears only when the user has actually selected text.

This submenu is the extension's primary interface. Each item is one text action the user can apply to their selection: fix spelling and grammar, add polish, change tone, rewrite as an official email, make shorter or longer, translate, format as Markdown or Slack, fix a keyboard-layout mix-up, draft a reply, or run a custom prompt. Without this permission the user would have no way to choose which action to apply.

The menu is built once, on install. Its contents are static and do not depend on which site the user is visiting, and creating it does not give the extension any access to page content.
```

## `storage`

```
Used with chrome.storage.local to save the following on the user's own device only:

1. The AI provider settings the user enters: their Google Gemini API key, chosen model and fallback model, and their LM Studio server address and model name.
2. The user's preferences: auto-select-all and include-context toggles.
3. The user's custom prompt templates. Every action's system prompt is editable in the popup's Prompts tab, and the edited version is stored here.
4. A local record of the user's last 50 text edits, plus all-time usage totals, shown in the popup's History tab so the user can review what they changed and see their usage. The user can clear this at any time with the "Clear History" button.

None of this is transmitted to the developer; the project has no backend server. The API key is sent only to Google's Gemini API, to authenticate the user's own request.
```

## `activeTab`

```
Used to read the text the user has selected, and to write the AI result back in its place, in the single tab where the user triggered an action.

Access is granted by the user's own gesture - clicking an item in the "AI Text Tools" context menu, or pressing one of the extension's keyboard shortcuts - and is limited to that one tab.

We chose activeTab specifically so that the extension does not need broad host permissions for websites. The extension has no access to any tab until the user explicitly invokes an action in it, and no access at all to tabs the user has not invoked it in. It never reads, scans, or transmits page content other than the selection the user asked it to act on.
```

## `scripting`

```
Used to inject content.js into the active tab via chrome.scripting.executeScript, at the moment the user triggers an action, rather than running a content script on every page automatically.

The extension deliberately declares NO content_scripts entry in its manifest. Nothing runs on any page at load time; code reaches a page only after the user invokes an action there, and only in that one tab.

The injected script has a narrow job: read the current selection, replace it with the AI result once it arrives, and render the extension's own UI - a progress toast with a cancel button, the Reply Assist panel, and the model-picker panel shown after a capacity error.

Together with activeTab, this keeps the extension's page access scoped to a single tab and a single user-initiated action.
```

## Host permission ("Дозвіл хосту")

```
Three host patterns are requested, each needed for a network request the user has explicitly asked for.

https://generativelanguage.googleapis.com/* - to send the user's selected text to the Google Gemini API for grammar, tone, translation and formatting, authenticated with the API key the user entered in Settings. This is the default AI provider.

http://localhost/* and http://127.0.0.1/* - so a user who prefers to keep their text off the internet entirely can point the extension at an LM Studio server running on their own machine instead of Gemini. Both spellings of the loopback address are listed because LM Studio may be reached under either.

No other host is requested. The extension declares no content script and holds no host permission for any third-party website. Its access to page content comes from activeTab alone, after a user gesture, in a single tab.
```

## Remote code ("Чи використовуєте ви Віддалений код?")

Select **"Ні, я не використовую дозвіл Віддалений код"** (No).

Verified: no `eval()` or `new Function()` anywhere in the source, and no `<script>`
tag, module or stylesheet loading a remote file — every file in the package is local.
The extension sends the user's text to the Gemini REST API (or the user's own LM Studio
server) and renders the plain-text response as text. No script, WASM or executable
content is ever fetched or run.

---

## Data use ("Використання трафіку")

Chrome treats data as *collected* when it leaves the user's device. Tick these three:

| Category (UA label) | Tick? | Why |
|---|---|---|
| Ідентифікаційна інформація — PII | No | Never requested or handled. |
| Медична інформація | No | — |
| Фінансова й платіжна інформація | No | — |
| **Відомості для автентифікації** | **Yes** | The user's own Gemini API key. Stored locally, and transmitted — to Google, to authenticate the user's own request. |
| **Особисті засоби зв'язку** | **Yes** | The user may select an email, chat message or comment to process; that text goes to the configured AI provider. Reply Assist can include surrounding conversation text as context. |
| Геодані | No | — |
| Історія веб-пошуку | No | The extension does not record or transmit which sites the user visits. |
| Дії користувача | Judgment call — see below | |
| **Контент веб-сайту** | **Yes** | The text the user explicitly selects and asks the extension to process. |

**"Дії користувача" (user activity).** The extension keeps a local history of the last
50 edits and running usage totals. This never leaves `chrome.storage.local` on the
user's device, so under Google's "collected = transmitted off the device" reading it is
not collected, and the case for leaving it unticked is sound. But it is the one box on
this form that is genuinely arguable, and over-disclosing has never got an extension
rejected while under-disclosing has. If you want the safest submission, tick it too —
the privacy policy already describes this history plainly, so the listing stays
consistent either way.

## Certifications

All three must be ticked; all three are true for this extension:

- ✅ Data is sold or transferred to third parties only within the approved use case —
  the only third party is the AI provider the user chose and configured themselves.
- ✅ Data is not used or transferred for purposes unrelated to the single purpose.
- ✅ Data is not used or transferred to determine creditworthiness or for lending.

## Privacy policy URL

`https://sanekxarcs.github.io/fix-errors-ex/landing-page/privacy.html`

Must be live before you submit — see the checklist in `STORE_LISTING.md`.

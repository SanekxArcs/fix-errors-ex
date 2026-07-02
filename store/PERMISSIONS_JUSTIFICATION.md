# Permissions justification (for the "Privacy practices" tab)

The Developer Dashboard asks you to justify each permission in `manifest.json` in a
free-text box, plus answer a data-disclosure checklist. Paste the relevant text below
into each field. Field names/wording occasionally change on Google's side — match by
permission name, not exact label text.

## Per-permission justification

**`storage`**
```
Used to save the user's AI provider settings (Gemini API key, model choice, LM Studio
server address), custom prompt templates, and a local-only history of the user's last
50 text edits plus aggregate all-time usage stats. All of this is stored in
chrome.storage.local on the user's own device and is never transmitted to us.
```

**`activeTab`**
```
Used to read the user's current text selection on the tab they are actively using, and
to scope content-script injection and the result of an AI action to that specific tab.
```

**`scripting`**
```
Used to inject content.js into the active tab on demand, when the user triggers an
action via the right-click menu or a keyboard shortcut, rather than running a content
script on every page automatically at load.
```

**`contextMenus`**
```
Used to add the "AI Text Tools" right-click submenu (fix grammar, change tone,
translate, format, etc.) that appears when the user selects text on a page.
```

**Host permission: `https://generativelanguage.googleapis.com/*`**
```
Required to send the user's selected text to the Google Gemini API for grammar, tone,
translation, and formatting processing, using the API key the user provides in Settings.
```

**Host permission: `http://localhost/*`**
```
Required so users who run a local LM Studio server on their own machine (an optional,
privacy-preserving alternative to Gemini) can use it from the extension.
```

**Content script matching `<all_urls>` / "runs on all sites"**
```
The extension's core purpose is to act on text the user selects on any webpage — text
boxes, contenteditable fields, chat apps, email, comment forms, etc. — so the content
script must be available on all sites. It only reads the user's active selection when
the user explicitly triggers an action; it does not read, scan, or transmit page
content otherwise.
```

**"Are you using remote code?"**
```
No. The extension does not download or evaluate remote code. It sends the user's
selected text to the Gemini REST API (or the user's own local LM Studio server) and
displays the plain-text response; no scripts, WASM, or executable content are fetched.
```

## Data disclosure checklist

Chrome's data-disclosure form asks which categories of user data the extension
collects. Recommended answers for Fix Errors AI:

| Category | Collected? | Notes |
|---|---|---|
| Personally identifiable information | No | |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | **Yes** | The user's own Gemini API key, stored locally, used only to authenticate the user's own requests to Google. Never transmitted to us. |
| Personal communications | **Yes** | The user may select message/email/chat text to process (e.g. Reply Assist); that text is sent only to the AI provider the user configured. |
| Location | No | |
| Web history | No | The extension does not track which sites are visited. |
| User activity | **Yes** | Locally-stored history of the user's own text edits and usage stats, for the user's own review. Not transmitted to us. |
| Website content | **Yes** | The text the user explicitly selects and asks the extension to process. |

Certifications you should be able to make truthfully for this extension:
- ✅ Does not sell or transfer user data to third parties outside the extension's
  approved use case (the user's own chosen AI provider).
- ✅ Does not use or transfer user data for purposes unrelated to the extension's
  single purpose.
- ✅ Does not use or transfer user data to determine creditworthiness or for lending.

> Double-check these against the live dashboard wording before submitting — Google
> updates the exact categories and certification text from time to time.

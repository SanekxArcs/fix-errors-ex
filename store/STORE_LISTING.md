# Chrome Web Store Listing — Fix Errors AI

Copy-paste these into the Developer Dashboard fields. Anything in `[BRACKETS]` needs
a real value from you before submitting.

---

## Store listing tab

**Extension name** (must match `manifest.json` "name", 45 char max)
```
Fix Errors AI
```

**Summary** (132 char max — shown in search results)
```
Fix grammar, change tone, translate, or draft replies on any site — powered by Gemini AI or your own local LM Studio.
```
(117 characters)

**Category**
```
Productivity
```

**Language**
```
English
```

**Detailed description** (up to 16,000 characters; plain text, no Markdown — line
breaks are preserved, so bullets use "•")

```
Fix Errors AI helps you write better, faster, on any website — without copy-pasting into a separate AI chat window.

Select any text in a text box, chat, email, or comment field, right-click, and pick an action from the "AI Text Tools" menu (or use a keyboard shortcut). The AI-improved text replaces your selection in place.

WHAT IT CAN DO
• Fix spelling & grammar
• Add polish (more professional, more eloquent)
• Change tone → Formal, Casual, Empathetic, or add emojis
• Rewrite as an official business email
• Make shorter / make longer
• Translate → Polish, Ukrainian, or English (US)
• Format as Markdown or as a Slack message
• Fix keyboard layout mix-ups (Ukrainian ↔ English) when you typed in the wrong layout
• Reply Assist — draft a reply that matches the tone of the conversation you're replying to
• Custom AI Prompt — turn your selected text into a one-off prompt and get the result back in place

BRING YOUR OWN AI
Fix Errors AI does not run its own AI service and does not include any AI usage costs of its own. Choose the provider you want to use:
• Google Gemini — use your own free or paid Gemini API key
• LM Studio — point it at a local LM Studio server running on your own machine for fully private, offline text processing

You can customize the system prompt behind every single action, and set a fallback Gemini model for when your primary model is at capacity.

PRIVACY BY DESIGN
• Your API key and settings are stored only on your device (chrome.storage.local) — never on our servers, because we don't have any servers.
• Selected text is sent only to the AI provider you configured (Google Gemini or your own local LM Studio) to produce the result.
• Your edit history (last 50 items) and all-time usage stats are kept locally on your device so you can review or clear them any time.
• We do not collect, sell, or share your data. See our Privacy Policy for details: [PRIVACY POLICY URL]

KEYBOARD SHORTCUTS
Fully configurable at chrome://extensions/shortcuts:
• Fix grammar on selected text
• Fix grammar on a manual selection only
• Use selected text as a custom AI prompt

Questions or feedback: [SUPPORT EMAIL]
```

**Single purpose description** (required in the "Privacy practices" tab —
one sentence explaining what the extension does)
```
Lets the user apply an AI action (fix grammar, change tone, translate, format, or draft a reply) to text they select on any webpage, sending it to the AI provider (Google Gemini or the user's own local LM Studio server) the user has configured, and replacing the selection with the result.
```

---

## Graphic assets checklist (not text — you still need to produce these)

| Asset | Requirement | Status |
|---|---|---|
| Store icon | 128×128 PNG | ✅ `icons/Logo-Luigis-Box-128.png` already exists |
| Screenshot(s) | 1280×800 or 640×400, at least 1, up to 5 | ❌ need real screenshots of the popup and the context menu / toast in action |
| Small promo tile | 440×280 | ❌ optional but recommended for discoverability |
| Marquee promo tile | 1400×560 | ❌ optional, only shown if Google features the extension |

Suggested screenshots: (1) the right-click "AI Text Tools" menu open over selected
text, (2) the success toast after a replacement, (3) the popup's History tab
showing the all-time stats, (4) the Settings tab.

---

## Before you submit

- [ ] Fill in `[PRIVACY POLICY URL]` and `[SUPPORT EMAIL]` above and in `PRIVACY_POLICY.md`
- [ ] Host `PRIVACY_POLICY.md` somewhere public (GitHub Pages, Notion, your own site) and use that URL in the "Privacy policy" field of the dashboard
- [ ] Capture and upload screenshots
- [ ] Fill in the "Privacy practices" tab using `PERMISSIONS_JUSTIFICATION.md`
- [ ] Double-check the CWS Developer Dashboard field labels against this doc — Google adjusts wording occasionally

# Privacy Policy — Fix Errors AI

**Effective date:** July 2, 2026

Fix Errors AI ("the extension") is a Chrome extension that lets you apply AI-powered
text actions (fix grammar, change tone, translate, format, draft a reply, etc.) to text
you select on any webpage. This policy explains what data the extension handles and
how.

## Who runs this

Fix Errors AI is developed and maintained by [YOUR NAME OR COMPANY]. Contact:
[SUPPORT EMAIL].

## What the extension does with your data

**Text you select.** When you trigger an action (via the right-click menu or a keyboard
shortcut), the extension sends the text you selected — and, optionally, the text of the
message you're replying to, if you use Reply Assist and enable "include context" — to
the AI provider you have configured:

- **Google Gemini**, using the API key you provide, over HTTPS directly to
  `generativelanguage.googleapis.com`, or
- **LM Studio**, a server you run yourself, typically on your own computer or local
  network.

The extension does not run its own backend server. It does not see, log, or store your
text anywhere except as described below. We do not have access to the text you process
— it goes straight from your browser to the AI provider you chose.

**Your API key and settings.** Your Gemini API key, chosen models, LM Studio server
address, and preferences (e.g. auto-select, include-context, custom prompts) are stored
only in `chrome.storage.local` on your own device. They are never transmitted to us and
are only sent to the AI provider as part of making the request you asked for.

**Edit history and usage stats.** The extension keeps a local record of your last 50
text edits (original text, result, action used, response time, token usage) and
running all-time totals (number of corrections, total time, total tokens), so you can
review past edits and see your usage at a glance. This history is stored only in
`chrome.storage.local` on your device. It is never sent to us, and you can clear it at
any time from the extension's popup ("Clear History" button removes the detailed list;
uninstalling the extension removes everything).

## What we do not do

- We do not operate any server that receives or stores your text, your API key, or your
  history.
- We do not sell, rent, or share your data with third parties.
- We do not use your data for advertising.
- We do not use your data for any purpose other than performing the text action you
  requested.

## Third-party AI providers

When you use Google Gemini, your selected text and (optionally) recent history used as
context are subject to Google's own terms and privacy policy for the Gemini API. When
you use LM Studio, your text is sent only to the server address you configured — which
you control.

## Permissions

The extension requests browser permissions (storage, active tab, script injection,
context menus, and access to the Gemini API / your local LM Studio host) solely to read
your text selection, call the AI provider you configured, and write the result back
into the page. See `PERMISSIONS_JUSTIFICATION.md` for a permission-by-permission
explanation.

## Children's privacy

Fix Errors AI is not directed at children under 13 and does not knowingly collect data
from them.

## Changes to this policy

If this policy changes, the updated version will be published at the same URL with a
new effective date.

## Contact

Questions about this policy or your data: [SUPPORT EMAIL].

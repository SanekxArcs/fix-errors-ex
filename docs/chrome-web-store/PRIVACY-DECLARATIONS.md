# Privacy practices (Developer Dashboard, Privacy tab)

Answers for Fix Errors AI 2.0.13. Every claim here was checked against `extension for browsers/` (see `PERMISSIONS.md` for file:line evidence).

## Single purpose

See `fields.json` → `singlePurpose` (746 characters). In short: apply a writing action (fix, rewrite, change tone, translate, format, reply, review) to text the user selects on a webpage, using the AI provider the user configured, and put the result back in place.

## Remote code

**No, I am not using remote code.** All scripts ship in the package. `content.js` is injected from the package with `chrome.scripting.executeScript({ files: ["content.js"] })`. There is no `eval`, no `new Function` and no remote `<script>`. Gemini and LM Studio return JSON, and the model's answer is written into the page as plain text.

## Data usage: what the extension collects or handles

"Collected" here means the data leaves the extension. Text goes only to the AI provider the user chose (Google Gemini with the user's key, or LM Studio on the user's own computer), and only when the user runs an action. Nothing is ever sent to the developer, because there is no developer backend.

| Dashboard data type | Tick? | Why |
|---|---|---|
| Personally identifiable information | No | The extension never asks for a name, email, address or ID. Anything like that is only present if the user selects it as text to edit; that falls under "Website content" / "Personal communications" below. |
| Health information | No | Not requested or processed as a category. |
| Financial and payment information | No | No payments; no financial data requested. |
| Authentication information | **Yes** | The user's own Gemini API key is stored in `chrome.storage.local` and sent to Google (as the `key` parameter of the HTTPS request URL, background.js:700, 757, 764) to authenticate the user's own requests. It never goes anywhere else. |
| Personal communications | **Yes** | Users often select text from emails and chat messages (drafts they are writing), and Reply Assist sends the conversation context the user pastes in. This text goes to the chosen AI provider for that one request. |
| Location | No | Not accessed. |
| Web history | No | No tabs, history or URLs are read or stored. |
| User activity | No | No clicks, keystrokes or navigation are monitored or sent. The History tab stores past edits (original text, result, action, token counts, response time) only in `chrome.storage.local` on the device; nothing is transmitted, so this is not "collected". If the reviewer reads local history as user activity, ticking it is harmless; the safer reading of Google's definition is No. |
| Website content | **Yes** | The text the user selects on a page is sent to the chosen AI provider to be fixed or rewritten. |

## Limited Use and certifications

Tick all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

The only transfer is to the AI provider the user picked, to perform the action the user requested. That is the item's single purpose. When the user chooses Gemini, Google's own API terms apply to that request.

## Privacy policy URL

https://sanekxarcs.github.io/fix-errors-ex/landing-page/privacy.html

Before submitting, check that the page is online and describes the same behaviour: the API key is stored locally; the selected text and the Reply Assist context go only to the chosen provider; History is kept locally with a limit of 50 entries and can be cleared; there are no analytics; there is no developer server.

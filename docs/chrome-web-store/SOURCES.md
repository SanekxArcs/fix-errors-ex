# Where each fact comes from

Everything in this folder was written from the code of version 2.0.13 in `extension for browsers/`. The older drafts in `extension for browsers/store/*.md` were used as a starting point and corrected where the code has changed.

| Topic | Source of truth |
|---|---|
| Name, version, permissions, hosts, commands, no content_scripts | `extension for browsers/manifest.json` |
| Context-menu items and titles | `background.js:9-95` (`createContextMenus`) |
| Shortcuts and what each one does | `manifest.json` → `commands`; `background.js:250-308` (`handleCommand`); Alt+Shift+Esc is a page listener in `content.js` |
| Script injection only on a user gesture | `background.js:127-134`, `137-152`, `225-245` |
| Review panel actions (16) and buttons | `content.js:1187-1196` (action list), `1306-1313` ("Done & copy") |
| "Copy result" when a site blocks edits | `background.js:504-512`, `content.js:653-661` |
| Reply Assist (context comes only from what the user types) | `content.js` Reply Assist panel; `background.js:189` (`replyAssistSubmit`); `background.js:6` removes the old `includeContext` setting |
| Providers, fallback, retry picker | `background.js:597` (retry), `700-790` (Gemini), `837-855` (LM Studio); `constants.js:55` (default LM Studio URL) |
| Per-model budgets | `model-limits.js:75-99`; `popup.js:248, 279` |
| Editable prompts | `popup.js:530`; defaults in `constants.js` `DEFAULT_PROMPTS` |
| History: 50 entries, all-time totals, local only | `background.js:437-455` (`HISTORY_LIMIT = 50`, `lifetimeStats`) |
| Clipboard writes on user click only | `content.js:653-661, 1306-1313`; `popup.js:573, 792` |
| API key sent only to Google, in the request URL | `background.js:700, 757, 764` |
| Keyboard-layout fix is local | `background.js:413-470` (`translitKeyboard`) |
| Homepage, support and privacy URLs | the repo's README and `landing-page/privacy.html` (published on GitHub Pages) |

## Corrections to the old `store/*.md`

- The version is 2.0.13, not 1.8.0.
- `clipboardWrite` is a new permission and needed a justification.
- The "Include page context" toggle no longer exists. Reply Assist sends only the context the user types into its panel.
- Alt+Shift+A now opens Reply Assist. The free-form AI prompt is only an action inside the Review panel ("Use as an AI prompt").
- Alt+Shift+R (Review), Alt+Shift+Esc (cancel), the retry model picker, the fallback provider and per-model budgets were missing.
- The old drafts list a personal contact email. It is deliberately left out here; support goes through GitHub issues.

## Not claimed

No numbers of users, ratings, "supports 100+ languages" or similar. Translation is limited to the three targets the menu offers (Polish, Ukrainian, English US). Review-panel tone and translate actions use the same templates as the menu.

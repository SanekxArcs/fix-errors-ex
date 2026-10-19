# Extension review: 2.0.6

The old extension called its provider functions directly from shortcut and
context-menu handlers. The new version adds a review panel and messages between
the page and background worker. The confirmed failures were introduced in that
new workflow. The WXT-generated worker starts and registers the command listener.

## Confirmed defects and repairs

- The panel queried `#close`, but the button had only a class. A null element
  caused panel setup to throw. The button now has the expected ID.
- The processing message declared `action` twice. Its writing style overwrote
  `processReview`, so the background receiver did not process the request. The
  message route uses `action`; the writing style uses `actionId`.
- The background validator also checked the route instead of the writing style.
  It now validates and passes `actionId` to the provider.
- The panel left its initial character count at zero and its badge at
  PROCESSING after a failure. Counts initialize correctly and failures leave
  processing state with the provider's error visible.
- Cancel removed a review record without aborting its provider request. Each
  review now has an abort controller and a 30-second timeout. Cancellation also
  restores the original field's focus and selection.
- Done ignored whether replacement succeeded and reported success regardless.
  Replacement now acknowledges success; changed or removed original fields are
  preserved and the user can paste the copied result manually.
- Non-editable webpage selections were treated as writable DOM ranges. These
  now use copy-only completion, preserving the page and its selection.
- Reopening the panel while its textarea was focused could save that textarea
  as the replacement target. The original page target is retained.
- Settings and prompts could lose their last edits when the popup closed during
  the autosave delay. Writes now start on the input event. Saved model IDs absent
  from the built-in list are also preserved.
- Source scripts and copies under `public/` could diverge. Build and ZIP
  commands now synchronize the source scripts automatically. Development also
  watches these files. WXT reads metadata from the source manifest.

The previous keyboard-layout explanation was a hypothesis. The user's red badge
and error screenshot demonstrate that shortcut dispatch reached this worker.
The requested Alt+Shift+F/G/A defaults are restored. Existing manually assigned
browser shortcuts may remain assigned after an update.

## Verification

Thirteen integration scenarios passed using the actual panel, settings, and
background scripts in a DOM environment with mocked browser APIs and providers:
grammar processing and completion; custom prompts; empty-selection insertion;
copying page text; cancellation; missing credentials; LM Studio; changed target
text; provider errors; contenteditable fields; shadow-root fields; repeated
shortcuts; and settings/history/prompts/shortcut views.

The WXT Chrome package builds successfully. JavaScript parsing and duplicate-key
checks cover the packaged scripts. Provider requests in these checks are mocked;
these results do not confirm live browser behavior, real provider responses, or
every third-party editor's integration.

## 2.0.7: preserve the original workflows

The existing commands and writing menu actions now use the old direct-processing
functions again. Alt+Shift+F honors auto-select, Alt+Shift+G uses only manual
selection, and Alt+Shift+A opens the original Reply Assist panel with optional
context. The additional review feature has its own Alt+Shift+R command and
"Review before applying…" menu item.

Twenty integration scenarios passed against the packaged worker and page
scripts, including the twelve review scenarios above, the popup screens, and
seven compatibility scenarios for the original shortcuts, empty selection,
Reply Assist submission, direct menu actions, local transliteration, and the
additional review menu. Browser APIs and provider responses are mocked.
## 2.0.9: model budgets

All generation paths now share the same per-model guard, including original
shortcuts, Reply Assist, review, manual retries, and automatic fallback. Profiles
require positive request/minute, request/day, input-token/minute, input/request,
and output/reply caps. Daily input tokens are optional. Missing or invalid
profiles block generation. Gemini uses countTokens on the full prompt and gets
actual input/output maximums from models.get (cached for ten minutes). Local
models use UTF-8 text size plus a margin; their configured context budget remains
the user's responsibility.

Usage is reserved and persisted under a serialized worker queue before sending.
Failed attempts count conservatively. The minute window rolls, daily budgets
reset at midnight Pacific, and provider 429 responses persist a cooldown.
Counters cover this extension/browser, not other clients sharing the project.
There is no account-wide spending guarantee.

Thirteen quota scenarios passed against the packaged helper and worker with
mocked APIs: missing setup, concurrent reservations, minute expiry, TPM boundary,
persistent RPD and Pacific reset, TPD, actual input cap, oversize requests,
failed metadata/counting, output cap/cache, fallback isolation, provider cooldown,
and local budgets/cancellation/invalid profiles. The twenty existing workflow
checks passed, with one additional popup scenario covering quota setup,
validation, per-model saves, and persistence alongside ordinary settings.
Provider calls and browser APIs are mocked; no live-browser claim is made.

## 2.0.10: popup layout, notice lifecycle, and fallback providers

- Popup buttons and scroll-panel children resist flex shrinking. Clear History
  retains its 34px minimum height. The header uses a centered SVG mark.
- Chrome command descriptions match the four Keyboard Shortcuts labels exactly.
- The experimental history-context preference and its processing branches are
  removed; updates delete the old stored preference. Reply Assist's explicit
  conversation context remains available.
- Retry notices expire after 15 seconds, can be dismissed, and leave the DOM
  immediately. Popup notices are created on demand and removed on expiry too.
  Model pickers expire, close on Escape/outside clicks, and clean up listeners.
  Pending retries are scoped to their originating tab and expire with the UI;
  opening the picker extends its retry window.
- Primary/fallback provider routing is shared across all generation paths.
  Gemini and LM Studio can fall back to each other; local fallback URL/model are
  stored separately. Duplicate targets are skipped, cancellation stops fallback,
  and every attempted model must pass its own persisted budget checks. Existing
  Gemini fallback settings remain compatible.

Forty-six automated checks passed with mocked provider/browser APIs: the prior
34 scenarios, eleven additional provider/lifecycle/layout/name scenarios, and
one popup scenario for local fallback setup, saving, quota selection, and Gemini
credentials with a local primary. The packaged WXT Chrome extension builds.
Live extension UI was not verified; browser automation cannot access extension
pages in this session.

## 2.0.11: shortcut errors belong to the page

The popup no longer reads or replays lastShortcutError as a popup toast. Shortcut
failures continue through the page's showToast message. If Chrome blocks script
injection on the Web Store, the toolbar badge/title provide feedback instead;
the original browser error is retained for diagnostics. No attempt is made to
bypass the browser restriction. The Chrome package builds. Three focused checks
passed with mocked APIs: stored-error popup startup stays quiet, a failure after
injection sends a page toast, and a protected page with no receiver fails safely
with a readable toolbar message.

## 2.0.12: optional budgets and automatic token limits

Custom budget enforcement has a persisted switch. New installations without
profiles do not require manual setup. Existing profiles preserve enabled
enforcement on upgrade unless the user explicitly turns it off. Disabled
budgets retain profiles and continue counting attempts, so reenabling does not
reset usage. Gemini's actual token caps and provider cooldowns always apply.
LM Studio uses the server output default when personal budgets are off.

The settings screen automatically fetches Gemini input/output maximums using
the configured key and prefills empty token-cap fields, without overwriting
custom values. Rate budgets remain account-specific: Google's current official
rate-limit docs refer users to their AI Studio project and do not publish a
universal free-tier table. No undocumented RPM/TPM/RPD values are invented.

Five focused worker scenarios passed with mocked APIs: unconfigured default
processing, disabling/reenabling without counter reset, hard token caps and
cooldowns while off, local server defaults, and settings metadata retrieval.
The existing workflow, quota, fallback, and popup checks passed with updated
expectations for optional setup. The WXT Chrome package builds; live browser
behavior remains unverified.


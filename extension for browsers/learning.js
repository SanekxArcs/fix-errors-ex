// Learning from corrections: a local word-level diff between the text you wrote
// and the fixed text, plus a running dictionary of the corrections it finds.
// Everything here runs on the device; no request is sent anywhere.
// Loaded by the background worker (importScripts) and by the popup (script tag).

const MISTAKE_KIND_LABELS = {
  spelling: "Spelling",
  punctuation: "Punctuation",
  capitalization: "Capitalization",
  missing: "Missing word",
  extra: "Extra word",
  wording: "Grammar & wording",
  spacing: "Spacing"
};

// Only "Fix spelling & grammar" results describe mistakes; the other actions
// rewrite on purpose. Entries saved before actions were recorded were fixes too.
const LEARNING_ACTIONS = new Set(["fixGrammar", undefined, null]);
// Below this share of unchanged words the model rewrote the text rather than
// corrected it, and the word pairs the diff finds are noise.
const LEARN_MIN_SIMILARITY = 0.5;
const MISTAKE_ITEM_LIMIT = 1500;
const MISTAKE_TEXT_LIMIT = 60;
const MISTAKE_WORD_LIMIT = 4;
const EXAMPLE_CONTEXT_CHARS = 24;
// Largest changed region (original tokens x fixed tokens) the diff will align.
const DIFF_CELL_LIMIT = 2000000;

const DIFF_TOKEN_PATTERN = /[\p{L}\p{N}\p{M}]+(?:['’ʼ-][\p{L}\p{N}\p{M}]+)*|\s+|[^\s\p{L}\p{N}\p{M}]/gu;
const isWordToken = token => /[\p{L}\p{N}]/u.test(token);
const isSpaceToken = token => /^\s+$/.test(token);

// Words (with inner apostrophes and hyphens), whitespace runs, and single
// punctuation marks. Joining the tokens gives the text back exactly.
function tokenizeForDiff(text) {
  return String(text ?? "").match(DIFF_TOKEN_PATTERN) || [];
}

// Token-level diff as [{ type: "eq" | "del" | "ins", token }]. Returns null
// when the changed region is too large to align.
function diffTexts(original, fixed) {
  const a = tokenizeForDiff(original);
  const b = tokenizeForDiff(fixed);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start, m = endB - start;
  if (n * m > DIFF_CELL_LIMIT) return null;

  // Longest common subsequence over the changed middle.
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      table[i * width + j] = a[start + i - 1] === b[start + j - 1]
        ? table[(i - 1) * width + j - 1] + 1
        : Math.max(table[(i - 1) * width + j], table[i * width + j - 1]);
    }
  }
  const middle = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[start + i - 1] === b[start + j - 1]) {
      middle.push({ type: "eq", token: a[start + i - 1] }); i--; j--;
    } else if (j > 0 && (i === 0 || table[i * width + j - 1] >= table[(i - 1) * width + j])) {
      middle.push({ type: "ins", token: b[start + j - 1] }); j--;
    } else {
      middle.push({ type: "del", token: a[start + i - 1] }); i--;
    }
  }
  middle.reverse();

  return [
    ...a.slice(0, start).map(token => ({ type: "eq", token })),
    ...middle,
    ...a.slice(endA).map(token => ({ type: "eq", token }))
  ];
}

// Share of the words that survived the fix (0..1). A corrected typo or capital
// letter still counts as the same word, so a text full of typos stays "similar"
// while a rewrite does not. Punctuation is ignored.
function diffSimilarity(ops, corrections) {
  let kept = 0, originalWords = 0, fixedWords = 0;
  for (const op of ops) {
    if (!isWordToken(op.token)) continue;
    if (op.type !== "ins") originalWords++;
    if (op.type !== "del") fixedWords++;
    if (op.type === "eq") kept++;
  }
  kept += corrections.filter(correction => correction.kind === "spelling" || correction.kind === "capitalization").length;
  const words = Math.max(originalWords, fixedWords);
  return words ? Math.min(1, kept / words) : 1;
}

// Edit distance where swapping two neighbouring letters counts as one edit.
function editDistance(a, b) {
  const rows = a.length + 1, cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, r) => {
    const row = new Array(cols).fill(0);
    row[0] = r;
    return row;
  });
  for (let c = 0; c < cols; c++) d[0][c] = c;
  for (let r = 1; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const cost = a[r - 1] === b[c - 1] ? 0 : 1;
      d[r][c] = Math.min(d[r - 1][c] + 1, d[r][c - 1] + 1, d[r - 1][c - 1] + cost);
      if (r > 1 && c > 1 && a[r - 1] === b[c - 2] && a[r - 2] === b[c - 1]) {
        d[r][c] = Math.min(d[r][c], d[r - 2][c - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

function classifyWordChange(from, to) {
  if (!from) return "missing";
  if (!to) return "extra";
  const lowerFrom = from.toLowerCase(), lowerTo = to.toLowerCase();
  if (lowerFrom === lowerTo) return "capitalization";
  if (/\s/.test(from) || /\s/.test(to)) return "wording";
  // Very short words differ by one letter all the time ("in"/"on", "a"/"an"),
  // and a pure ending change ("walk"/"walked") is grammar, not a typo.
  if (Math.min(lowerFrom.length, lowerTo.length) < 3) return "wording";
  if (lowerTo.startsWith(lowerFrom) || lowerFrom.startsWith(lowerTo)) return "wording";
  const longest = Math.max(lowerFrom.length, lowerTo.length);
  return editDistance(lowerFrom, lowerTo) <= Math.max(1, Math.floor(longest / 3)) ? "spelling" : "wording";
}

// Compares the two texts and lists what changed. Returns null when the texts
// are too different or too large to compare.
//   corrections: [{ kind, from, to, example: { before, del, ins, after } }]
function extractCorrections(original, fixed) {
  original = String(original ?? "");
  fixed = String(fixed ?? "");
  const ops = diffTexts(original, fixed);
  if (!ops) return null;
  const corrections = [];
  let position = 0; // offset in the original text
  let run = null;

  const flush = () => {
    if (!run) return;
    const { start, del, ins } = run;
    run = null;
    const example = {
      before: original.slice(Math.max(0, start - EXAMPLE_CONTEXT_CHARS), start),
      del: del.join(""),
      ins: ins.join(""),
      after: original.slice(position, position + EXAMPLE_CONTEXT_CHARS)
    };
    const fromWords = del.filter(isWordToken).join(" ");
    const toWords = ins.filter(isWordToken).join(" ");
    const fromMarks = del.filter(token => !isWordToken(token) && !isSpaceToken(token)).join("");
    const toMarks = ins.filter(token => !isWordToken(token) && !isSpaceToken(token)).join("");
    let found = false;
    if (fromWords !== toWords) {
      const kind = classifyWordChange(fromWords, toWords);
      const keepCase = kind === "capitalization";
      corrections.push({
        kind,
        from: keepCase ? fromWords : fromWords.toLowerCase(),
        to: keepCase ? toWords : toWords.toLowerCase(),
        example
      });
      found = true;
    }
    if (fromMarks !== toMarks) {
      corrections.push({ kind: "punctuation", from: fromMarks, to: toMarks, example });
      found = true;
    }
    if (!found) corrections.push({ kind: "spacing", from: "", to: "", example });
  };

  for (const op of ops) {
    if (op.type === "eq") { flush(); position += op.token.length; continue; }
    if (!run) run = { start: position, del: [], ins: [] };
    if (op.type === "del") { run.del.push(op.token); position += op.token.length; }
    else run.ins.push(op.token);
  }
  flush();
  return { ops, similarity: diffSimilarity(ops, corrections), corrections };
}

// Short plain-text form: `teh → the`, `add ","`, `remove "the"`.
function correctionText(correction) {
  const { kind, from, to } = correction;
  if (kind === "spacing") return "spacing";
  if (!from) return `add "${to}"`;
  if (!to) return `remove "${from}"`;
  return kind === "punctuation" ? `"${from}" → "${to}"` : `${from} → ${to}`;
}

// Toast text after a grammar fix: says what was wrong, so the fix teaches.
function fixSummaryMessage(original, fixed) {
  if (original === fixed) return "Done! Nothing needed fixing.";
  const result = extractCorrections(original, fixed);
  if (!result || result.similarity < LEARN_MIN_SIMILARITY) return "Done!";
  const list = result.corrections.filter(correction => correction.kind !== "spacing");
  if (!list.length) return "Done!";
  const shown = list.map(correctionText).filter(text => text.length <= 30).slice(0, 2);
  const rest = list.length - shown.length;
  const head = `Done! ${list.length} ${list.length === 1 ? "fix" : "fixes"}`;
  if (!shown.length) return `${head}.`;
  return `${head}: ${shown.join(", ")}${rest > 0 ? `, +${rest} more` : ""}`;
}

function emptyMistakes() {
  return { version: 1, analyzed: 0, totals: {}, items: {} };
}

function isStorableCorrection({ kind, from, to }) {
  if (kind === "spacing") return false;
  return [from, to].every(text => text.length <= MISTAKE_TEXT_LIMIT && text.split(" ").length <= MISTAKE_WORD_LIMIT);
}

// Adds one original/fixed pair to the dictionary (mutates and returns it).
function addEditToMistakes(mistakes, original, fixed, timestamp) {
  const result = extractCorrections(original, fixed);
  if (!result || result.similarity < LEARN_MIN_SIMILARITY) return mistakes;
  mistakes.analyzed += 1;
  for (const correction of result.corrections) {
    mistakes.totals[correction.kind] = (mistakes.totals[correction.kind] || 0) + 1;
    if (!isStorableCorrection(correction)) continue;
    const key = `${correction.kind}|${correction.from}|${correction.to}`;
    const item = mistakes.items[key] || (mistakes.items[key] = {
      kind: correction.kind, from: correction.from, to: correction.to, count: 0, first: timestamp
    });
    item.count += 1;
    item.last = timestamp;
    item.example = correction.example;
  }
  const keys = Object.keys(mistakes.items);
  if (keys.length > MISTAKE_ITEM_LIMIT) {
    // Drop the rarest, then the oldest, leaving some room before the next trim.
    keys.sort((x, y) => mistakes.items[x].count - mistakes.items[y].count ||
      String(mistakes.items[x].last).localeCompare(String(mistakes.items[y].last)));
    for (const key of keys.slice(0, keys.length - Math.floor(MISTAKE_ITEM_LIMIT * 0.9))) delete mistakes.items[key];
  }
  return mistakes;
}

function buildMistakesFromHistory(history) {
  const mistakes = emptyMistakes();
  // History is stored newest first; learn in the order the edits happened.
  for (const entry of [...history].reverse()) {
    if (LEARNING_ACTIONS.has(entry.action)) addEditToMistakes(mistakes, entry.original, entry.fixed, entry.timestamp);
  }
  return mistakes;
}

// Reads the dictionary; the first time it is built from the saved history.
async function loadMistakes() {
  const { mistakes, history = [] } = await chrome.storage.local.get(["mistakes", "history"]);
  if (mistakes) return mistakes;
  const built = buildMistakesFromHistory(history);
  await chrome.storage.local.set({ mistakes: built });
  return built;
}

// Called after a history entry has been saved.
async function learnFromHistoryEntry(entry) {
  if (!LEARNING_ACTIONS.has(entry.action)) return;
  const { mistakes } = await chrome.storage.local.get("mistakes");
  // With no dictionary yet, loadMistakes builds it from history, this entry included.
  if (!mistakes) { await loadMistakes(); return; }
  await chrome.storage.local.set({ mistakes: addEditToMistakes(mistakes, entry.original, entry.fixed, entry.timestamp) });
}

// Most frequent first, then most recent. kind is optional.
function topMistakes(mistakes, limit = 50, kind = "") {
  return Object.values(mistakes?.items || {})
    .filter(item => !kind || item.kind === kind)
    .sort((x, y) => y.count - x.count || String(y.last).localeCompare(String(x.last)))
    .slice(0, limit);
}

// Use onInstalled to setup the context menus. Always clear existing ones first.
chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  chrome.storage.local.remove("includeContext").catch(console.error);
});

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "aiTextTools",
      title: "AI Text Tools",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "reviewText",
      parentId: "aiTextTools",
      title: "Review before applying…",
      contexts: ["selection"]
    });

    // 1. Add polish
    chrome.contextMenus.create({
      id: "addPolish",
      parentId: "aiTextTools",
      title: "Add polish",
      contexts: ["selection"]
    });

    // 2. Fix spelling and grammar
    chrome.contextMenus.create({
      id: "fixGrammar",
      parentId: "aiTextTools",
      title: "Fix spelling and grammar",
      contexts: ["selection"]
    });

    chrome.contextMenus.create({ id: "sep1", parentId: "aiTextTools", type: "separator", contexts: ["selection"] });

    // 3. Change tone (submenu)
    chrome.contextMenus.create({
      id: "changeTone",
      parentId: "aiTextTools",
      title: "Change tone \u25ba",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({ id: "toneFormal", parentId: "changeTone", title: "Formal", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "toneCasual", parentId: "changeTone", title: "Casual", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "toneEmpathetic", parentId: "changeTone", title: "Empathetic", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "toneEmojis", parentId: "changeTone", title: "Add emojis", contexts: ["selection"] });

    // 4. Official email style
    chrome.contextMenus.create({
      id: "emailStyle",
      parentId: "aiTextTools",
      title: "Rewrite in official email style",
      contexts: ["selection"]
    });

    chrome.contextMenus.create({ id: "sep2", parentId: "aiTextTools", type: "separator", contexts: ["selection"] });

    // 5. Make shorter
    chrome.contextMenus.create({ id: "makeShorter", parentId: "aiTextTools", title: "Make shorter", contexts: ["selection"] });

    // 6. Make longer
    chrome.contextMenus.create({ id: "makeLonger", parentId: "aiTextTools", title: "Make longer", contexts: ["selection"] });

    chrome.contextMenus.create({ id: "sep3", parentId: "aiTextTools", type: "separator", contexts: ["selection"] });

    // 7. Translate (submenu)
    chrome.contextMenus.create({
      id: "translate",
      parentId: "aiTextTools",
      title: "Translate (with fix & grammar) \u25ba",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({ id: "translatePolish", parentId: "translate", title: "To Polish", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "translateUkrainian", parentId: "translate", title: "To Ukrainian", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "translateEnglish", parentId: "translate", title: "To English (US)", contexts: ["selection"] });

    chrome.contextMenus.create({ id: "sep4", parentId: "aiTextTools", type: "separator", contexts: ["selection"] });

    // 8. Format in Markdown
    chrome.contextMenus.create({ id: "formatMarkdown", parentId: "aiTextTools", title: "Format in Markdown", contexts: ["selection"] });

    // 9. Format Slack message
    chrome.contextMenus.create({ id: "formatSlack", parentId: "aiTextTools", title: "Format Slack message", contexts: ["selection"] });

    chrome.contextMenus.create({ id: "sep5", parentId: "aiTextTools", type: "separator", contexts: ["selection"] });

    // 10. Fix keyboard layout
    chrome.contextMenus.create({ id: "translit", parentId: "aiTextTools", title: "Fix keyboard layout (UA\u2194EN)", contexts: ["selection"] });
  });
}

const ACTION_IDS = new Set(Object.keys(DEFAULT_PROMPTS));

// One running direct request per tab, so cancelling in one tab never stops another.
const tabJobs = new Map();
const reviewControllers = new Map();
const RETRY_WINDOW_MS = 15000;
const PROVIDER_SETTING_KEYS = [
  "aiProvider", "geminiApiKey", "geminiModel", "geminiFallbackModel", "lmStudioUrl", "lmStudioModel",
  "fallbackProvider", "fallbackLmStudioUrl", "fallbackLmStudioModel", "requestTimeoutSeconds"
];

// The worker sleeps after ~30s idle and loses its globals, so anything a later
// click depends on (Reply Assist target, pending retry) lives in session storage.
async function takeSessionValue(key) {
  const { [key]: value } = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return value;
}

function requestTimeoutMs(settings) {
  const seconds = Number(settings.requestTimeoutSeconds);
  return (Number.isFinite(seconds) && seconds >= 1 ? Math.min(seconds, 300) : DEFAULT_REQUEST_TIMEOUT_SECONDS) * 1000;
}

// Page UI (toasts, panels) always lives in the top frame; text lives in the frame
// that had the selection.
function notifyTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(error => console.warn("Message sending failed:", error));
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
  } catch (error) {
    // Some frames (other origins, PDFs) refuse injection; the top frame may still work.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  }
}

// Shortcuts carry no frame, so ask each frame whether it holds the focus.
async function focusedFrameId(tabId) {
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const el = document.activeElement;
        if (el && (el.tagName === "IFRAME" || el.tagName === "FRAME")) return { focused: false, selected: false };
        const typed = el && typeof el.selectionStart === "number" && el.selectionEnd > el.selectionStart;
        return { focused: document.hasFocus(), selected: Boolean(typed || String(getSelection() || "")) };
      }
    });
    return (frames.find(f => f.result?.focused) || frames.find(f => f.result?.selected))?.frameId ?? 0;
  } catch {
    return 0;
  }
}

async function readSelection(tabId, frameId, autoSelectAll) {
  const response = await chrome.tabs.sendMessage(tabId, { action: "getSelection", autoSelectAll }, { frameId });
  return response ? { ...response, frameId } : { text: "", frameId };
}

function isCapacityError(msg) {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return m.includes("high demand") || m.includes("overloaded") || m.includes("overload") ||
    m.includes("resource_exhausted") || m.includes("service unavailable") ||
    m.includes("temporarily unavailable") || m.includes("capacity");
}

// fetch() rejects an aborted request with a DOMException named "AbortError";
// match that shape when we detect the abort ourselves, so callers only need one check.
function makeAbortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getModelTokenLimits") {
    (async () => {
      if (!/^[a-zA-Z0-9._-]+$/.test(request.model || "")) throw new Error("Choose a valid Gemini model.");
      const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
      if (!geminiApiKey) throw new Error("Add a Gemini API key to load the model's token limits automatically.");
      const caps = await getGeminiModelCaps(request.model, geminiApiKey, null, modelLimitKey("gemini", request.model));
      return { ok: true, inputTokenLimit: caps.inputTokenLimit, outputTokenLimit: caps.outputTokenLimit };
    })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  } else if (request.action === "cancelAI") {
    if (sender.tab) tabJobs.get(sender.tab.id)?.abort();
  } else if (request.action === "replyAssistSubmit") {
    if (!sender.tab) return;
    const { selectedText, context } = request;
    takeSessionValue(`replyAssist:${sender.tab.id}`).then(target => {
      processTextWithAI(selectedText, sender.tab, "replyAssist", context, null, null, target?.frameId ?? 0);
    });
  } else if (request.action === "retryAI") {
    if (!sender.tab) return;
    takeSessionValue(`retry:${sender.tab.id}`).then(retry => {
      if (!retry || retry.expiresAt < Date.now()) {
        notifyTab(sender.tab.id, { action: "showToast", message: "This retry expired. Select the text and run the action again.", type: "error" });
        return;
      }
      const override = request.provider === "lmstudio" ? { provider: "lmstudio" } : { provider: "gemini", model: request.model };
      processTextWithAI(retry.originalText, sender.tab, retry.action, retry.context, override, retry.edgeInfo, retry.frameId);
    });
  } else if (request.action === "retryPickerOpened") {
    if (!sender.tab) return;
    const key = `retry:${sender.tab.id}`;
    chrome.storage.session.get(key).then(({ [key]: retry }) => {
      if (retry && retry.expiresAt > Date.now()) chrome.storage.session.set({ [key]: { ...retry, expiresAt: Date.now() + RETRY_WINDOW_MS } });
    });
  } else if (request.action === "processReview") {
    processReview(request, sendResponse);
    return true;
  } else if (request.action === "commitReview") {
    commitReview(request).then(result => sendResponse({ ok: true, ...result })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  } else if (request.action === "cancelReview") {
    reviewControllers.get(request.reviewId)?.abort();
    chrome.storage.session.remove(`review:${request.reviewId}`);
  }
});

chrome.contextMenus.onClicked.addListener(handleContextMenuClick);

async function handleContextMenuClick(info, tab) {
  const action = info.menuItemId;
  if ((!ACTION_IDS.has(action) && action !== "reviewText") || !info.selectionText) return;
  const frameId = info.frameId ?? 0;
  let selection;
  try {
    await injectContentScript(tab.id);
    if (action !== "reviewText") await notifyTab(tab.id, { action: "dismissReview" });
    selection = await readSelection(tab.id, frameId, false);
  } catch (error) {
    console.warn("Could not capture the page selection:", error);
  }
  const text = selection?.text || info.selectionText;
  if (action === "reviewText") {
    await openReview(tab, { ...selection, text, frameId }, "fixGrammar");
  } else if (action === "translit") {
    await processTranslit(text, tab, frameId);
  } else {
    await processTextWithAI(text, tab, action, "", null, selection, frameId);
  }
}

// Keyboard shortcut handler
chrome.commands.onCommand.addListener(command => handleCommand(command));

async function handleCommand(command) {
  if (!["fix_grammar", "fix_selected", "ai_prompt", "open_refine"].includes(command)) return;
  reportShortcutStatus("…", "#6377e8");
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active browser tab was found.");
    await injectContentScript(tab.id);
    if (command !== "open_refine") await notifyTab(tab.id, { action: "dismissReview" });
    const frameId = await focusedFrameId(tab.id);
    if (command === "fix_grammar") {
      const { autoSelectAll = false } = await chrome.storage.local.get("autoSelectAll");
      const response = await readSelection(tab.id, frameId, autoSelectAll);
      if (response.text?.trim()) {
        await processTextWithAI(response.text, tab, "fixGrammar", "", null, response, frameId);
      } else {
        warnNothingToFix(tab, autoSelectAll, response);
      }
    } else if (command === "fix_selected") {
      // Always use only the manually selected text, ignoring autoSelectAll setting
      const response = await readSelection(tab.id, frameId, false);
      if (response.text?.trim()) {
        await processTextWithAI(response.text, tab, "fixGrammar", "", null, response, frameId);
      } else {
        warnNothingToFix(tab, false, response);
      }
    } else if (command === "ai_prompt") {
      const response = await readSelection(tab.id, frameId, false);
      if (response.text?.trim()) {
        await chrome.storage.session.set({ [`replyAssist:${tab.id}`]: { frameId } });
        await notifyTab(tab.id, { action: "showReplyAssistModal", selectedText: response.text });
      } else {
        warnNothingToFix(tab, false, response);
      }
    } else if (command === "open_refine") {
      const response = await readSelection(tab.id, frameId, false);
      await openReview(tab, response, "fixGrammar");
    }
    await chrome.storage.local.remove("lastShortcutError");
    chrome.action.setTitle({ title: "Fix Errors AI" });
    reportShortcutStatus("✓", "#16845b");
  } catch (error) {
    console.error("Shortcut failed:", error);
    const originalMessage = error?.message || String(error);
    const message = /extensions gallery cannot be scripted/i.test(originalMessage)
      ? "Chrome blocks extensions on the Chrome Web Store. Open a regular webpage to use this shortcut."
      : originalMessage;
    await chrome.storage.local.set({ lastShortcutError: { message, originalMessage, at: Date.now() } }).catch(() => {});
    chrome.action.setTitle({ title: `Shortcut failed: ${message.slice(0, 220)}` });
    if (tab?.id != null) {
      notifyTab(tab.id, {
        action: "showToast",
        message: `Shortcut failed: ${message}`,
        type: "error"
      });
    }
    reportShortcutStatus("!", "#c33b3b");
  }
}

function reportShortcutStatus(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1800);
}

async function openReview(tab, selection, action) {
  const reviewId = crypto.randomUUID();
  await chrome.storage.session.set({ [`review:${reviewId}`]: {
    tabId: tab.id,
    frameId: selection.frameId ?? 0,
    original: selection.text || "",
    action,
    canReplace: Boolean(selection.hadEditableTarget),
    createdAt: Date.now()
  }});
  await notifyTab(tab.id, {
    action: "openReviewPanel",
    reviewId,
    original: selection.text || "",
    actionId: action,
    canReplace: Boolean(selection.hadEditableTarget)
  });
}

async function processReview(request, sendResponse) {
  const controller = new AbortController();
  reviewControllers.get(request.reviewId)?.abort();
  reviewControllers.set(request.reviewId, controller);
  try {
    const { [`review:${request.reviewId}`]: review } = await chrome.storage.session.get(`review:${request.reviewId}`);
    if (!review) throw new Error("This review has expired. Select the text again to start over.");
    const actionId = request.actionId;
    if (!ACTION_IDS.has(actionId)) throw new Error("Choose a valid writing action.");
    const sourceText = String(request.text ?? review.original ?? "");
    if (!sourceText.trim()) throw new Error("Enter some text to refine first.");
    if (actionId === "translit") {
      const text = translitKeyboard(sourceText);
      if (text === sourceText) throw new Error("No keyboard layout change was detected.");
      sendResponse({ ok: true, text, tokens: null, responseTimeMs: 0 });
      return;
    }

    const settings = await chrome.storage.local.get(PROVIDER_SETTING_KEYS);
    const startedAt = Date.now();
    const result = await callConfiguredAI(sourceText, settings, actionId, controller.signal, "", null, null, requestTimeoutMs(settings));
    if (!result.text) throw new Error("The AI returned no text. Your original selection is unchanged.");
    sendResponse({ ok: true, text: result.text, tokens: result.tokens, responseTimeMs: Date.now() - startedAt });
  } catch (error) {
    sendResponse({ ok: false, error: isAbortError(error) ? "Processing cancelled." : error.message || "Something went wrong while processing your text." });
  } finally {
    if (reviewControllers.get(request.reviewId) === controller) reviewControllers.delete(request.reviewId);
  }
}

async function commitReview(request) {
  const key = `review:${request.reviewId}`;
  const { [key]: review } = await chrome.storage.session.get(key);
  if (!review) throw new Error("This review has expired.");
  if (!request.text?.trim()) throw new Error("The result is empty.");
  const originalText = String(request.originalText ?? review.original ?? "");
  await injectContentScript(review.tabId);
  const frame = { frameId: review.frameId ?? 0 };
  let replaced = false;
  if (review.canReplace) {
    const response = await chrome.tabs.sendMessage(review.tabId, {
      action: "replaceText",
      originalText: review.original,
      fixedText: matchEdgeWhitespace(review.original, request.text)
    }, frame);
    if (!response?.replaced) throw new Error(response?.error || "The original field is no longer available. Your result is copied; paste it where you need it.");
    replaced = true;
  } else {
    await chrome.tabs.sendMessage(review.tabId, { action: "restoreSelection" }, frame);
  }
  await addHistoryEntry({
    timestamp: new Date().toISOString(),
    original: originalText,
    fixed: request.text,
    applied: replaced,
    action: request.actionId || review.action,
    tokens: request.tokens || null,
    responseTimeMs: request.responseTimeMs || 0
  });
  await chrome.storage.session.remove(key);
  return { replaced };
}

// A shortcut that finds no text used to do nothing at all, which is indis-
// tinguishable from the extension being broken. Say which of the three reasons
// it was, so the fix is obvious from the toast alone.
function warnNothingToFix(tab, autoSelectAll, response) {
  let message;
  if (!autoSelectAll) {
    message = "Nothing selected. Select some text, or turn on auto-select in the extension settings.";
  } else if (response && response.hadEditableTarget) {
    message = "That field is empty — nothing to fix.";
  } else {
    message = "Auto-select needs a focused text field. Click into the field first, or select the text yourself.";
  }
  notifyTab(tab.id, { action: "showToast", message, type: "error" });
}

// ─── Keyboard layout translit (UA ↔ EN) ──────────────────────────────────────

const UA_TO_EN_MAP = {
  'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ї':']',
  'ф':'a','і':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','є':"'",
  'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.',
  'Й':'Q','Ц':'W','У':'E','К':'R','Е':'T','Н':'Y','Г':'U','Ш':'I','Щ':'O','З':'P','Х':'{','Ї':'}',
  'Ф':'A','І':'S','В':'D','А':'F','П':'G','Р':'H','О':'J','Л':'K','Д':'L','Ж':':','Є':"\"",
  'Я':'Z','Ч':'X','С':'C','М':'V','И':'B','Т':'N','Ь':'M','Б':'<','Ю':'>'
};

const EN_TO_UA_MAP = {
  'q':'й','w':'ц','e':'у','r':'к','t':'е','y':'н','u':'г','i':'ш','o':'щ','p':'з',
  'a':'ф','s':'і','d':'в','f':'а','g':'п','h':'р','j':'о','k':'л','l':'д',
  'z':'я','x':'ч','c':'с','v':'м','b':'и','n':'т','m':'ь',
  'Q':'Й','W':'Ц','E':'У','R':'К','T':'Е','Y':'Н','U':'Г','I':'Ш','O':'Щ','P':'З',
  'A':'Ф','S':'І','D':'В','F':'А','G':'П','H':'Р','J':'О','K':'Л','L':'Д',
  'Z':'Я','X':'Ч','C':'С','V':'М','B':'И','N':'Т','M':'Ь'
};

const HISTORY_LIMIT = 50;

// Detailed history only keeps the most recent HISTORY_LIMIT entries. Anything
// older is folded into lifetimeStats so aggregate totals survive forever.
async function addHistoryEntry(entry) {
  const { history = [] } = await chrome.storage.local.get("history");
  const combined = [entry, ...history];
  const kept = combined.slice(0, HISTORY_LIMIT);
  const evicted = combined.slice(HISTORY_LIMIT);

  if (evicted.length > 0) {
    const { lifetimeStats = { count: 0, totalTimeMs: 0, totalTokens: 0 } } =
      await chrome.storage.local.get("lifetimeStats");
    for (const item of evicted) {
      lifetimeStats.count += 1;
      lifetimeStats.totalTimeMs += item.responseTimeMs || 0;
      lifetimeStats.totalTokens += item.tokens?.total || 0;
    }
    await chrome.storage.local.set({ lifetimeStats });
  }

  await chrome.storage.local.set({ history: kept });
}

function translitKeyboard(text) {
  const cyrillicCount = [...text].filter(ch => /[а-яА-ЯіІїЇєЄ]/.test(ch)).length;
  const latinCount    = [...text].filter(ch => /[a-zA-Z]/.test(ch)).length;
  if (cyrillicCount === 0 && latinCount === 0) return text;
  const map = cyrillicCount >= latinCount ? UA_TO_EN_MAP : EN_TO_UA_MAP;
  return [...text].map(ch => map[ch] ?? ch).join('');
}

async function processTranslit(originalText, tab, frameId = 0) {
  try {
    await injectContentScript(tab.id);
  } catch (e) {
    console.warn("Script injection failed:", e);
  }

  const fixedText = translitKeyboard(originalText);

  if (fixedText === originalText) {
    notifyTab(tab.id, { action: "showToast", message: "No layout change detected.", type: "error" });
    return;
  }

  const outcome = await applyGeneratedText(tab.id, originalText, fixedText, frameId);
  await addHistoryEntry({
    timestamp: new Date().toISOString(),
    original: originalText,
    fixed: fixedText,
    action: "translit",
    applied: outcome.replaced,
    applyError: outcome.error || null,
    tokens: null,
    responseTimeMs: 0
  });

  notifyTab(tab.id, outcomeToast(outcome, fixedText, "Layout fixed!"));
}

async function applyGeneratedText(tabId, originalText, fixedText, frameId = 0) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: "replaceText", originalText, fixedText }, { frameId });
    return response?.replaced ? { replaced: true } : { replaced: false, error: response?.error || "The page did not confirm the replacement." };
  } catch (error) {
    return { replaced: false, error: error.message };
  }
}

// Say why a result was not applied; the Copy button keeps the result usable.
function outcomeToast(outcome, fixedText, successMessage) {
  if (outcome.replaced) return { action: "showToast", message: successMessage, type: "success" };
  return {
    action: "showToast",
    message: `Not applied: ${outcome.error || "the page did not accept the text."}`,
    type: "error",
    copyText: fixedText
  };
}

// Models trim their answers, but a double-clicked word arrives as "word " and a
// line selection can end with a newline. Keep the selection's own edge whitespace
// so the replacement does not glue words or lines together.
function matchEdgeWhitespace(original, fixed) {
  const leading = original.match(/^\s*/)[0];
  const trailing = original.match(/\s*$/)[0];
  return leading + fixed.trim() + trailing;
}

// ─────────────────────────────────────────────────────────────────────────────

// edgeInfo: leading/trailing chip text (e.g. an @mention) excluded from the DOM selection
// so it's never touched — kept only to make the history entry show the full message.
function composeWithEdges(text, edgeInfo) {
  if (!edgeInfo) return text;
  const { leadingText = "", trailingText = "" } = edgeInfo;
  return [leadingText, text, trailingText].filter(Boolean).join(" ").trim();
}

// modelOverride: when set, skip the normal provider/model config and use this specific model.
// Used by the "Retry with model" flow after a capacity error or timeout.
async function processTextWithAI(originalText, tab, action, context = "", modelOverride = null, edgeInfo = null, frameId = 0) {
  try {
    await injectContentScript(tab.id);
  } catch (e) {
    console.warn("Script injection failed (expected on some system pages):", e);
  }

  const settings = await chrome.storage.local.get(PROVIDER_SETTING_KEYS);
  await chrome.storage.session.remove(`retry:${tab.id}`);
  const timeoutMs = requestTimeoutMs(settings);
  // The page's safety net must outlast a primary attempt, a fallback attempt, and applying.
  const pageDeadlineMs = timeoutMs * 2 + 15000;

  // A new request replaces an unfinished one in the same tab; the old one stays quiet.
  const previous = tabJobs.get(tab.id);
  if (previous) { previous.superseded = true; previous.abort(); }
  const controller = new AbortController();
  tabJobs.set(tab.id, controller);
  const providerName = target => target.provider === "lmstudio" ? "LM Studio" : "Gemini";

  try {
    const primaryName = settings.aiProvider === "lmstudio" && !modelOverride ? "LM Studio" : modelOverride?.provider === "lmstudio" ? "LM Studio" : "Gemini";
    notifyTab(tab.id, { action: "showToast", message: `Waiting for ${primaryName}…`, type: "working", timeoutMs: pageDeadlineMs });

    const t0 = Date.now();
    const result = await callConfiguredAI(originalText, settings, action, controller.signal, context, modelOverride, target => {
      notifyTab(tab.id, { action: "showToast", message: `Trying ${providerName(target)} fallback…`, type: "working", timeoutMs: pageDeadlineMs });
    }, timeoutMs);
    const responseTimeMs = Date.now() - t0;
    const { tokens } = result;

    if (!result.text) {
      notifyTab(tab.id, { action: "showToast", message: "AI returned no usable text. Original text kept.", type: "error" });
      return;
    }
    // A cancel that arrived with the answer still means "leave my text alone".
    if (controller.signal.aborted) throw makeAbortError();
    const fixedText = matchEdgeWhitespace(originalText, result.text);

    const outcome = await applyGeneratedText(tab.id, originalText, fixedText, frameId);
    await addHistoryEntry({
      timestamp: new Date().toISOString(),
      original: composeWithEdges(originalText, edgeInfo),
      fixed: composeWithEdges(fixedText, edgeInfo),
      action,
      applied: outcome.replaced,
      applyError: outcome.error || null,
      tokens,
      responseTimeMs
    });

    notifyTab(tab.id, outcomeToast(outcome, fixedText, "Done!"));
  } catch (error) {
    if (controller.superseded) return;
    if (isAbortError(error)) {
      notifyTab(tab.id, { action: "showToast", message: "Cancelled — your text was left unchanged.", type: "info" });
      return;
    }
    console.error("AI Error:", error);

    if (isCapacityError(error.message) || error.name === "RequestTimeoutError") {
      // Kept in session storage so the retry survives the worker going idle.
      await chrome.storage.session.set({ [`retry:${tab.id}`]: {
        originalText, action, context, frameId,
        edgeInfo: edgeInfo ? { leadingText: edgeInfo.leadingText || "", trailingText: edgeInfo.trailingText || "" } : null,
        expiresAt: Date.now() + RETRY_WINDOW_MS
      }});
      const models = GEMINI_MODELS.map(model => ({ ...model, provider: "gemini" }));
      if (settings.aiProvider === "lmstudio" || settings.fallbackProvider === "lmstudio") {
        models.push({ id: "configured-local", provider: "lmstudio", label: "LM Studio (configured local model)" });
      }
      notifyTab(tab.id, {
        action: "showRetryableError",
        message: error.message,
        models
      });
    } else {
      notifyTab(tab.id, { action: "showToast", message: "Error: " + error.message, type: "error" });
    }
  } finally {
    if (tabJobs.get(tab.id) === controller) tabJobs.delete(tab.id);
  }
}

function stripSurroundingQuotes(str) {
  if (str.length > 1 &&
      ((str.startsWith('"') && str.endsWith('"')) ||
       (str.startsWith("'") && str.endsWith("'")))) {
    return str.slice(1, -1);
  }
  return str;
}

function configuredFallback(settings) {
  // Preserve an existing Gemini fallback when upgrading from older versions.
  const provider = settings.fallbackProvider ?? (settings.geminiFallbackModel ? "gemini" : "none");
  if (provider === "gemini" && settings.geminiFallbackModel) return { provider, model: settings.geminiFallbackModel };
  if (provider === "lmstudio") return {
    provider, model: settings.fallbackLmStudioModel || "",
    url: settings.fallbackLmStudioUrl || DEFAULT_LM_STUDIO_URL
  };
  return null;
}

function requestTimeoutFailure(target, timeoutMs) {
  const name = target.provider === "lmstudio" ? "LM Studio" : `Gemini (${target.model})`;
  const error = new Error(`${name} did not respond within ${Math.round(timeoutMs / 1000)} seconds. Your text is unchanged; try again or choose another model.`);
  error.name = "RequestTimeoutError";
  return error;
}

// Each provider attempt gets its own deadline, so a stalled primary still leaves
// time for the fallback. User cancellation stops everything.
async function callConfiguredAI(text, settings, action, signal, context = "", override = null, onFallback = null, timeoutMs = DEFAULT_REQUEST_TIMEOUT_SECONDS * 1000) {
  const primary = settings.aiProvider === "lmstudio"
    ? { provider: "lmstudio", model: settings.lmStudioModel || "", url: settings.lmStudioUrl || DEFAULT_LM_STUDIO_URL }
    : { provider: "gemini", model: settings.geminiModel || DEFAULT_GEMINI_MODEL };
  let fallback = configuredFallback(settings);
  let target = primary;
  if (override) {
    if (override.provider === "lmstudio") {
      target = fallback?.provider === "lmstudio" ? fallback : primary.provider === "lmstudio" ? primary : null;
      if (!target) throw new Error("Set up an LM Studio provider before retrying locally.");
    } else {
      const model = typeof override === "string" ? override : override.model;
      if (!model) throw new Error("Choose a retry model.");
      target = { provider: "gemini", model };
    }
    fallback = null;
  }
  if (fallback && modelLimitKey(target.provider, target.model, target.url) === modelLimitKey(fallback.provider, fallback.model, fallback.url)) fallback = null;
  const invoke = async selection => {
    if (signal?.aborted) throw makeAbortError();
    const deadline = AbortSignal.timeout(timeoutMs);
    const attempt = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      if (selection.provider === "lmstudio") return await callLMStudioAI(text, selection.url, selection.model, action, [], attempt, context);
      if (!settings.geminiApiKey) throw new Error("Add your Gemini API key in the extension settings before processing text.");
      return await callGeminiAI(text, settings.geminiApiKey, action, selection.model, "", [], attempt, context);
    } catch (error) {
      if (deadline.aborted && !signal?.aborted) throw requestTimeoutFailure(selection, timeoutMs);
      throw error;
    }
  };
  try {
    return await invoke(target);
  } catch (error) {
    if (isAbortError(error) || signal?.aborted || !fallback) throw error;
    onFallback?.(fallback);
    try { return await invoke(fallback); }
    catch (fallbackError) {
      if (isAbortError(fallbackError)) throw fallbackError;
      throw new Error(`Primary: ${error.message} Fallback: ${fallbackError.message}`);
    }
  }
}

const geminiModelCaps = new Map();

// Cached in session storage too: the worker restarts after every idle period,
// and an extra metadata round trip on each request adds noticeable delay.
async function getGeminiModelCaps(model, apiKey, signal, quotaKey) {
  const sessionKey = `geminiCaps:${model}`;
  const cached = geminiModelCaps.get(model) || (await chrome.storage.session.get(sessionKey))[sessionKey];
  if (cached && Date.now() - cached.at < 600000) return cached.caps;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${apiKey}`, {
    signal: signal || AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 429) await rememberModelCooldown(quotaKey, providerRetrySeconds(response, error));
    throw new Error(error.error?.message || "Could not check this model's token limits. No text-generation request was sent.");
  }
  const caps = await response.json();
  if (![caps.inputTokenLimit, caps.outputTokenLimit].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw quotaFailure("Could not verify this model's token limits. No text-generation request was sent.");
  }
  const entry = { at: Date.now(), caps: { inputTokenLimit: caps.inputTokenLimit, outputTokenLimit: caps.outputTokenLimit } };
  geminiModelCaps.set(model, entry);
  await chrome.storage.session.set({ [sessionKey]: entry });
  return entry.caps;
}

function emptyGeminiReason(data, candidate) {
  if (data.promptFeedback?.blockReason) return `Gemini blocked this request (${data.promptFeedback.blockReason}). Your text is unchanged.`;
  switch (candidate?.finishReason) {
    case "MAX_TOKENS": return "Gemini used its whole output limit before writing an answer (MAX_TOKENS). Shorten the text or raise the output limit in Settings → Model limits.";
    case "SAFETY": case "PROHIBITED_CONTENT": case "BLOCKLIST": return `Gemini declined to answer (${candidate.finishReason}). Your text is unchanged.`;
    case "RECITATION": return "Gemini stopped because the answer matched existing content (RECITATION). Try rephrasing.";
    default: return `Gemini returned no text${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}. Your text is unchanged.`;
  }
}

async function callGeminiAI(text, apiKey, action, primaryModel = DEFAULT_GEMINI_MODEL, fallbackModel = "", history = [], signal = null, context = "") {
  const { customPrompts = {} } = await chrome.storage.local.get("customPrompts");
  const template = customPrompts[action] || DEFAULT_PROMPTS[action] || DEFAULT_PROMPTS.fixGrammar;

  let prompt = "";
  if (action === "aiPrompt") {
    prompt = text;
  } else if (action === "replyAssist") {
    const contextPart = context ? `\n\nContext (surrounding conversation):\n"${context}"` : "";
    prompt = `${template}${contextPart}\n\nText to refine:\n"${text}"`;
  } else {
    // Add history as context if provided
    if (history && history.length > 0) {
      const historyText = history.slice(0, 5).reverse().map(h => `Original: ${h.original}\nFixed: ${h.fixed}`).join("\n---\n");
      prompt = `Here is some context from previous requests:\n${historyText}\n\n---\n\n${template}\n\nText: "${text}"`;
    } else {
      prompt = `${template}\n\nText: "${text}"`;
    }
  }

  const modelsToTry = [primaryModel];
  if (fallbackModel && fallbackModel !== primaryModel) {
    modelsToTry.push(fallbackModel);
  }

  let lastError;

  for (const model of modelsToTry) {
    if (signal?.aborted) throw makeAbortError();
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const quotaKey = modelLimitKey("gemini", model);
      await checkModelAvailability(quotaKey);
      const modelCaps = await getGeminiModelCaps(model, apiKey, signal, quotaKey);
      const contents = [{ parts: [{ text: prompt }] }];
      const countResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens?key=${apiKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }), signal: signal || AbortSignal.timeout(30000)
      });
      if (!countResponse.ok) {
        const countError = await countResponse.json().catch(() => ({}));
        if (countResponse.status === 429) await rememberModelCooldown(quotaKey, providerRetrySeconds(countResponse, countError));
        throw new Error(countError.error?.message || "Could not count tokens. No text-generation request was sent.");
      }
      const count = await countResponse.json();
      const limits = await reserveModelUsage(quotaKey, count.totalTokens, signal, modelCaps);
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: limits.maxOutputTokens }
        }),
        signal: signal || AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (response.status === 429) await rememberModelCooldown(quotaKey, providerRetrySeconds(response, errData));
        throw new Error(errData.error?.message || response.statusText);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      // Thinking models can return thought parts; only the answer parts are text to paste.
      const aiResponseText = (candidate?.content?.parts || []).filter(part => !part.thought && typeof part.text === "string").map(part => part.text).join("");
      if (!aiResponseText.trim()) throw new Error(emptyGeminiReason(data, candidate));
      const usage = data.usageMetadata || {};
      const tokens = {
        input: usage.promptTokenCount ?? null,
        output: usage.candidatesTokenCount ?? null,
        total: usage.totalTokenCount ?? null
      };
      return { text: stripSurroundingQuotes(aiResponseText.trim()), tokens };
    } catch (error) {
      // A cancel is not a model failure — don't burn the fallback model on it.
      if (isAbortError(error)) throw error;
      lastError = error;
      console.warn(`Gemini model failed: ${model}`, error);
    }
  }

  if (modelsToTry.length > 1) {
    throw new Error(`Primary and fallback model failed. ${lastError?.message || "Unknown error"}`);
  }

  throw lastError || new Error("Gemini request failed");
}

async function callLMStudioAI(text, baseUrl, model, action, history = [], signal = null, context = "") {
  const { customPrompts = {} } = await chrome.storage.local.get("customPrompts");
  const template = customPrompts[action] || DEFAULT_PROMPTS[action] || DEFAULT_PROMPTS.fixGrammar;

  let prompt = "";
  if (action === "aiPrompt") {
    prompt = text;
  } else if (action === "replyAssist") {
    const contextPart = context ? `\n\nContext (surrounding conversation):\n"${context}"` : "";
    prompt = `${template}${contextPart}\n\nText to refine:\n"${text}"`;
  } else {
    if (history && history.length > 0) {
      const historyText = history.slice(0, 5).reverse().map(h => `Original: ${h.original}\nFixed: ${h.fixed}`).join("\n---\n");
      prompt = `Here is some context from previous requests:\n${historyText}\n\n---\n\n${template}\n\nText: "${text}"`;
    } else {
      prompt = `${template}\n\nText: "${text}"`;
    }
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const quotaKey = modelLimitKey("lmstudio", model, baseUrl);
  // A conservative byte count avoids understating local models' input tokens.
  const inputTokens = new TextEncoder().encode(prompt).length + 64;
  const limits = await reserveModelUsage(quotaKey, inputTokens, signal);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      ...(limits.enabled ? { max_tokens: limits.maxOutputTokens } : {}),
      stream: false
    }),
    signal: signal || AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    if (response.status === 429) await rememberModelCooldown(quotaKey, providerRetrySeconds(response, errData));
    throw new Error(errData.error?.message || `LM Studio error: ${response.statusText}`);
  }

  const data = await response.json();
  // Reasoning models may prefix their answer with a <think> block.
  const aiResponseText = (data.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  if (!aiResponseText.trim()) throw new Error(data.choices?.[0]?.finish_reason === "length"
    ? "LM Studio stopped at its output limit before writing an answer. Raise the model's output limit or shorten the text."
    : "LM Studio returned an empty answer. Check that a model is loaded.");
  const usage = data.usage || {};
  const tokens = {
    input: usage.prompt_tokens ?? null,
    output: usage.completion_tokens ?? null,
    total: usage.total_tokens ?? null
  };
  return { text: stripSurroundingQuotes(aiResponseText.trim()), tokens };
}

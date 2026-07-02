const { ipcMain } = require('electron');
const store = require('./store');
const { isCapacityError, translitKeyboard, callGeminiAI, callLMStudioAI } = require('./ai-service');
const { DEFAULT_GEMINI_MODEL, GEMINI_MODELS } = require('../shared/constants');

let currentAbortController = null;
let pendingRetry = null;

async function runAction(text, action, context = "") {
  if (action === "translit") {
    const fixedText = translitKeyboard(text);
    if (fixedText === text) {
      return { ok: false, retryable: false, message: "No layout change detected." };
    }
    store.addHistoryEntry({
      timestamp: new Date().toISOString(),
      original: text,
      fixed: fixedText,
      action: "translit",
      tokens: null,
      responseTimeMs: 0
    });
    return { ok: true, text: fixedText, tokens: null, responseTimeMs: 0 };
  }

  const settings = store.getSettings();
  const { aiProvider, geminiApiKey, geminiModel, geminiFallbackModel, lmStudioUrl, lmStudioModel, includeContext } = settings;

  if (aiProvider !== "lmstudio" && !geminiApiKey) {
    return { ok: false, retryable: false, message: "Please set your Gemini API Key in Settings." };
  }

  try {
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    const t0 = Date.now();
    const { history } = store.getHistory();
    const historyContext = includeContext ? history : [];

    let result;
    if (aiProvider === "lmstudio") {
      result = await callLMStudioAI(text, lmStudioUrl, lmStudioModel || "", action, historyContext, signal, context);
    } else {
      result = await callGeminiAI(text, geminiApiKey, action, geminiModel || DEFAULT_GEMINI_MODEL, geminiFallbackModel || "", historyContext, signal, context);
    }
    currentAbortController = null;
    const responseTimeMs = Date.now() - t0;
    const { text: fixedText, tokens } = result;

    if (!fixedText) {
      return { ok: false, retryable: false, message: "AI returned no usable text. Original text kept." };
    }

    store.addHistoryEntry({
      timestamp: new Date().toISOString(),
      original: text,
      fixed: fixedText,
      action,
      tokens,
      responseTimeMs
    });

    return { ok: true, text: fixedText, tokens, responseTimeMs };
  } catch (error) {
    currentAbortController = null;
    if (error.name === "AbortError" || error.message === "AbortError") {
      return { ok: false, retryable: false, message: "AI process cancelled." };
    }
    console.error("AI Error:", error);

    if (isCapacityError(error.message) && aiProvider !== "lmstudio") {
      pendingRetry = { originalText: text, action, context };
      const fallbackModel = (geminiFallbackModel && geminiFallbackModel !== (geminiModel || DEFAULT_GEMINI_MODEL))
        ? geminiFallbackModel
        : null;
      return { ok: false, retryable: true, message: error.message, fallbackModel, models: GEMINI_MODELS };
    }

    return { ok: false, retryable: false, message: "Error: " + error.message };
  }
}

async function retryWithModel(originalText, action, context, model) {
  const settings = store.getSettings();
  if (!settings.geminiApiKey) {
    return { ok: false, retryable: false, message: "Please set your Gemini API Key in Settings." };
  }

  try {
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;
    const t0 = Date.now();
    const { history } = store.getHistory();
    const historyContext = settings.includeContext ? history : [];

    const result = await callGeminiAI(originalText, settings.geminiApiKey, action, model, "", historyContext, signal, context);
    currentAbortController = null;
    const responseTimeMs = Date.now() - t0;
    const { text: fixedText, tokens } = result;

    store.addHistoryEntry({
      timestamp: new Date().toISOString(),
      original: originalText,
      fixed: fixedText,
      action,
      tokens,
      responseTimeMs
    });

    pendingRetry = null;
    return { ok: true, text: fixedText, tokens, responseTimeMs };
  } catch (error) {
    currentAbortController = null;
    if (isCapacityError(error.message)) {
      return { ok: false, retryable: true, message: error.message, fallbackModel: null, models: GEMINI_MODELS };
    }
    return { ok: false, retryable: false, message: "Error: " + error.message };
  }
}

function registerIpcHandlers() {
  ipcMain.handle('runAction', (event, text, action, context) => runAction(text, action, context));

  ipcMain.handle('cancelRun', () => {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    return { ok: true };
  });

  ipcMain.handle('retryWithModel', (event, originalText, action, context, model) => retryWithModel(originalText, action, context, model));

  ipcMain.handle('getSettings', () => store.getSettings());
  ipcMain.handle('saveSettings', (event, settings) => { store.saveSettings(settings); return { ok: true }; });

  ipcMain.handle('getHistory', () => store.getHistory());
  ipcMain.handle('clearHistory', () => { store.clearHistory(); return { ok: true }; });

  ipcMain.handle('getPrompts', () => store.getPrompts());
  ipcMain.handle('savePrompts', (event, prompts) => { store.savePrompts(prompts); return { ok: true }; });
  ipcMain.handle('resetPrompts', () => { store.resetPrompts(); return { ok: true }; });
}

module.exports = { registerIpcHandlers };

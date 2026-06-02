importScripts('constants.js');

// Use onInstalled to setup the context menus. Always clear existing ones first.
chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "aiTextTools",
      title: "AI Text Tools",
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
  });
}

const ACTION_IDS = new Set(Object.keys(DEFAULT_PROMPTS));

let currentAbortController = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "cancelAI") {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const action = info.menuItemId;
  if (!ACTION_IDS.has(action) || !info.selectionText) return;
  await processTextWithAI(info.selectionText, tab, action);
});

// Keyboard shortcut handler
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fix_grammar" && command !== "fix_selected" && command !== "ai_prompt") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (e) {
    console.warn("Script injection failed:", e);
    return;
  }

  if (command === "fix_grammar") {
    const { autoSelectAll = false } = await chrome.storage.local.get("autoSelectAll");
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "getSelection", autoSelectAll });
      if (response && response.text && response.text.trim()) {
        await processTextWithAI(response.text, tab, "fixGrammar");
      }
    } catch (e) {
      console.warn("Could not get selection:", e);
    }
  } else if (command === "fix_selected") {
    // Always use only the manually selected text, ignoring autoSelectAll setting
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "getSelection", autoSelectAll: false });
      if (response && response.text && response.text.trim()) {
        await processTextWithAI(response.text, tab, "fixGrammar");
      }
    } catch (e) {
      console.warn("Could not get selection:", e);
    }
  } else if (command === "ai_prompt") {
    // Selected text is used as the raw AI prompt
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "getSelection", autoSelectAll: false });
      if (response && response.text && response.text.trim()) {
        await processTextWithAI(response.text, tab, "aiPrompt");
      }
    } catch (e) {
      console.warn("Could not get selection:", e);
    }
  }
});

async function processTextWithAI(originalText, tab, action) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (e) {
    console.warn("Script injection failed (expected on some system pages):", e);
  }

  const {
    aiProvider = "gemini",
    geminiApiKey,
    geminiModel,
    geminiFallbackModel,
    lmStudioUrl,
    lmStudioModel,
    includeContext = false
  } = await chrome.storage.local.get(["aiProvider", "geminiApiKey", "geminiModel", "geminiFallbackModel", "lmStudioUrl", "lmStudioModel", "includeContext"]);

  if (aiProvider !== "lmstudio" && !geminiApiKey) {
    chrome.tabs.sendMessage(tab.id, {
      action: "showToast",
      message: "Please set your Gemini API Key in the extension popup.",
      type: "error"
    }).catch(() => {});
    return;
  }

  const safeSendMessage = (tabId, message) => {
    chrome.tabs.sendMessage(tabId, message).catch(err => {
      console.warn("Message sending failed:", err);
    });
  };

  try {
    safeSendMessage(tab.id, { action: "showToast", message: "AI is working...", type: "working" });

    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    const t0 = Date.now();
    let result;
    const { history = [] } = await chrome.storage.local.get("history");
    const historyContext = includeContext ? history : [];

    if (aiProvider === "lmstudio") {
      result = await callLMStudioAI(
        originalText,
        lmStudioUrl || DEFAULT_LM_STUDIO_URL,
        lmStudioModel || "",
        action,
        historyContext,
        signal
      );
    } else {
      result = await callGeminiAI(
        originalText,
        geminiApiKey,
        action,
        geminiModel || DEFAULT_GEMINI_MODEL,
        geminiFallbackModel || "",
        historyContext,
        signal
      );
    }
    currentAbortController = null;
    const responseTimeMs = Date.now() - t0;
    const { text: fixedText, tokens } = result;

    if (!fixedText) {
      safeSendMessage(tab.id, { action: "showToast", message: "AI returned no usable text. Original text kept.", type: "error" });
      return;
    }

    const updatedHistory = [{
      timestamp: new Date().toISOString(),
      original: originalText,
      fixed: fixedText,
      action,
      tokens,
      responseTimeMs
    }, ...history].slice(0, 50);
    await chrome.storage.local.set({ history: updatedHistory });

    safeSendMessage(tab.id, { action: "replaceText", originalText, fixedText });
    safeSendMessage(tab.id, { action: "showToast", message: "Done!", type: "success" });
  } catch (error) {
    currentAbortController = null;
    if (error.name === "AbortError") {
      safeSendMessage(tab.id, { action: "showToast", message: "AI process cancelled.", type: "info" });
      return;
    }
    console.error("Gemini AI Error:", error);
    safeSendMessage(tab.id, { action: "showToast", message: "Error: " + error.message, type: "error" });
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

async function callGeminiAI(text, apiKey, action, primaryModel = DEFAULT_GEMINI_MODEL, fallbackModel = "", history = [], signal = null) {
  const { customPrompts = {} } = await chrome.storage.local.get("customPrompts");
  const template = customPrompts[action] || DEFAULT_PROMPTS[action] || DEFAULT_PROMPTS.fixGrammar;
  
  let prompt = "";
  if (action === "aiPrompt") {
    prompt = text;
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
    if (signal?.aborted) throw new Error("AbortError");
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        }),
        signal: signal || AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || response.statusText);
      }

      const data = await response.json();
      const aiResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!aiResponseText) throw new Error("No response from AI");
      const usage = data.usageMetadata || {};
      const tokens = {
        input: usage.promptTokenCount ?? null,
        output: usage.candidatesTokenCount ?? null,
        total: usage.totalTokenCount ?? null
      };
      return { text: stripSurroundingQuotes(aiResponseText.trim()), tokens };
    } catch (error) {
      lastError = error;
      console.warn(`Gemini model failed: ${model}`, error);
    }
  }

  if (modelsToTry.length > 1) {
    throw new Error(`Primary and fallback model failed. ${lastError?.message || "Unknown error"}`);
  }

  throw lastError || new Error("Gemini request failed");
}

async function callLMStudioAI(text, baseUrl, model, action, history = [], signal = null) {
  const { customPrompts = {} } = await chrome.storage.local.get("customPrompts");
  const template = customPrompts[action] || DEFAULT_PROMPTS[action] || DEFAULT_PROMPTS.fixGrammar;
  
  let prompt = "";
  if (action === "aiPrompt") {
    prompt = text;
  } else {
    if (history && history.length > 0) {
      const historyText = history.slice(0, 5).reverse().map(h => `Original: ${h.original}\nFixed: ${h.fixed}`).join("\n---\n");
      prompt = `Here is some context from previous requests:\n${historyText}\n\n---\n\n${template}\n\nText: "${text}"`;
    } else {
      prompt = `${template}\n\nText: "${text}"`;
    }
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      stream: false
    }),
    signal: signal || AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `LM Studio error: ${response.statusText}`);
  }

  const data = await response.json();
  const aiResponseText = data.choices?.[0]?.message?.content;
  if (!aiResponseText) throw new Error("No response from LM Studio");
  const usage = data.usage || {};
  const tokens = {
    input: usage.prompt_tokens ?? null,
    output: usage.completion_tokens ?? null,
    total: usage.total_tokens ?? null
  };
  return { text: stripSurroundingQuotes(aiResponseText.trim()), tokens };
}

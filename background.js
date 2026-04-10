importScripts('constants.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    createContextMenus();
  });
});

function createContextMenus() {
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
  chrome.contextMenus.create({ id: "toneFormal",     parentId: "changeTone", title: "Formal",     contexts: ["selection"] });
  chrome.contextMenus.create({ id: "toneCasual",     parentId: "changeTone", title: "Casual",     contexts: ["selection"] });
  chrome.contextMenus.create({ id: "toneEmpathetic", parentId: "changeTone", title: "Empathetic", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "toneEmojis",     parentId: "changeTone", title: "Add emojis", contexts: ["selection"] });

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
  chrome.contextMenus.create({ id: "translatePolish",    parentId: "translate", title: "To Polish",       contexts: ["selection"] });
  chrome.contextMenus.create({ id: "translateUkrainian", parentId: "translate", title: "To Ukrainian",    contexts: ["selection"] });
  chrome.contextMenus.create({ id: "translateEnglish",   parentId: "translate", title: "To English (US)", contexts: ["selection"] });

  chrome.contextMenus.create({ id: "sep4", parentId: "aiTextTools", type: "separator", contexts: ["selection"] });

  // 8. Format in Markdown
  chrome.contextMenus.create({ id: "formatMarkdown", parentId: "aiTextTools", title: "Format in Markdown",   contexts: ["selection"] });

  // 9. Format Slack message
  chrome.contextMenus.create({ id: "formatSlack",    parentId: "aiTextTools", title: "Format Slack message", contexts: ["selection"] });
}

const ACTION_IDS = new Set(Object.keys(DEFAULT_PROMPTS));

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const action = info.menuItemId;
  if (!ACTION_IDS.has(action) || !info.selectionText) return;
  await processTextWithAI(info.selectionText, tab, action);
});

// Keyboard shortcut handler
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fix_grammar") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (e) {
    console.warn("Script injection failed:", e);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "getSelection" });
    if (response && response.text && response.text.trim()) {
      await processTextWithAI(response.text, tab, "fixGrammar");
    }
  } catch (e) {
    console.warn("Could not get selection:", e);
  }
});

async function processTextWithAI(originalText, tab, action) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (e) {
    console.warn("Script injection failed (expected on some system pages):", e);
  }

  const {
    geminiApiKey,
    geminiModel,
    geminiFallbackModel
  } = await chrome.storage.local.get(["geminiApiKey", "geminiModel", "geminiFallbackModel"]);

  if (!geminiApiKey) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => alert("Please set your Gemini API Key in the extension popup.")
    });
    return;
  }

  const safeSendMessage = (tabId, message) => {
    chrome.tabs.sendMessage(tabId, message).catch(err => {
      console.warn("Message sending failed:", err);
    });
  };

  try {
    safeSendMessage(tab.id, { action: "showToast", message: "AI is working...", type: "working" });

    const fixedText = await callGeminiAI(
      originalText,
      geminiApiKey,
      action,
      geminiModel || DEFAULT_GEMINI_MODEL,
      geminiFallbackModel || ""
    );

    const { history = [] } = await chrome.storage.local.get("history");
    const newEntry = {
      timestamp: new Date().toISOString(),
      original: originalText,
      fixed: fixedText,
      action
    };
    const updatedHistory = [newEntry, ...history].slice(0, 50);
    await chrome.storage.local.set({ history: updatedHistory });

    safeSendMessage(tab.id, { action: "replaceText", originalText, fixedText });
    safeSendMessage(tab.id, { action: "showToast", message: "Done!", type: "success" });
  } catch (error) {
    console.error("Gemini AI Error:", error);
    safeSendMessage(tab.id, { action: "showToast", message: "Error: " + error.message, type: "error" });
  }
}

async function callGeminiAI(text, apiKey, action, primaryModel = DEFAULT_GEMINI_MODEL, fallbackModel = "") {
  const { customPrompts = {} } = await chrome.storage.local.get("customPrompts");
  const template = customPrompts[action] || DEFAULT_PROMPTS[action] || DEFAULT_PROMPTS.fixGrammar;
  const prompt = `${template}\n\nText: "${text}"`;
  const modelsToTry = [primaryModel];
  if (fallbackModel && fallbackModel !== primaryModel) {
    modelsToTry.push(fallbackModel);
  }

  let lastError;

  for (const model of modelsToTry) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || response.statusText);
      }

      const data = await response.json();
      const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!result) throw new Error("No response from AI");
      return result.trim();
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

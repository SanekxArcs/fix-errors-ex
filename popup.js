function showPopupToast(message, type = "success", duration = 3000) {
  const toast = document.getElementById("popup-toast");
  toast.textContent = message;
  toast.className = "show " + type;
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.className = toast.className.replace("show", "").trim();
  }, duration);
}

document.addEventListener("DOMContentLoaded", async () => {
  const settingsBtn = document.getElementById("view-settings-btn");
  const historyBtn = document.getElementById("view-history-btn");
  const shortcutsBtn = document.getElementById("view-shortcuts-btn");
  const promptsBtn = document.getElementById("view-prompts-btn");
  const settingsView = document.getElementById("settings-view");
  const historyView = document.getElementById("history-view");
  const shortcutsView = document.getElementById("shortcuts-view");
  const promptsView = document.getElementById("prompts-view");
  const providerSelect = document.getElementById("providerSelect");
  const geminiSection = document.getElementById("gemini-section");
  const lmstudioSection = document.getElementById("lmstudio-section");
  const apiKeyInput = document.getElementById("apiKey");
  const modelSelect = document.getElementById("modelSelect");
  const fallbackModelSelect = document.getElementById("fallbackModelSelect");
  const lmStudioUrlInput = document.getElementById("lmStudioUrl");
  const lmStudioModelInput = document.getElementById("lmStudioModel");
  const autoSelectAllCheckbox = document.getElementById("autoSelectAll");
  const includeContextCheckbox = document.getElementById("includeContext");
  const saveBtn = document.getElementById("save-btn");
  const historyList = document.getElementById("history-list");
  const clearHistoryBtn = document.getElementById("clear-history-btn");

  function applyProviderUI(provider) {
    if (provider === "lmstudio") {
      geminiSection.style.display = "none";
      lmstudioSection.style.display = "block";
    } else {
      geminiSection.style.display = "block";
      lmstudioSection.style.display = "none";
    }
  }

  providerSelect.addEventListener("change", () => applyProviderUI(providerSelect.value));

  function populateModelSelects() {
    modelSelect.innerHTML = "";
    fallbackModelSelect.innerHTML = "";

    GEMINI_MODELS.forEach(model => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      modelSelect.appendChild(option);
    });

    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "None";
    fallbackModelSelect.appendChild(noneOption);

    GEMINI_MODELS.forEach(model => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      fallbackModelSelect.appendChild(option);
    });
  }

  populateModelSelects();

  // Load API Key
  const {
    aiProvider,
    geminiApiKey,
    geminiModel,
    geminiFallbackModel,
    autoSelectAll,
    includeContext,
    lmStudioUrl,
    lmStudioModel
  } = await chrome.storage.local.get(["aiProvider", "geminiApiKey", "geminiModel", "geminiFallbackModel", "autoSelectAll", "includeContext", "lmStudioUrl", "lmStudioModel"]);

  providerSelect.value = aiProvider || "gemini";
  applyProviderUI(providerSelect.value);

  if (geminiApiKey) {
    apiKeyInput.value = geminiApiKey;
  }

  modelSelect.value = geminiModel || DEFAULT_GEMINI_MODEL;
  fallbackModelSelect.value = geminiFallbackModel || "";
  autoSelectAllCheckbox.checked = !!autoSelectAll;
  includeContextCheckbox.checked = !!includeContext;
  lmStudioUrlInput.value = lmStudioUrl || DEFAULT_LM_STUDIO_URL;
  lmStudioModelInput.value = lmStudioModel || "";

  function switchView(activeView, activeBtn) {
    [settingsView, historyView, shortcutsView, promptsView].forEach(v => v.classList.remove("active"));
    [settingsBtn, historyBtn, shortcutsBtn, promptsBtn].forEach(b => b.classList.remove("primary"));
    activeView.classList.add("active");
    activeBtn.classList.add("primary");
  }

  // Switch between views
  settingsBtn.addEventListener("click", () => switchView(settingsView, settingsBtn));

  historyBtn.addEventListener("click", () => {
    switchView(historyView, historyBtn);
    renderHistory();
  });

  shortcutsBtn.addEventListener("click", () => {
    switchView(shortcutsView, shortcutsBtn);
    loadShortcuts();
  });

  // Prompts view
  promptsBtn.addEventListener("click", () => {
    switchView(promptsView, promptsBtn);
    loadPrompts();
  });

  async function loadPrompts() {
    const promptsList = document.getElementById("prompts-list");
    const { customPrompts = {} } = await chrome.storage.local.get("customPrompts");
    promptsList.innerHTML = "";

    Object.entries(ACTION_LABELS).forEach(([id, label]) => {
      const item = document.createElement("div");
      item.className = "prompt-item";

      const lbl = document.createElement("label");
      lbl.setAttribute("for", `prompt-${id}`);
      lbl.textContent = label;

      const ta = document.createElement("textarea");
      ta.id = `prompt-${id}`;
      ta.rows = 4;
      ta.value = customPrompts[id] || DEFAULT_PROMPTS[id] || "";

      item.appendChild(lbl);
      item.appendChild(ta);
      promptsList.appendChild(item);
    });
  }

  document.getElementById("save-prompts-btn").addEventListener("click", async () => {
    const saved = {};
    Object.keys(ACTION_LABELS).forEach(id => {
      const ta = document.getElementById(`prompt-${id}`);
      if (ta) saved[id] = ta.value.trim();
    });
    await chrome.storage.local.set({ customPrompts: saved });
    const btn = document.getElementById("save-prompts-btn");
    const original = btn.textContent;
    btn.textContent = "Saved!";
    setTimeout(() => { btn.textContent = original; }, 1500);
  });

  document.getElementById("reset-prompts-btn").addEventListener("click", async () => {
    if (!confirm("Reset all prompts to defaults? Your custom prompts will be lost.")) return;
    await chrome.storage.local.remove("customPrompts");
    loadPrompts();
  });

  // Save API Key
  saveBtn.addEventListener("click", async () => {
    const provider = providerSelect.value;
    const key = apiKeyInput.value.trim();
    const selectedModel = modelSelect.value || DEFAULT_GEMINI_MODEL;
    const selectedFallbackModel = fallbackModelSelect.value;
    const autoSelectAll = autoSelectAllCheckbox.checked;
    const includeContext = includeContextCheckbox.checked;
    const lmUrl = lmStudioUrlInput.value.trim() || DEFAULT_LM_STUDIO_URL;
    const lmModel = lmStudioModelInput.value.trim();

    if (provider === "gemini" && !key) {
      showPopupToast("Please enter a valid Gemini API Key.", "error");
      return;
    }

    await chrome.storage.local.set({
      aiProvider: provider,
      geminiApiKey: key,
      geminiModel: selectedModel,
      geminiFallbackModel: selectedFallbackModel,
      autoSelectAll: autoSelectAll,
      includeContext: includeContext,
      lmStudioUrl: lmUrl,
      lmStudioModel: lmModel
    });
    showPopupToast("Settings saved!", "success");
  });

  // Clear History
  clearHistoryBtn.addEventListener("click", async () => {
    if (confirm("Are you sure you want to clear your history?")) {
      await chrome.storage.local.remove("history");
      renderHistory();
    }
  });

  // Load keyboard shortcut info
  async function loadShortcuts() {
    const commands = await chrome.commands.getAll();
    const fixCmd = commands.find(c => c.name === "fix_grammar");
    const fixSelCmd = commands.find(c => c.name === "fix_selected");
    const aiPromptCmd = commands.find(c => c.name === "ai_prompt");
    document.getElementById("shortcut-fix-grammar").textContent = fixCmd?.shortcut || "Not set";
    document.getElementById("shortcut-fix-selected").textContent = fixSelCmd?.shortcut || "Not set";
    document.getElementById("shortcut-ai-prompt").textContent = aiPromptCmd?.shortcut || "Not set";
  }

  // Function to render history
  async function renderHistory() {
    const { history = [] } = await chrome.storage.local.get("history");
    historyList.innerHTML = "";

    if (history.length === 0) {
      historyList.innerHTML = '<div class="empty-state">No history yet. Fix some text on any page!</div>';
      return;
    }

    history.forEach(item => {
      const container = document.createElement("div");
      container.className = "history-item";

      const originalText = document.createElement("div");
      originalText.className = "history-original";
      originalText.textContent = item.original;

      const fixedText = document.createElement("div");
      fixedText.className = "history-fixed";
      fixedText.textContent = item.fixed;

      const timestamp = document.createElement("span");
      timestamp.className = "history-timestamp";
      const actionLabel = ACTION_LABELS[item.action] || "Fix spelling & grammar";
      let meta = new Date(item.timestamp).toLocaleString() + " • " + actionLabel;
      if (item.responseTimeMs != null) {
        meta += " • " + (item.responseTimeMs / 1000).toFixed(2) + "s";
      }
      if (item.tokens?.total != null) {
        meta += " • " + item.tokens.total + " tokens";
        if (item.tokens.input != null && item.tokens.output != null) {
          meta += " (" + item.tokens.input + " in / " + item.tokens.output + " out)";
        }
      }
      timestamp.textContent = meta;

      const actions = document.createElement("div");
      actions.className = "history-actions";

      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.textContent = "Copy Result";
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(item.fixed).then(() => {
          copyBtn.textContent = "Copied!";
          copyBtn.classList.add("success");
          setTimeout(() => {
            copyBtn.textContent = "Copy Result";
            copyBtn.classList.remove("success");
          }, 2000);
        });
      };

      actions.appendChild(copyBtn);

      container.appendChild(originalText);
      container.appendChild(fixedText);
      container.appendChild(timestamp);
      container.appendChild(actions);

      historyList.appendChild(container);
    });
  }
});

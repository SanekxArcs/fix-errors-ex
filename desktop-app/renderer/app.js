// ─── Toast ──────────────────────────────────────────────────────────────────

function showToast(message, type = "info", options = {}) {
  const toast = document.getElementById("app-toast");
  toast.innerHTML = "";
  toast.className = "show " + type;

  const textSpan = document.createElement("span");
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (type === "working") {
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = async () => {
      await window.api.cancelRun();
      showToast("Cancelling...", "info");
    };
    toast.appendChild(cancelBtn);
  }

  if (options.onRetry) {
    const retryBtn = document.createElement("button");
    retryBtn.textContent = options.retryLabel || "↺ Retry";
    retryBtn.onclick = options.onRetry;
    toast.appendChild(retryBtn);
  }

  clearTimeout(toast._hideTimer);
  if (type !== "working" && !options.onRetry) {
    toast._hideTimer = setTimeout(() => { toast.className = toast.className.replace("show", "").trim(); }, 4000);
  }
}

// ─── Compose View ───────────────────────────────────────────────────────────

function initComposeView() {
  const actionSelect = document.getElementById("actionSelect");
  const runBtn = document.getElementById("run-btn");
  const cancelBtn = document.getElementById("cancel-btn");
  const inputText = document.getElementById("inputText");
  const outputText = document.getElementById("outputText");
  const copyResultBtn = document.getElementById("copy-result-btn");
  const contextField = document.getElementById("context-field");
  const contextInput = document.getElementById("contextInput");
  const modelPicker = document.getElementById("model-picker");
  const modelPickerList = document.getElementById("model-picker-list");

  Object.entries(ACTION_LABELS).forEach(([id, label]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    actionSelect.appendChild(option);
  });
  actionSelect.value = "fixGrammar";

  function updateContextVisibility() {
    contextField.style.display = actionSelect.value === "replyAssist" ? "block" : "none";
  }
  actionSelect.addEventListener("change", updateContextVisibility);
  updateContextVisibility();

  function setRunning(running) {
    runBtn.style.display = running ? "none" : "inline-block";
    cancelBtn.style.display = running ? "inline-block" : "none";
  }

  function hideModelPicker() {
    modelPicker.classList.remove("show");
    modelPickerList.innerHTML = "";
  }

  function handleResult(result, action, text, context) {
    if (result.ok) {
      outputText.value = result.text;
      hideModelPicker();
      showToast("Done!", "success");
      return;
    }

    if (result.retryable) {
      hideModelPicker();
      if (result.fallbackModel) {
        showToast(result.message, "error", {
          retryLabel: "↺ Retry",
          onRetry: async () => {
            setRunning(true);
            const retryResult = await window.api.retryWithModel(text, action, context, result.fallbackModel);
            setRunning(false);
            handleResult(retryResult, action, text, context);
          }
        });
      } else {
        showToast(result.message, "error", {
          retryLabel: "↺ Choose model",
          onRetry: () => showModelPicker(result.models, action, text, context)
        });
      }
      return;
    }

    showToast(result.message, "error");
  }

  function showModelPicker(models, action, text, context) {
    modelPickerList.innerHTML = "";
    models.forEach(m => {
      const btn = document.createElement("button");
      btn.textContent = m.label;
      btn.onclick = async () => {
        hideModelPicker();
        setRunning(true);
        showToast("AI is working...", "working");
        const result = await window.api.retryWithModel(text, action, context, m.id);
        setRunning(false);
        handleResult(result, action, text, context);
      };
      modelPickerList.appendChild(btn);
    });
    modelPicker.classList.add("show");
  }

  runBtn.addEventListener("click", async () => {
    const text = inputText.value.trim();
    if (!text) {
      showToast("Enter some text first.", "error");
      return;
    }
    const action = actionSelect.value;
    const context = contextInput.value.trim();

    hideModelPicker();
    setRunning(true);
    showToast("AI is working...", "working");

    const result = await window.api.runAction(text, action, context);
    setRunning(false);
    handleResult(result, action, text, context);
  });

  cancelBtn.addEventListener("click", async () => {
    await window.api.cancelRun();
    setRunning(false);
  });

  copyResultBtn.addEventListener("click", () => {
    if (!outputText.value) return;
    navigator.clipboard.writeText(outputText.value).then(() => {
      copyResultBtn.textContent = "Copied!";
      copyResultBtn.classList.add("success");
      setTimeout(() => {
        copyResultBtn.textContent = "Copy Result";
        copyResultBtn.classList.remove("success");
      }, 2000);
    });
  });
}

// ─── Settings View ──────────────────────────────────────────────────────────

function initSettingsView() {
  const providerSelect = document.getElementById("providerSelect");
  const geminiSection = document.getElementById("gemini-section");
  const lmstudioSection = document.getElementById("lmstudio-section");
  const apiKeyInput = document.getElementById("apiKey");
  const modelSelect = document.getElementById("modelSelect");
  const fallbackModelSelect = document.getElementById("fallbackModelSelect");
  const lmStudioUrlInput = document.getElementById("lmStudioUrl");
  const lmStudioModelInput = document.getElementById("lmStudioModel");
  const includeContextCheckbox = document.getElementById("includeContext");
  const saveBtn = document.getElementById("save-btn");

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

  async function loadSettings() {
    const settings = await window.api.getSettings();
    providerSelect.value = settings.aiProvider || "gemini";
    applyProviderUI(providerSelect.value);
    if (settings.geminiApiKey) apiKeyInput.value = settings.geminiApiKey;
    modelSelect.value = settings.geminiModel || DEFAULT_GEMINI_MODEL;
    fallbackModelSelect.value = settings.geminiFallbackModel || "";
    includeContextCheckbox.checked = !!settings.includeContext;
    lmStudioUrlInput.value = settings.lmStudioUrl || DEFAULT_LM_STUDIO_URL;
    lmStudioModelInput.value = settings.lmStudioModel || "";
  }

  saveBtn.addEventListener("click", async () => {
    const provider = providerSelect.value;
    const key = apiKeyInput.value.trim();

    if (provider === "gemini" && !key) {
      showToast("Please enter a valid Gemini API Key.", "error");
      return;
    }

    await window.api.saveSettings({
      aiProvider: provider,
      geminiApiKey: key,
      geminiModel: modelSelect.value || DEFAULT_GEMINI_MODEL,
      geminiFallbackModel: fallbackModelSelect.value,
      includeContext: includeContextCheckbox.checked,
      lmStudioUrl: lmStudioUrlInput.value.trim() || DEFAULT_LM_STUDIO_URL,
      lmStudioModel: lmStudioModelInput.value.trim()
    });
    showToast("Settings saved!", "success");
  });

  loadSettings();
}

// ─── History View ───────────────────────────────────────────────────────────

function formatDuration(totalMs) {
  const totalSeconds = totalMs / 1000;
  if (totalSeconds < 60) return totalSeconds.toFixed(1) + "s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return minutes + "m " + seconds + "s";
}

function updateHistoryStats(history, lifetimeStats) {
  const totalCount = lifetimeStats.count + history.length;
  const totalTimeMs = lifetimeStats.totalTimeMs + history.reduce((sum, item) => sum + (item.responseTimeMs || 0), 0);
  const totalTokens = lifetimeStats.totalTokens + history.reduce((sum, item) => sum + (item.tokens?.total || 0), 0);

  document.getElementById("stat-count").textContent = totalCount;
  document.getElementById("stat-time").textContent = formatDuration(totalTimeMs);
  document.getElementById("stat-tokens").textContent = totalTokens.toLocaleString();
}

async function renderHistory() {
  const historyList = document.getElementById("history-list");
  const { history, lifetimeStats } = await window.api.getHistory();
  historyList.innerHTML = "";
  updateHistoryStats(history, lifetimeStats);

  if (history.length === 0) {
    historyList.innerHTML = '<div class="empty-state">No history yet. Run an action in Compose!</div>';
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
    if (item.responseTimeMs != null) meta += " • " + (item.responseTimeMs / 1000).toFixed(2) + "s";
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
        setTimeout(() => { copyBtn.textContent = "Copy Result"; copyBtn.classList.remove("success"); }, 2000);
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

function initHistoryView() {
  document.getElementById("clear-history-btn").addEventListener("click", async () => {
    if (!confirm("Are you sure you want to clear your history?")) return;
    await window.api.clearHistory();
    renderHistory();
  });
}

// ─── Prompts View ───────────────────────────────────────────────────────────

async function loadPrompts() {
  const promptsList = document.getElementById("prompts-list");
  const customPrompts = await window.api.getPrompts();
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

function initPromptsView() {
  document.getElementById("save-prompts-btn").addEventListener("click", async () => {
    const saved = {};
    Object.keys(ACTION_LABELS).forEach(id => {
      const ta = document.getElementById(`prompt-${id}`);
      if (ta) saved[id] = ta.value.trim();
    });
    await window.api.savePrompts(saved);
    const btn = document.getElementById("save-prompts-btn");
    const original = btn.textContent;
    btn.textContent = "Saved!";
    setTimeout(() => { btn.textContent = original; }, 1500);
  });

  document.getElementById("reset-prompts-btn").addEventListener("click", async () => {
    if (!confirm("Reset all prompts to defaults? Your custom prompts will be lost.")) return;
    await window.api.resetPrompts();
    loadPrompts();
  });
}

// ─── Tab Switching ──────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const composeView = document.getElementById("compose-view");
  const settingsView = document.getElementById("settings-view");
  const historyView = document.getElementById("history-view");
  const promptsView = document.getElementById("prompts-view");

  const composeBtn = document.getElementById("view-compose-btn");
  const settingsBtn = document.getElementById("view-settings-btn");
  const historyBtn = document.getElementById("view-history-btn");
  const promptsBtn = document.getElementById("view-prompts-btn");

  function switchView(activeView, activeBtn) {
    [composeView, settingsView, historyView, promptsView].forEach(v => v.classList.remove("active"));
    [composeBtn, settingsBtn, historyBtn, promptsBtn].forEach(b => b.classList.remove("primary"));
    activeView.classList.add("active");
    activeBtn.classList.add("primary");
  }

  composeBtn.addEventListener("click", () => switchView(composeView, composeBtn));
  settingsBtn.addEventListener("click", () => switchView(settingsView, settingsBtn));
  historyBtn.addEventListener("click", () => { switchView(historyView, historyBtn); renderHistory(); });
  promptsBtn.addEventListener("click", () => { switchView(promptsView, promptsBtn); loadPrompts(); });

  initComposeView();
  initSettingsView();
  initHistoryView();
  initPromptsView();
});

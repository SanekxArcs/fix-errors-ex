// ─── Design system helpers ──────────────────────────────────────────────────

// Inline lucide icons (shadcn's icon set) so the renderer stays dependency-free.
const ICONS = {
  check: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  alert: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`,
  info: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  spinner: `<svg class="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
  rotate: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1.06 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`,
  copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
};

// Settings and prompts autosave, so text fields settle briefly before writing
// while dropdowns and toggles commit immediately. Hotkey fields save on change
// (blur/Enter) rather than per keystroke — a half-typed accelerator like
// "Shift+Al" would fail to register.
const SAVE_DEBOUNCE_MS = 400;

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Stands in for the old explicit Save buttons. It lives in the header so the
// confirmation is visible even when the panel below is scrolled.
function flashSaved() {
  const el = document.getElementById("save-indicator");
  el.innerHTML = ICONS.check + "<span>Saved</span>";
  el.hidden = false;
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

// ─── Toast ──────────────────────────────────────────────────────────────────

function showToast(message, type = "info", options = {}) {
  const toast = document.getElementById("app-toast");
  toast.innerHTML = "";
  toast.className = "show " + type;

  const icons = { working: ICONS.spinner, success: ICONS.check, error: ICONS.alert, info: ICONS.info };
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.innerHTML = icons[type] || icons.info;
  toast.appendChild(icon);

  const textSpan = document.createElement("span");
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (type === "working") {
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-ghost btn-sm";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = async () => {
      await window.api.cancelRun();
      showToast("Cancelling...", "info");
    };
    toast.appendChild(cancelBtn);
  }

  if (options.onRetry) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn btn-secondary btn-sm";
    retryBtn.innerHTML = ICONS.rotate + "<span>" + (options.retryLabel || "Retry") + "</span>";
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
    contextField.hidden = actionSelect.value !== "replyAssist";
  }
  actionSelect.addEventListener("change", updateContextVisibility);
  updateContextVisibility();

  function setRunning(running) {
    runBtn.hidden = running;
    cancelBtn.hidden = !running;
  }

  function hideModelPicker() {
    modelPicker.hidden = true;
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
          retryLabel: "Retry",
          onRetry: async () => {
            setRunning(true);
            const retryResult = await window.api.retryWithModel(text, action, context, result.fallbackModel);
            setRunning(false);
            handleResult(retryResult, action, text, context);
          }
        });
      } else {
        showToast(result.message, "error", {
          retryLabel: "Choose model",
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
    modelPicker.hidden = false;
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
      copyResultBtn.classList.add("is-success");
      setTimeout(() => {
        copyResultBtn.textContent = "Copy Result";
        copyResultBtn.classList.remove("is-success");
      }, 2000);
    });
  });

  window.api.onReplyAssist((payload) => {
    if (!payload?.selectedText) return;
    actionSelect.value = "replyAssist";
    updateContextVisibility();
    inputText.value = payload.selectedText;
    outputText.value = "";
    contextInput.value = "";
    hideModelPicker();
    setRunning(false);
    document.getElementById("view-compose-btn").click();
    contextInput.focus();
    showToast("Reply Assist is ready. Add context if needed, then press Run.", "info");
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
  const autoStartCheckbox = document.getElementById("autoStart");
  const globalHotkeyInput = document.getElementById("globalHotkey");
  const quickFixHotkeyInput = document.getElementById("quickFixHotkey");
  const translitHotkeyInput = document.getElementById("translitHotkey");
  const quickFixActionSelect = document.getElementById("quickFixAction");
  const apiKeyWarning = document.getElementById("api-key-warning");

  function applyProviderUI(provider) {
    if (provider === "lmstudio") {
      geminiSection.hidden = true;
      lmstudioSection.hidden = false;
    } else {
      geminiSection.hidden = false;
      lmstudioSection.hidden = true;
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

  function populateQuickFixActionSelect() {
    quickFixActionSelect.innerHTML = "";
    Object.entries(ACTION_LABELS).forEach(([id, label]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = label;
      quickFixActionSelect.appendChild(option);
    });
  }

  populateModelSelects();
  populateQuickFixActionSelect();

  async function loadSettings() {
    const settings = await window.api.getSettings();
    providerSelect.value = settings.aiProvider || "gemini";
    applyProviderUI(providerSelect.value);
    if (settings.geminiApiKey) apiKeyInput.value = settings.geminiApiKey;
    modelSelect.value = settings.geminiModel || DEFAULT_GEMINI_MODEL;
    fallbackModelSelect.value = settings.geminiFallbackModel || "";
    includeContextCheckbox.checked = !!settings.includeContext;
    autoStartCheckbox.checked = !!settings.autoStart;
    lmStudioUrlInput.value = settings.lmStudioUrl || DEFAULT_LM_STUDIO_URL;
    lmStudioModelInput.value = settings.lmStudioModel || "";
    globalHotkeyInput.value = settings.globalHotkey ?? "Control+Shift+F";
    quickFixHotkeyInput.value = settings.quickFixHotkey ?? "Shift+Alt+G";
    translitHotkeyInput.value = settings.translitHotkey ?? "Shift+Alt+L";
    quickFixActionSelect.value = settings.quickFixAction || "fixGrammar";
  }

  // There is no Save button to gate on a missing API key, so the field flags it
  // inline instead of blocking the write.
  function updateApiKeyWarning() {
    apiKeyWarning.hidden =
      providerSelect.value !== "gemini" || !!apiKeyInput.value.trim();
  }

  async function saveSettings() {
    const provider = providerSelect.value;
    const key = apiKeyInput.value.trim();
    updateApiKeyWarning();

    const result = await window.api.saveSettings({
      aiProvider: provider,
      geminiApiKey: key,
      geminiModel: modelSelect.value || DEFAULT_GEMINI_MODEL,
      geminiFallbackModel: fallbackModelSelect.value,
      includeContext: includeContextCheckbox.checked,
      lmStudioUrl: lmStudioUrlInput.value.trim() || DEFAULT_LM_STUDIO_URL,
      lmStudioModel: lmStudioModelInput.value.trim(),
      globalHotkey: globalHotkeyInput.value.trim(),
      quickFixHotkey: quickFixHotkeyInput.value.trim(),
      autoStart: autoStartCheckbox.checked,
      translitHotkey: translitHotkeyInput.value.trim(),
      quickFixAction: quickFixActionSelect.value
    });

    if (result.hotkeyOk === false && result.quickFixHotkeyOk === false && result.translitHotkeyOk === false) {
      showToast("Settings saved, but none of the hotkeys could be registered.", "error");
    } else if (result.hotkeyOk === false) {
      showToast("Settings saved, but the show/hide hotkey is already in use by another app.", "error");
    } else if (result.quickFixHotkeyOk === false) {
      showToast("Settings saved, but the Quick Fix hotkey is already in use (or matches the show/hide hotkey).", "error");
    } else if (result.translitHotkeyOk === false) {
      showToast("Settings saved, but the keyboard layout hotkey is already in use (or matches another hotkey).", "error");
    } else if (Object.values(result.promptHotkeyOk || {}).some(ok => ok === false)) {
      showToast("Settings saved, but one or more prompt hotkeys could not be registered. Check the Prompts tab.", "error");
    } else if (result.autoStartOk === false) {
      showToast("Settings saved, but Windows startup could not be updated.", "error");
    } else {
      flashSaved();
    }
  }

  const saveSettingsDebounced = debounce(saveSettings, SAVE_DEBOUNCE_MS);

  // Dropdowns and toggles commit at once. Hotkey fields use "change" so a
  // half-typed accelerator is never sent to the global-shortcut registrar.
  [providerSelect, modelSelect, fallbackModelSelect, includeContextCheckbox,
   autoStartCheckbox, quickFixActionSelect, globalHotkeyInput, quickFixHotkeyInput,
   translitHotkeyInput].forEach(el => {
    el.addEventListener("change", saveSettings);
  });

  [apiKeyInput, lmStudioUrlInput, lmStudioModelInput].forEach(el => {
    el.addEventListener("input", saveSettingsDebounced);
  });

  loadSettings().then(updateApiKeyWarning);
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
    historyList.innerHTML =
      '<div class="empty-state">' +
      '<strong>No edits yet</strong>' +
      '<span>Run an action in Compose and it will show up here.</span>' +
      '</div>';
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
    timestamp.className = "history-meta";
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
    copyBtn.type = "button";
    copyBtn.className = "btn btn-outline btn-sm";
    copyBtn.innerHTML = ICONS.copy + "<span>Copy result</span>";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(item.fixed).then(() => {
        copyBtn.innerHTML = ICONS.check + "<span>Copied</span>";
        copyBtn.classList.add("is-success");
        setTimeout(() => {
          copyBtn.innerHTML = ICONS.copy + "<span>Copy result</span>";
          copyBtn.classList.remove("is-success");
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
  const [customPrompts, promptHotkeys] = await Promise.all([
    window.api.getPrompts(),
    window.api.getPromptHotkeys()
  ]);
  promptsList.innerHTML = "";

  Object.entries(ACTION_LABELS).forEach(([id, label]) => {
    const item = document.createElement("div");
    item.className = "prompt-item";

    const header = document.createElement("div");
    header.className = "prompt-header";

    const lbl = document.createElement("label");
    lbl.className = "label";
    lbl.setAttribute("for", `prompt-${id}`);
    lbl.textContent = label;

    const hotkeyInput = document.createElement("input");
    hotkeyInput.type = "text";
    hotkeyInput.id = `prompt-hotkey-${id}`;
    hotkeyInput.className = "input input-mono prompt-hotkey";
    hotkeyInput.placeholder = "Shortcut (optional)";
    hotkeyInput.value = promptHotkeys[id] || "";
    hotkeyInput.title = "Optional global Electron shortcut, for example Control+Alt+1";
    hotkeyInput.addEventListener("change", savePrompts);

    header.appendChild(lbl);
    header.appendChild(hotkeyInput);

    const ta = document.createElement("textarea");
    ta.id = `prompt-${id}`;
    ta.className = "textarea";
    ta.rows = 4;
    ta.value = customPrompts[id] || DEFAULT_PROMPTS[id] || "";
    ta.addEventListener("input", savePromptsDebounced);

    item.appendChild(header);
    item.appendChild(ta);
    promptsList.appendChild(item);
  });
}

async function savePrompts() {
  const saved = {};
  const savedHotkeys = {};
  Object.keys(ACTION_LABELS).forEach(id => {
    const ta = document.getElementById(`prompt-${id}`);
    if (ta) saved[id] = ta.value.trim();
    const hotkey = document.getElementById(`prompt-hotkey-${id}`);
    if (hotkey) savedHotkeys[id] = hotkey.value.trim();
  });
  const result = await window.api.savePrompts(saved, savedHotkeys);
  if (Object.values(result.promptHotkeyOk || {}).some(ok => ok === false)) {
    showToast("Prompts saved, but one or more shortcuts could not be registered.", "error");
  } else {
    flashSaved();
  }
}

const savePromptsDebounced = debounce(savePrompts, SAVE_DEBOUNCE_MS);

function initPromptsView() {
  document.getElementById("reset-prompts-btn").addEventListener("click", async () => {
    if (!confirm("Reset all prompts to defaults? Your custom prompts will be lost.")) return;
    await window.api.resetPrompts();
    await loadPrompts();
    flashSaved();
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
    [composeView, settingsView, historyView, promptsView].forEach(v => {
      v.removeAttribute("data-state");
    });
    [composeBtn, settingsBtn, historyBtn, promptsBtn].forEach(b => {
      b.removeAttribute("data-state");
      b.removeAttribute("aria-selected");
    });
    activeView.setAttribute("data-state", "active");
    activeBtn.setAttribute("data-state", "active");
    activeBtn.setAttribute("aria-selected", "true");
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

// Inline lucide icons (shadcn's icon set) so the popup stays dependency-free.
const ICONS = {
  eye: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`,
  copy: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  check: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`
};

// Settings and prompts autosave, so text fields settle briefly before writing
// while dropdowns and toggles commit immediately.
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
  document.getElementById("app-version").textContent =
    "v" + chrome.runtime.getManifest().version;

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
  const apiKeyWarning = document.getElementById("api-key-warning");
  const historyList = document.getElementById("history-list");
  const clearHistoryBtn = document.getElementById("clear-history-btn");

  function applyProviderUI(provider) {
    const useLmStudio = provider === "lmstudio";
    geminiSection.hidden = useLmStudio;
    lmstudioSection.hidden = !useLmStudio;
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

  // Tabs follow the shadcn/Radix convention: the active panel and trigger carry
  // data-state="active"; the stylesheet keys off that attribute.
  function switchView(activeView, activeBtn) {
    [settingsView, historyView, shortcutsView, promptsView].forEach(v => {
      v.removeAttribute("data-state");
    });
    [settingsBtn, historyBtn, shortcutsBtn, promptsBtn].forEach(b => {
      b.removeAttribute("data-state");
      b.removeAttribute("aria-selected");
    });
    activeView.setAttribute("data-state", "active");
    activeBtn.setAttribute("data-state", "active");
    activeBtn.setAttribute("aria-selected", "true");
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
      lbl.className = "label";
      lbl.setAttribute("for", `prompt-${id}`);
      lbl.textContent = label;

      const ta = document.createElement("textarea");
      ta.id = `prompt-${id}`;
      ta.className = "textarea";
      ta.rows = 4;
      ta.value = customPrompts[id] || DEFAULT_PROMPTS[id] || "";
      ta.addEventListener("input", savePromptsDebounced);

      item.appendChild(lbl);
      item.appendChild(ta);
      promptsList.appendChild(item);
    });
  }

  async function savePrompts() {
    const saved = {};
    Object.keys(ACTION_LABELS).forEach(id => {
      const ta = document.getElementById(`prompt-${id}`);
      if (ta) saved[id] = ta.value.trim();
    });
    await chrome.storage.local.set({ customPrompts: saved });
    flashSaved();
  }

  const savePromptsDebounced = debounce(savePrompts, SAVE_DEBOUNCE_MS);

  document.getElementById("reset-prompts-btn").addEventListener("click", async () => {
    if (!confirm("Reset all prompts to defaults? Your custom prompts will be lost.")) return;
    await chrome.storage.local.remove("customPrompts");
    await loadPrompts();
    flashSaved();
  });

  // Toggle API Key visibility
  const toggleApiKeyBtn = document.getElementById("toggle-api-key-btn");
  toggleApiKeyBtn.addEventListener("click", () => {
    const isHidden = apiKeyInput.type === "password";
    apiKeyInput.type = isHidden ? "text" : "password";
    toggleApiKeyBtn.innerHTML = isHidden ? ICONS.eyeOff : ICONS.eye;
    const label = isHidden ? "Hide API key" : "Show API key";
    toggleApiKeyBtn.title = label;
    toggleApiKeyBtn.setAttribute("aria-label", label);
  });

  // Copy API Key
  const copyApiKeyBtn = document.getElementById("copy-api-key-btn");
  copyApiKeyBtn.addEventListener("click", async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showPopupToast("No API key to copy.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(key);
      copyApiKeyBtn.classList.add("is-success");
      copyApiKeyBtn.innerHTML = ICONS.check;
      setTimeout(() => {
        copyApiKeyBtn.classList.remove("is-success");
        copyApiKeyBtn.innerHTML = ICONS.copy;
      }, 1500);
      showPopupToast("API key copied!", "success");
    } catch {
      showPopupToast("Failed to copy API key.", "error");
    }
  });

  // Settings autosave. There's no Save button to gate on a missing API key, so
  // the field flags it inline instead of blocking the write.
  function updateApiKeyWarning() {
    apiKeyWarning.hidden =
      providerSelect.value !== "gemini" || !!apiKeyInput.value.trim();
  }

  async function saveSettings() {
    await chrome.storage.local.set({
      aiProvider: providerSelect.value,
      geminiApiKey: apiKeyInput.value.trim(),
      geminiModel: modelSelect.value || DEFAULT_GEMINI_MODEL,
      geminiFallbackModel: fallbackModelSelect.value,
      autoSelectAll: autoSelectAllCheckbox.checked,
      includeContext: includeContextCheckbox.checked,
      lmStudioUrl: lmStudioUrlInput.value.trim() || DEFAULT_LM_STUDIO_URL,
      lmStudioModel: lmStudioModelInput.value.trim()
    });
    updateApiKeyWarning();
    flashSaved();
  }

  const saveSettingsDebounced = debounce(saveSettings, SAVE_DEBOUNCE_MS);

  [providerSelect, modelSelect, fallbackModelSelect, autoSelectAllCheckbox, includeContextCheckbox]
    .forEach(el => {
      el.addEventListener("change", saveSettings);
    });

  [apiKeyInput, lmStudioUrlInput, lmStudioModelInput].forEach(el => {
    el.addEventListener("input", saveSettingsDebounced);
  });

  updateApiKeyWarning();

  // Clear History — fold the cleared entries into lifetimeStats first so the
  // all-time totals never lose data just because the detail view was wiped.
  clearHistoryBtn.addEventListener("click", async () => {
    if (confirm("Are you sure you want to clear your history?")) {
      const {
        history = [],
        lifetimeStats = { count: 0, totalTimeMs: 0, totalTokens: 0 }
      } = await chrome.storage.local.get(["history", "lifetimeStats"]);

      for (const item of history) {
        lifetimeStats.count += 1;
        lifetimeStats.totalTimeMs += item.responseTimeMs || 0;
        lifetimeStats.totalTokens += item.tokens?.total || 0;
      }

      await chrome.storage.local.set({ lifetimeStats });
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

  function formatDuration(totalMs) {
    const totalSeconds = totalMs / 1000;
    if (totalSeconds < 60) return totalSeconds.toFixed(1) + "s";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    return minutes + "m " + seconds + "s";
  }

  // All-time stats include lifetimeStats (folded in once entries age out of the
  // 50-item history) plus whatever is still sitting in the detailed history.
  function updateHistoryStats(history, lifetimeStats) {
    const statCount = document.getElementById("stat-count");
    const statTime = document.getElementById("stat-time");
    const statTokens = document.getElementById("stat-tokens");

    const totalCount = lifetimeStats.count + history.length;
    const totalTimeMs = lifetimeStats.totalTimeMs + history.reduce((sum, item) => sum + (item.responseTimeMs || 0), 0);
    const totalTokens = lifetimeStats.totalTokens + history.reduce((sum, item) => sum + (item.tokens?.total || 0), 0);

    statCount.textContent = totalCount;
    statTime.textContent = formatDuration(totalTimeMs);
    statTokens.textContent = totalTokens.toLocaleString();
  }

  // Function to render history
  async function renderHistory() {
    const {
      history = [],
      lifetimeStats = { count: 0, totalTimeMs: 0, totalTokens: 0 }
    } = await chrome.storage.local.get(["history", "lifetimeStats"]);
    historyList.innerHTML = "";
    updateHistoryStats(history, lifetimeStats);

    if (history.length === 0) {
      historyList.innerHTML =
        '<div class="empty-state">' +
        '<strong>No edits yet</strong>' +
        '<span>Select text on any page and run an AI action to see it here.</span>' +
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
});

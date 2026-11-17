// Inline lucide icons (shadcn's icon set) so the popup stays dependency-free.
const ICONS = {
  eye: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`,
  copy: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  check: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`
};

// Unique ids for history cards (aria-controls), unique across re-renders.
let historyItemSeq = 0;

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
  let toast = document.getElementById("popup-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "popup-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = "show " + type;
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.remove();
  }, duration);
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("app-version").textContent =
    "v" + chrome.runtime.getManifest().version;

  const settingsBtn = document.getElementById("view-settings-btn");
  const historyBtn = document.getElementById("view-history-btn");
  const promptsBtn = document.getElementById("view-prompts-btn");
  const mistakesBtn = document.getElementById("view-mistakes-btn");
  const mistakesView = document.getElementById("mistakes-view");
  const settingsView = document.getElementById("settings-view");
  const historyView = document.getElementById("history-view");
  const promptsView = document.getElementById("prompts-view");
  const providerSelect = document.getElementById("providerSelect");
  const geminiSection = document.getElementById("gemini-section");
  const lmstudioSection = document.getElementById("lmstudio-section");
  const apiKeyInput = document.getElementById("apiKey");
  const modelSelect = document.getElementById("modelSelect");
  const fallbackModelSelect = document.getElementById("fallbackModelSelect");
  const fallbackProviderSelect = document.getElementById("fallbackProviderSelect");
  const fallbackLmStudioUrlInput = document.getElementById("fallbackLmStudioUrl");
  const fallbackLmStudioModelInput = document.getElementById("fallbackLmStudioModel");
  const lmStudioUrlInput = document.getElementById("lmStudioUrl");
  const lmStudioModelInput = document.getElementById("lmStudioModel");
  const autoSelectAllCheckbox = document.getElementById("autoSelectAll");
  const apiKeyWarning = document.getElementById("api-key-warning");
  const historyList = document.getElementById("history-list");
  const clearHistoryBtn = document.getElementById("clear-history-btn");

  function applyProviderUI(provider) {
    const useLmStudio = provider === "lmstudio";
    geminiSection.hidden = useLmStudio && fallbackProviderSelect.value !== "gemini";
    document.getElementById("gemini-model-field").hidden = useLmStudio;
    lmstudioSection.hidden = !useLmStudio;
    document.getElementById("fallback-gemini-section").hidden = fallbackProviderSelect.value !== "gemini";
    document.getElementById("fallback-lmstudio-section").hidden = fallbackProviderSelect.value !== "lmstudio";
    setDisclosureValue("fallback-summary-value", { none: "None", gemini: "Gemini", lmstudio: "LM Studio" }[fallbackProviderSelect.value] || "None");
  }

  // UI only: the muted value chip shown in a collapsed Advanced disclosure.
  function setDisclosureValue(id, text, warning = false) {
    const chip = document.getElementById(id);
    if (!chip) return;
    chip.textContent = text;
    chip.title = text; // the chip ellipsizes, so keep the full value on hover
    if (warning) chip.dataset.tone = "warning";
    else delete chip.dataset.tone;
  }

  providerSelect.addEventListener("change", () => applyProviderUI(providerSelect.value));
  fallbackProviderSelect.addEventListener("change", () => applyProviderUI(providerSelect.value));

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
    noneOption.textContent = "Choose a model";
    noneOption.disabled = true;
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
    fallbackProvider,
    fallbackLmStudioUrl,
    fallbackLmStudioModel,
    autoSelectAll,
    lmStudioUrl,
    lmStudioModel
  } = await chrome.storage.local.get(["aiProvider", "geminiApiKey", "geminiModel", "geminiFallbackModel", "fallbackProvider", "fallbackLmStudioUrl", "fallbackLmStudioModel", "autoSelectAll", "lmStudioUrl", "lmStudioModel"]);

  providerSelect.value = aiProvider || "gemini";
  applyProviderUI(providerSelect.value);

  if (geminiApiKey) {
    apiKeyInput.value = geminiApiKey;
  }

  for (const [select, savedModel] of [[modelSelect, geminiModel], [fallbackModelSelect, geminiFallbackModel]]) {
    if (savedModel && !Array.from(select.options).some(option => option.value === savedModel)) {
      const option = document.createElement("option");
      option.value = savedModel; option.textContent = `${savedModel} (saved)`;
      select.appendChild(option);
    }
  }
  modelSelect.value = geminiModel || DEFAULT_GEMINI_MODEL;
  fallbackModelSelect.value = geminiFallbackModel || DEFAULT_GEMINI_MODEL;
  fallbackProviderSelect.value = fallbackProvider || (geminiFallbackModel ? "gemini" : "none");
  fallbackLmStudioUrlInput.value = fallbackLmStudioUrl || lmStudioUrl || DEFAULT_LM_STUDIO_URL;
  fallbackLmStudioModelInput.value = fallbackLmStudioModel || "";
  applyProviderUI(providerSelect.value);
  // Initial disclosure state, set once: never collapse a configured fallback.
  document.getElementById("fallback-disclosure").open = fallbackProviderSelect.value !== "none";
  autoSelectAllCheckbox.checked = !!autoSelectAll;
  lmStudioUrlInput.value = lmStudioUrl || DEFAULT_LM_STUDIO_URL;
  lmStudioModelInput.value = lmStudioModel || "";

  const limitsSelect = document.getElementById("limits-model");
  const limitsFields = ["rpm", "tpm", "rpd", "tpd", "maxInputTokens", "maxOutputTokens"];
  const limitsError = document.getElementById("limits-error");
  const limitsEnabled = document.getElementById("model-limits-enabled");
  let limitsLoadId = 0;

  async function loadAutomaticTokenLimits(key, loadId) {
    const status = document.getElementById("limits-automatic");
    if (!key.startsWith("gemini:")) {
      status.textContent = "Local models use the context window configured in LM Studio.";
      return;
    }
    if (!apiKeyInput.value.trim()) {
      status.textContent = "Add your Gemini API key to load model input/output limits automatically.";
      return;
    }
    status.textContent = "Loading this model's input/output limits…";
    try {
      const result = await chrome.runtime.sendMessage({ action: "getModelTokenLimits", model: key.slice(7) });
      if (loadId !== limitsLoadId || key !== limitsSelect.value) return;
      if (!result?.ok) throw new Error(result?.error || "Could not load model token limits.");
      status.textContent = `Automatic model limits: ${result.inputTokenLimit.toLocaleString()} input tokens · ${result.outputTokenLimit.toLocaleString()} output tokens.`;
      for (const [field, value] of [["maxInputTokens", result.inputTokenLimit], ["maxOutputTokens", result.outputTokenLimit]]) {
        const input = document.getElementById(`limit-${field}`);
        if (input.value === "") input.value = value;
      }
    } catch (error) {
      if (loadId === limitsLoadId && key === limitsSelect.value) status.textContent = error.message || "Could not load model token limits.";
    }
  }

  async function renderModelLimits() {
    const loadId = ++limitsLoadId;
    const key = limitsSelect.value;
    const local = key.startsWith("lmstudio:");
    document.getElementById("limits-help").hidden = local;
    document.getElementById("limits-local-help").hidden = !local;
    const settings = await chrome.storage.local.get(["modelLimits", "modelUsage", "modelLimitsEnabled"]);
    const { modelLimits = {}, modelUsage = {} } = settings;
    if (loadId !== limitsLoadId || limitsSelect.value !== key) return;
    const profile = modelLimits[key];
    limitsEnabled.checked = modelBudgetsEnabled(settings);
    document.getElementById("limits-custom-fields").hidden = !limitsEnabled.checked;
    document.getElementById("save-model-limits").hidden = !limitsEnabled.checked;
    setDisclosureValue("limits-summary-value", !limitsEnabled.checked ? "Off" : profile ? "On" : "On · not set", limitsEnabled.checked && !profile);
    limitsFields.forEach(field => {
      const input = document.getElementById(`limit-${field}`);
      input.value = profile?.[field] ?? "";
      input.disabled = !limitsEnabled.checked;
    });
    limitsError.hidden = true;
    const usage = currentModelUsage(modelUsage[key]);
    const tokensMinute = usage.entries.reduce((sum, entry) => sum + entry.tokens, 0);
    document.getElementById("limits-usage").textContent =
      `${!limitsEnabled.checked ? "Custom budgets off — no setup required." : profile ? "Budget saved." : "Budget not configured — requests are blocked while enabled."} ` +
      `This minute: ${usage.entries.length} requests · ${tokensMinute.toLocaleString()} input tokens. ` +
      `Today: ${usage.requestsDay} requests · ${usage.tokensDay.toLocaleString()} input tokens.` +
      (usage.cooldownUntil > Date.now() ? ` Cooling down for ${Math.ceil((usage.cooldownUntil - Date.now()) / 1000)} seconds.` : "");
    void loadAutomaticTokenLimits(key, loadId);
  }

  async function populateLimitModels() {
    const previousKey = limitsSelect.value;
    limitsSelect.replaceChildren();
    const local = providerSelect.value === "lmstudio";
    for (const option of modelSelect.options) {
      limitsSelect.add(new Option(option.textContent, modelLimitKey("gemini", option.value)));
    }
    for (const option of fallbackModelSelect.options) {
      if (option.value && !Array.from(limitsSelect.options).some(item => item.value === modelLimitKey("gemini", option.value))) {
        limitsSelect.add(new Option(option.textContent, modelLimitKey("gemini", option.value)));
      }
    }
    const addLocalModel = (modelInput, urlInput, label) => {
      const model = modelInput.value.trim();
      const key = modelLimitKey("lmstudio", model, urlInput.value.trim() || DEFAULT_LM_STUDIO_URL);
      if (!Array.from(limitsSelect.options).some(option => option.value === key)) limitsSelect.add(new Option(`${label}: ${model || "server default"}`, key));
    };
    if (local) addLocalModel(lmStudioModelInput, lmStudioUrlInput, "LM Studio");
    if (fallbackProviderSelect.value === "lmstudio") addLocalModel(fallbackLmStudioModelInput, fallbackLmStudioUrlInput, "LM Studio fallback");
    const preferredKey = modelLimitKey(providerSelect.value, local ? lmStudioModelInput.value.trim() : modelSelect.value, lmStudioUrlInput.value.trim() || DEFAULT_LM_STUDIO_URL);
    limitsSelect.value = Array.from(limitsSelect.options).some(option => option.value === previousKey) ? previousKey : preferredKey;
    await renderModelLimits();
  }

  limitsSelect.addEventListener("change", renderModelLimits);
  apiKeyInput.addEventListener("change", () => loadAutomaticTokenLimits(limitsSelect.value, limitsLoadId));
  limitsEnabled.addEventListener("change", async () => {
    const previous = !limitsEnabled.checked;
    limitsEnabled.disabled = true;
    try {
      await chrome.storage.local.set({ modelLimitsEnabled: limitsEnabled.checked });
      await renderModelLimits();
      flashSaved();
    } catch {
      limitsEnabled.checked = previous;
      limitsError.textContent = "Could not save the budget switch. Please try again.";
      limitsError.hidden = false;
    } finally {
      limitsEnabled.disabled = false;
    }
  });
  [providerSelect, fallbackProviderSelect, modelSelect, fallbackModelSelect, lmStudioUrlInput, lmStudioModelInput, fallbackLmStudioUrlInput, fallbackLmStudioModelInput].forEach(input => input.addEventListener("change", populateLimitModels));
  document.getElementById("model-limits-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!limitsEnabled.checked) return;
    const key = limitsSelect.value;
    const profile = {};
    for (const field of limitsFields) {
      const input = document.getElementById(`limit-${field}`);
      const value = input.value === "" && field === "tpd" ? 0 : Number(input.value);
      if (!Number.isSafeInteger(value) || value < (field === "tpd" ? 0 : 1)) {
        limitsError.textContent = "Enter positive whole numbers. Daily input tokens can be blank or zero.";
        limitsError.hidden = false;
        input.focus();
        return;
      }
      profile[field] = value;
    }
    try {
      const { modelLimits = {} } = await chrome.storage.local.get("modelLimits");
      modelLimits[key] = profile;
      await chrome.storage.local.set({ modelLimits });
      flashSaved();
      await renderModelLimits();
    } catch {
      limitsError.textContent = "Could not save the limits. Please try again.";
      limitsError.hidden = false;
    }
  });
  await populateLimitModels();
  // Set once after the first render: enabled budgets stay visible so the
  // "requests are blocked" warning is never hidden behind a collapsed card.
  document.getElementById("limits-disclosure").open = limitsEnabled.checked;

  // Tabs follow the shadcn/Radix convention: the active panel and trigger carry
  // data-state="active"; the stylesheet keys off that attribute.
  function switchView(activeView, activeBtn) {
    [settingsView, historyView, mistakesView, promptsView].forEach(v => {
      v.removeAttribute("data-state");
    });
    [settingsBtn, historyBtn, mistakesBtn, promptsBtn].forEach(b => {
      b.removeAttribute("data-state");
      b.setAttribute("aria-selected", "false");
      b.tabIndex = -1;
    });
    activeView.setAttribute("data-state", "active");
    activeBtn.setAttribute("data-state", "active");
    activeBtn.setAttribute("aria-selected", "true");
    activeBtn.tabIndex = 0;
  }

  // WAI-ARIA tabs keyboard pattern: arrows (wrapping), Home and End move
  // focus and activate the tab. DOM order, not the switchView order above.
  const tabOrder = [settingsBtn, historyBtn, mistakesBtn, promptsBtn];
  document.querySelector(".tabs-list").addEventListener("keydown", (e) => {
    const current = tabOrder.indexOf(document.activeElement);
    if (current === -1) return;
    let next;
    if (e.key === "ArrowRight") next = (current + 1) % tabOrder.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + tabOrder.length) % tabOrder.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabOrder.length - 1;
    else return;
    const target = tabOrder[next];
    target.focus();
    target.click();
    e.preventDefault();
  });

  // Switch between views
  settingsBtn.addEventListener("click", () => switchView(settingsView, settingsBtn));

  historyBtn.addEventListener("click", () => {
    switchView(historyView, historyBtn);
    renderHistory();
  });

  mistakesBtn.addEventListener("click", () => {
    switchView(mistakesView, mistakesBtn);
    renderMistakes();
  });

  // Prompts view
  promptsBtn.addEventListener("click", () => {
    switchView(promptsView, promptsBtn);
    loadPrompts();
  });

  // Actions that never use a prompt template: translit runs locally and
  // aiPrompt sends the selection itself as the prompt. They get a note, not
  // an editor, and their stored values (if any) are left untouched.
  const NO_PROMPT_ACTIONS = {
    translit: "Works offline — swaps characters typed in the wrong keyboard layout. No AI prompt involved.",
    aiPrompt: "Your selected text is sent to the AI as the prompt."
  };
  const EDITABLE_PROMPT_IDS = Object.keys(ACTION_LABELS).filter(id => !(id in NO_PROMPT_ACTIONS));
  const PROMPT_SAVE_DELAY = 400;
  const resetPromptsBtn = document.getElementById("reset-prompts-btn");
  let promptSaveTimer = null;
  let promptSaveChain = Promise.resolve();

  const defaultPrompt = id => DEFAULT_PROMPTS[id] || "";
  // Empty means "use the default" (it is restored on blur), so it never counts
  // as a customisation and is never stored.
  const isCustomPrompt = (id, value) => {
    const v = value.trim();
    return v !== "" && v !== defaultPrompt(id).trim();
  };

  // Grow to fit the content; CSS caps it (max-height), then it scrolls.
  function autosizePrompt(ta) {
    ta.style.height = "auto";
    const border = ta.offsetHeight - ta.clientHeight;
    ta.style.height = `${ta.scrollHeight + border}px`;
    const max = parseFloat(getComputedStyle(ta).maxHeight);
    ta.style.overflowY = ta.scrollHeight + border > max ? "auto" : "hidden";
  }

  function updatePromptState(id) {
    const ta = document.getElementById(`prompt-${id}`);
    if (!ta) return;
    const custom = isCustomPrompt(id, ta.value);
    const item = ta.closest(".prompt-item");
    item.querySelector(".prompt-badge").hidden = !custom;
    item.querySelector(".prompt-reset").hidden = !custom;
  }

  function updatePromptsSummary() {
    const count = EDITABLE_PROMPT_IDS.filter(id => {
      const ta = document.getElementById(`prompt-${id}`);
      return ta && isCustomPrompt(id, ta.value);
    }).length;
    resetPromptsBtn.disabled = count === 0;
    document.getElementById("prompts-custom-status").textContent =
      count === 0 ? "All prompts use defaults" : `${count} customized prompt${count === 1 ? "" : "s"}`;
  }

  function showPromptNote(item, text) {
    // The live region stays rendered (collapsed while empty) so setting its
    // text is announced.
    const note = item.querySelector(".prompt-note");
    note.textContent = text;
    clearTimeout(note._hideTimer);
    note._hideTimer = setTimeout(() => { note.textContent = ""; }, 3000);
  }

  function schedulePromptSave() {
    clearTimeout(promptSaveTimer);
    promptSaveTimer = setTimeout(flushPromptSave, PROMPT_SAVE_DELAY);
  }

  // Runs a pending save now (blur, popup closing). No-op when nothing is pending.
  function flushPromptSave() {
    if (promptSaveTimer === null) return promptSaveChain;
    clearTimeout(promptSaveTimer);
    promptSaveTimer = null;
    promptSaveChain = promptSaveChain.then(savePrompts, savePrompts);
    return promptSaveChain;
  }

  async function loadPrompts() {
    // Don't let a pending edit be overwritten by a re-render from storage.
    await flushPromptSave();
    const promptsList = document.getElementById("prompts-list");
    const { customPrompts = {} } = await chrome.storage.local.get("customPrompts");
    promptsList.innerHTML = "";

    EDITABLE_PROMPT_IDS.forEach(id => {
      const label = ACTION_LABELS[id];
      const item = document.createElement("div");
      item.className = "prompt-item";

      const head = document.createElement("div");
      head.className = "prompt-head";

      const lbl = document.createElement("label");
      lbl.className = "label prompt-label";
      lbl.setAttribute("for", `prompt-${id}`);
      lbl.textContent = label;

      const badge = document.createElement("span");
      badge.className = "badge badge-secondary prompt-badge";
      badge.textContent = "Customized";
      badge.hidden = true;

      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "btn btn-ghost btn-sm prompt-reset";
      reset.textContent = "Reset";
      reset.setAttribute("aria-label", `Reset ${label} to default`);
      reset.hidden = true;

      const ta = document.createElement("textarea");
      ta.id = `prompt-${id}`;
      ta.className = "textarea prompt-textarea";
      ta.rows = 3;
      ta.spellcheck = false;
      ta.value = customPrompts[id] || defaultPrompt(id);

      const note = document.createElement("p");
      note.className = "prompt-note";
      note.setAttribute("role", "status");

      ta.addEventListener("input", () => {
        autosizePrompt(ta);
        updatePromptState(id);
        updatePromptsSummary();
        schedulePromptSave();
      });
      ta.addEventListener("blur", () => {
        if (ta.value.trim() === "") {
          ta.value = defaultPrompt(id);
          autosizePrompt(ta);
          updatePromptState(id);
          updatePromptsSummary();
          showPromptNote(item, "Empty prompt restored to default.");
          schedulePromptSave();
        }
        flushPromptSave();
      });
      reset.addEventListener("click", () => {
        ta.value = defaultPrompt(id);
        autosizePrompt(ta);
        updatePromptState(id);
        updatePromptsSummary();
        schedulePromptSave();
        flushPromptSave();
        // The button hides itself; keep focus inside the card.
        ta.focus();
        showPromptNote(item, "Restored to default.");
      });

      head.append(lbl, badge, reset);
      item.append(head, ta, note);
      promptsList.appendChild(item);
      autosizePrompt(ta);
      updatePromptState(id);
    });

    const noneList = document.getElementById("prompts-none-list");
    noneList.replaceChildren(...Object.entries(NO_PROMPT_ACTIONS).map(([id, text]) => {
      const li = document.createElement("li");
      li.className = "prompt-notes-item";
      const name = document.createElement("span");
      name.className = "label";
      name.textContent = ACTION_LABELS[id] || id;
      const desc = document.createElement("span");
      desc.className = "text-muted";
      desc.textContent = text;
      li.append(name, desc);
      return li;
    }));

    updatePromptsSummary();
  }

  // Stores only customised prompts (load and background.js fall back to the
  // default for missing ids). Keys the editor doesn't own are preserved.
  async function savePrompts() {
    const { customPrompts: stored = {} } = await chrome.storage.local.get("customPrompts");
    const saved = {};
    for (const [id, value] of Object.entries(stored)) {
      if (!EDITABLE_PROMPT_IDS.includes(id)) saved[id] = value;
    }
    EDITABLE_PROMPT_IDS.forEach(id => {
      const ta = document.getElementById(`prompt-${id}`);
      if (!ta) {
        if (stored[id]) saved[id] = stored[id];
      } else if (isCustomPrompt(id, ta.value)) {
        saved[id] = ta.value.trim();
      }
    });
    await chrome.storage.local.set({ customPrompts: saved });
    flashSaved();
  }

  // The popup can close at any moment; don't lose the last keystrokes.
  window.addEventListener("pagehide", () => { flushPromptSave(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPromptSave();
  });

  resetPromptsBtn.addEventListener("click", async () => {
    if (!confirm("Reset all prompts to defaults? Your custom prompts will be lost.")) return;
    clearTimeout(promptSaveTimer);
    promptSaveTimer = null;
    await promptSaveChain.catch(() => {});
    await chrome.storage.local.remove("customPrompts");
    await loadPrompts();
    // The button is now disabled; park focus on the status next to it (it is
    // a live region, so "All prompts use defaults" is announced too).
    document.getElementById("prompts-custom-status").focus();
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
  // First run shows a setup callout instead of an error; the red error only
  // appears once the user has interacted with the field and left it empty.
  const apiKeySetup = document.getElementById("api-key-setup");
  const apiKeySetupTitle = document.getElementById("api-key-setup-title");
  const apiKeyLink = document.getElementById("api-key-link");
  let apiKeyTouched = false;
  let apiKeyTyped = false;
  let apiKeyHadValue = !!apiKeyInput.value.trim();

  function updateApiKeyWarning() {
    const needsKey = providerSelect.value === "gemini" || fallbackProviderSelect.value === "gemini";
    const empty = !apiKeyInput.value.trim();
    const showSetup = needsKey && empty && !apiKeyTouched;
    const showError = needsKey && empty && apiKeyTouched;
    apiKeySetup.hidden = !showSetup;
    apiKeyLink.hidden = showSetup; // avoid two links to the same URL
    apiKeyWarning.hidden = !showError;
    apiKeyInput.setAttribute("aria-invalid", String(showError));
    // Only reference the error while it is visible, so it isn't announced otherwise.
    if (showError) apiKeyInput.setAttribute("aria-describedby", "api-key-warning");
    else apiKeyInput.removeAttribute("aria-describedby");
    apiKeySetupTitle.textContent = providerSelect.value === "gemini"
      ? "Add your Gemini API key to get started"
      : "Your Gemini fallback needs an API key";
  }

  apiKeyInput.addEventListener("input", () => {
    apiKeyTyped = true;
    if (apiKeyInput.value.trim()) apiKeyHadValue = true;
    else if (apiKeyHadValue) apiKeyTouched = true;
    updateApiKeyWarning();
  });
  apiKeyInput.addEventListener("blur", () => {
    if (apiKeyTyped) apiKeyTouched = true;
    updateApiKeyWarning();
  });

  async function saveSettings() {
    await chrome.storage.local.set({
      aiProvider: providerSelect.value,
      geminiApiKey: apiKeyInput.value.trim(),
      geminiModel: modelSelect.value || DEFAULT_GEMINI_MODEL,
      geminiFallbackModel: fallbackModelSelect.value,
      fallbackProvider: fallbackProviderSelect.value,
      fallbackLmStudioUrl: fallbackLmStudioUrlInput.value.trim() || DEFAULT_LM_STUDIO_URL,
      fallbackLmStudioModel: fallbackLmStudioModelInput.value.trim(),
      autoSelectAll: autoSelectAllCheckbox.checked,
      lmStudioUrl: lmStudioUrlInput.value.trim() || DEFAULT_LM_STUDIO_URL,
      lmStudioModel: lmStudioModelInput.value.trim()
    });
    updateApiKeyWarning();
    flashSaved();
  }

  [providerSelect, fallbackProviderSelect, modelSelect, fallbackModelSelect, autoSelectAllCheckbox]
    .forEach(el => {
      el.addEventListener("change", saveSettings);
    });

  [apiKeyInput, lmStudioUrlInput, lmStudioModelInput, fallbackLmStudioUrlInput, fallbackLmStudioModelInput].forEach(el => {
    el.addEventListener("input", saveSettings);
  });

  updateApiKeyWarning();
  loadShortcuts();

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
    const reviewCmd = commands.find(c => c.name === "open_refine");
    document.getElementById("shortcut-fix-grammar").textContent = fixCmd?.shortcut || "Not set";
    document.getElementById("shortcut-fix-selected").textContent = fixSelCmd?.shortcut || "Not set";
    document.getElementById("shortcut-ai-prompt").textContent = aiPromptCmd?.shortcut || "Not set";
    document.getElementById("shortcut-open-refine").textContent = reviewCmd?.shortcut || "Not set";
    document.getElementById("shortcut-autoselect-label").textContent = fixCmd?.shortcut || "Not set";
  }

  function formatDuration(totalMs) {
    const totalSeconds = totalMs / 1000;
    if (totalSeconds < 60) return totalSeconds.toFixed(1) + "s";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    return minutes + "m " + seconds + "s";
  }

  // All-time stats include lifetimeStats (folded in once entries age out of the
  // detailed history) plus whatever is still sitting in the detailed history.
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
    renderedHistory = history;
    historyShown = 0;
    document.getElementById("history-list-note").textContent =
      `Your last ${HISTORY_LIMIT} edits are kept, with the changes highlighted.`;

    if (history.length === 0) {
      historyMoreBtn.hidden = true;
      historyList.innerHTML =
        '<div class="empty-state">' +
        '<strong>No edits yet</strong>' +
        '<span>Select text on any page and run an AI action to see it here.</span>' +
        '</div>';
      return;
    }

    showMoreHistory();
  }

  // The history can hold hundreds of edits; build the cards a page at a time.
  const HISTORY_PAGE_SIZE = 30;
  const historyMoreBtn = document.getElementById("history-more-btn");
  let renderedHistory = [];
  let historyShown = 0;

  function showMoreHistory() {
    const page = renderedHistory.slice(historyShown, historyShown + HISTORY_PAGE_SIZE);
    const cards = page.map(buildHistoryItem);
    historyList.append(...cards);
    historyShown += page.length;
    historyMoreBtn.hidden = historyShown >= renderedHistory.length;
    updateHistoryOverflow();
    return cards[0];
  }

  historyMoreBtn.addEventListener("click", () => {
    const firstNew = showMoreHistory();
    // The button may have just hidden itself; keep focus in the list.
    firstNew?.querySelector("button")?.focus();
  });

  // Marks what the fix removed (in the original) or added (in the result).
  function appendDiff(el, ops, changeType) {
    let text = "";
    let type = null;
    const flush = () => {
      if (!text) return;
      if (type === "eq") {
        el.append(text);
      } else {
        const mark = document.createElement(changeType);
        mark.className = "diff-" + changeType;
        mark.textContent = text;
        el.append(mark);
      }
      text = "";
    };
    for (const op of ops) {
      if (op.type !== "eq" && op.type !== changeType) continue;
      if (op.type !== type) { flush(); type = op.type; }
      text += op.token;
    }
    flush();
  }

  // Shows the two texts with the differences highlighted. A rewrite (tone
  // change, translation) has nothing in common to highlight and stays plain.
  function fillHistoryTexts(originalEl, fixedEl, item) {
    const original = String(item.original ?? "");
    const fixed = String(item.fixed ?? "");
    const result = original !== fixed ? extractCorrections(original, fixed) : null;
    if (!result || result.similarity < LEARN_MIN_SIMILARITY) {
      originalEl.textContent = original;
      fixedEl.textContent = fixed;
      return;
    }
    originalEl.classList.add("has-diff");
    appendDiff(originalEl, result.ops, "del");
    appendDiff(fixedEl, result.ops, "ins");
  }

  // ── Export ──────────────────────────────────────────────────────────────
  // One JSON file with the edit history, the all-time totals and the mistakes
  // dictionary. Settings and the API key are never part of it.
  async function exportData() {
    const {
      history = [],
      lifetimeStats = { count: 0, totalTimeMs: 0, totalTokens: 0 },
      mistakesSummary = null
    } = await chrome.storage.local.get(["history", "lifetimeStats", "mistakesSummary"]);
    const mistakes = await loadMistakes();
    const mistakeCount = Object.keys(mistakes.items).length;
    if (!history.length && !mistakeCount) {
      showPopupToast("Nothing to export yet.", "error");
      return;
    }
    const exportedAt = new Date();
    const payload = {
      app: "Fix Errors AI",
      appVersion: chrome.runtime.getManifest().version,
      exportVersion: 1,
      exportedAt: exportedAt.toISOString(),
      lifetimeStats,
      mistakes,
      mistakesSummary,
      history
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `fix-errors-ai-export-${exportedAt.toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    showPopupToast(`Exported ${history.length} edit${history.length === 1 ? "" : "s"} and ${mistakeCount} mistake${mistakeCount === 1 ? "" : "s"}.`, "success");
  }

  for (const id of ["export-history-btn", "export-mistakes-btn"]) {
    document.getElementById(id).addEventListener("click", () => {
      exportData().catch(() => showPopupToast("Could not export. Please try again.", "error"));
    });
  }

  // ── Mistakes ────────────────────────────────────────────────────────────
  const mistakesList = document.getElementById("mistakes-list");
  const mistakesKinds = document.getElementById("mistakes-kinds");
  const summaryBtn = document.getElementById("mistakes-summary-btn");
  const summaryText = document.getElementById("mistakes-summary-text");
  const summaryMeta = document.getElementById("mistakes-summary-meta");
  const summaryError = document.getElementById("mistakes-summary-error");
  const MISTAKES_SHOWN = 50;
  let mistakesKind = "";

  function markedText(tag, text) {
    const mark = document.createElement(tag);
    mark.className = "diff-" + tag;
    mark.textContent = text;
    return mark;
  }

  function buildMistakeItem(item) {
    const card = document.createElement("div");
    card.className = "mistake-item";

    const head = document.createElement("div");
    head.className = "mistake-head";
    const change = document.createElement("span");
    change.className = "mistake-change";
    if (!item.from) {
      change.append("Add ", markedText("ins", item.to));
    } else if (!item.to) {
      change.append("Remove ", markedText("del", item.from));
    } else {
      const arrow = document.createElement("span");
      arrow.className = "mistake-arrow";
      arrow.textContent = " → ";
      change.append(markedText("del", item.from), arrow, markedText("ins", item.to));
    }
    const kind = document.createElement("span");
    kind.className = "mistake-kind";
    kind.textContent = MISTAKE_KIND_LABELS[item.kind] || item.kind;
    const count = document.createElement("span");
    count.className = "mistake-count";
    count.textContent = "×" + item.count;
    count.title = `Corrected ${item.count} time${item.count === 1 ? "" : "s"}`;
    head.append(change, kind, count);
    card.append(head);

    if (item.example) {
      const oneLine = text => String(text || "").replace(/\s+/g, " ");
      const example = document.createElement("div");
      example.className = "mistake-example";
      example.append("…" + oneLine(item.example.before));
      if (item.example.del) example.append(markedText("del", oneLine(item.example.del)));
      if (item.example.ins) example.append(markedText("ins", oneLine(item.example.ins)));
      example.append(oneLine(item.example.after) + "…");
      card.append(example);
    }
    return card;
  }

  function renderMistakeKinds(mistakes) {
    // Spacing fixes are counted but have no words to list, so no filter for them.
    const kinds = Object.keys(MISTAKE_KIND_LABELS)
      .filter(kind => kind !== "spacing" && mistakes.totals[kind] > 0)
      .sort((a, b) => mistakes.totals[b] - mistakes.totals[a]);
    if (!kinds.includes(mistakesKind)) mistakesKind = "";
    const total = kinds.reduce((sum, kind) => sum + mistakes.totals[kind], 0);
    const chips = kinds.length < 2 ? [] : [["", "All", total], ...kinds.map(kind => [kind, MISTAKE_KIND_LABELS[kind], mistakes.totals[kind]])];
    mistakesKinds.replaceChildren(...chips.map(([kind, label, count]) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.setAttribute("aria-pressed", String(kind === mistakesKind));
      const number = document.createElement("span");
      number.className = "chip-count";
      number.textContent = count.toLocaleString();
      chip.append(label, number);
      chip.addEventListener("click", () => {
        mistakesKind = kind;
        renderMistakes().then(() => {
          mistakesKinds.querySelector('[aria-pressed="true"]')?.focus();
        });
      });
      return chip;
    }));
  }

  function renderSummary(summary) {
    summaryText.hidden = !summary;
    summaryMeta.hidden = !summary;
    summaryBtn.textContent = summary ? "Refresh summary" : "Explain my mistakes";
    if (!summary) return;
    summaryText.textContent = summary.text;
    const date = new Date(summary.at);
    summaryMeta.textContent = isNaN(date) ? "" : `Written ${formatRelativeTime(date).toLowerCase()}.`;
  }

  async function renderMistakes() {
    const mistakes = await loadMistakes();
    const { mistakesSummary } = await chrome.storage.local.get("mistakesSummary");
    document.getElementById("mistakes-note").textContent = mistakes.analyzed
      ? `Learned from ${mistakes.analyzed.toLocaleString()} “Fix spelling & grammar” edit${mistakes.analyzed === 1 ? "" : "s"}. Stays on this device.`
      : "Learned from your “Fix spelling & grammar” edits. Stays on this device.";
    renderMistakeKinds(mistakes);
    const items = topMistakes(mistakes, MISTAKES_SHOWN, mistakesKind);
    if (items.length) {
      mistakesList.replaceChildren(...items.map(buildMistakeItem));
    } else {
      mistakesList.innerHTML =
        '<div class="empty-state">' +
        '<strong>No mistakes learned yet</strong>' +
        '<span>Run “Fix spelling &amp; grammar” on your text. What gets corrected most often will show up here.</span>' +
        '</div>';
    }
    summaryBtn.disabled = Object.keys(mistakes.items).length < 3;
    summaryBtn.title = summaryBtn.disabled ? "Needs at least 3 learned corrections" : "";
    document.getElementById("reset-mistakes-btn").disabled = !mistakes.analyzed && !items.length;
    renderSummary(mistakesSummary);
  }

  summaryBtn.addEventListener("click", async () => {
    summaryBtn.disabled = true;
    summaryBtn.textContent = "Asking the AI…";
    summaryError.hidden = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: "summarizeMistakes" });
      if (!response?.ok) throw new Error(response?.error || "Could not summarize your mistakes.");
    } catch (error) {
      summaryError.textContent = error.message || "Could not summarize your mistakes.";
      summaryError.hidden = false;
    }
    await renderMistakes();
  });

  document.getElementById("reset-mistakes-btn").addEventListener("click", async () => {
    if (!confirm("Forget all learned mistakes? Your edit history is kept.")) return;
    // An empty dictionary (rather than none) stops it being rebuilt from history.
    await chrome.storage.local.set({ mistakes: emptyMistakes() });
    await chrome.storage.local.remove("mistakesSummary");
    await renderMistakes();
  });

  // "Just now" / "5 min ago" / "2 h ago" / "Yesterday" / short date.
  function formatRelativeTime(date, now = new Date()) {
    const diffMs = now - date;
    if (!(diffMs >= 0) || diffMs < 60 * 1000) return "Just now";
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 60) return minutes + " min ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + " h ago";
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    if (date >= startOfYesterday) return "Yesterday";
    const options = { month: "short", day: "numeric" };
    if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
    return date.toLocaleDateString(undefined, options);
  }

  function buildHistoryItem(item) {
    const container = document.createElement("div");
    container.className = "history-item";

    // Head: action badge, relative time, icon-only copy button.
    const head = document.createElement("div");
    head.className = "history-head";

    const actionLabel = ACTION_LABELS[item.action] || "Fix spelling & grammar";
    const actionBadge = document.createElement("span");
    actionBadge.className = "badge badge-secondary";
    actionBadge.title = actionLabel;
    // The inner span carries the ellipsis (an inline-flex badge can't clip its own text).
    const actionBadgeLabel = document.createElement("span");
    actionBadgeLabel.className = "badge-label";
    actionBadgeLabel.textContent = actionLabel;
    actionBadge.append(actionBadgeLabel);

    const date = new Date(item.timestamp);
    const time = document.createElement("time");
    time.className = "history-time";
    if (!isNaN(date)) {
      time.dateTime = date.toISOString();
      time.title = date.toLocaleString();
      time.textContent = formatRelativeTime(date);
    }

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn-ghost btn-icon btn-sm history-copy";
    const setCopyState = copied => {
      const label = copied ? "Copied" : "Copy result";
      copyBtn.innerHTML = copied ? ICONS.check : ICONS.copy;
      copyBtn.setAttribute("aria-label", label);
      copyBtn.title = label;
      copyBtn.classList.toggle("is-success", copied);
    };
    setCopyState(false);
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(item.fixed).then(() => {
        setCopyState(true);
        clearTimeout(copyBtn._resetTimer);
        copyBtn._resetTimer = setTimeout(() => setCopyState(false), 2000);
      }, () => {
        showPopupToast("Failed to copy result.", "error");
      });
    });

    head.append(actionBadge, time, copyBtn);

    // Texts are clamped in CSS only, so the full text stays in the DOM.
    const itemId = "history-item-" + (++historyItemSeq);
    const originalText = document.createElement("div");
    originalText.className = "history-original";
    originalText.id = itemId + "-original";
    originalText.dir = "auto";

    const fixedText = document.createElement("div");
    fixedText.className = "history-fixed";
    fixedText.id = itemId + "-fixed";
    fixedText.dir = "auto";
    fillHistoryTexts(originalText, fixedText, item);

    // Footer: compact meta plus the "Show more" toggle when needed.
    const actions = document.createElement("div");
    actions.className = "history-actions";

    const meta = document.createElement("span");
    meta.className = "history-meta";
    const parts = [];
    if (item.responseTimeMs != null) {
      parts.push((item.responseTimeMs / 1000).toFixed(2) + " s");
    }
    if (item.tokens?.total != null) {
      parts.push(item.tokens.total.toLocaleString() + " tokens");
      if (item.tokens.input != null && item.tokens.output != null) {
        meta.title = item.tokens.input.toLocaleString() + " in / " +
          item.tokens.output.toLocaleString() + " out";
      }
    }
    if (item.applied === false) {
      const notApplied = document.createElement("span");
      notApplied.className = "history-meta-error";
      notApplied.textContent = "Not applied, copy to paste";
      if (item.applyError) notApplied.title = item.applyError;
      if (parts.length) meta.append(parts.join(" · ") + " · ");
      meta.append(notApplied);
    } else {
      meta.textContent = parts.join(" · ");
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-ghost btn-sm history-toggle";
    toggle.textContent = "Show more";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", originalText.id + " " + fixedText.id);
    toggle.hidden = true;
    toggle.addEventListener("click", () => {
      const expanded = container.classList.toggle("is-expanded");
      toggle.textContent = expanded ? "Show less" : "Show more";
      toggle.setAttribute("aria-expanded", String(expanded));
    });

    actions.append(meta, toggle);
    container.append(head, originalText, fixedText, actions);
    return container;
  }

  // Show the toggle only on cards whose clamped text actually overflows.
  function updateHistoryOverflow() {
    historyList.querySelectorAll(".history-item").forEach(card => {
      const toggle = card.querySelector(".history-toggle");
      if (!toggle) return;
      if (!card.classList.contains("is-expanded")) {
        toggle.hidden = ![...card.querySelectorAll(".history-original, .history-fixed")]
          .some(el => el.scrollHeight > el.clientHeight + 1);
      }
      const meta = card.querySelector(".history-meta");
      card.querySelector(".history-actions").hidden = toggle.hidden && !meta.textContent;
    });
  }
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => updateHistoryOverflow()).observe(historyList);
  }
});

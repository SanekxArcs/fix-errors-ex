// Shared by the worker and settings screen. Only the worker changes usage.
let modelQuotaQueue = Promise.resolve();

function modelLimitKey(provider, model, endpoint = "") {
  return provider === "lmstudio"
    ? `lmstudio:${endpoint.replace(/\/+$/, "")}:${model || "server-default"}`
    : `gemini:${model}`;
}

function quotaDay(at = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key).value).join("-");
}

function quotaFailure(message) {
  const error = new Error(message);
  error.name = "ModelLimitError";
  return error;
}

function quotaLocked(fn) {
  const operation = modelQuotaQueue.then(fn);
  modelQuotaQueue = operation.catch(() => {});
  return operation;
}

async function getModelLimitProfile(key) {
  const settings = await chrome.storage.local.get(["modelLimits", "modelLimitsEnabled"]);
  const { modelLimits = {} } = settings;
  if (!modelBudgetsEnabled(settings)) return {
    enabled: false, rpm: Number.MAX_SAFE_INTEGER, tpm: Number.MAX_SAFE_INTEGER,
    rpd: Number.MAX_SAFE_INTEGER, tpd: 0,
    maxInputTokens: Number.MAX_SAFE_INTEGER, maxOutputTokens: Number.MAX_SAFE_INTEGER
  };
  const limits = modelLimits[key];
  if (!limits || !["rpm", "tpm", "rpd", "maxInputTokens", "maxOutputTokens"].every(field => Number.isSafeInteger(limits[field]) && limits[field] > 0)) {
    throw quotaFailure("Set this model's limits in Settings → Model limits before processing text.");
  }
  if (limits.tpd != null && (!Number.isSafeInteger(limits.tpd) || limits.tpd < 0)) throw quotaFailure("The model's daily token limit is invalid. Check Settings → Model limits.");
  return { ...limits, enabled: true };
}

function modelBudgetsEnabled(settings) {
  return typeof settings.modelLimitsEnabled === "boolean" ? settings.modelLimitsEnabled : Object.keys(settings.modelLimits || {}).length > 0;
}

function currentModelUsage(record = {}, now = Date.now()) {
  const day = quotaDay(now);
  return {
    day,
    requestsDay: record.day === day ? record.requestsDay || 0 : 0,
    tokensDay: record.day === day ? record.tokensDay || 0 : 0,
    entries: (record.entries || []).filter(entry => entry.at > now - 60000),
    cooldownUntil: record.cooldownUntil || 0
  };
}

function checkModelBudget(limits, usage, inputTokens = 0, now = Date.now()) {
  if (usage.cooldownUntil > now) throw quotaFailure(`This model is cooling down. Try again in ${Math.ceil((usage.cooldownUntil - now) / 1000)} seconds.`);
  if (usage.requestsDay >= limits.rpd) throw quotaFailure("Daily request limit reached for this model. It resets at midnight Pacific time.");
  if (limits.tpd && usage.tokensDay + inputTokens > limits.tpd) throw quotaFailure("Daily input-token limit reached for this model. It resets at midnight Pacific time.");
  if (usage.entries.length >= limits.rpm) {
    const wait = Math.max(1, Math.ceil((usage.entries[0].at + 60000 - now) / 1000));
    throw quotaFailure(`Requests-per-minute limit reached for this model. Try again in ${wait} seconds.`);
  }
  if (inputTokens > limits.maxInputTokens) throw quotaFailure(`This text needs ${inputTokens.toLocaleString()} input tokens; this model's configured input limit is ${limits.maxInputTokens.toLocaleString()}. Shorten the text or included context.`);
  if (inputTokens > limits.tpm) throw quotaFailure("This request alone exceeds the model's input tokens per minute. Shorten the text or included context.");
  if (usage.entries.reduce((total, entry) => total + entry.tokens, 0) + inputTokens > limits.tpm) {
    throw quotaFailure("Input-token limit per minute reached for this model. Wait up to 60 seconds or shorten the text.");
  }
}

async function checkModelAvailability(key) {
  const limits = await getModelLimitProfile(key);
  const { modelUsage = {} } = await chrome.storage.local.get("modelUsage");
  checkModelBudget(limits, currentModelUsage(modelUsage[key]));
  return limits;
}

function reserveModelUsage(key, inputTokens, signal, modelCaps = null) {
  return quotaLocked(async () => {
    if (signal?.aborted) throw signal.reason || new DOMException("Cancelled", "AbortError");
    if (!Number.isSafeInteger(inputTokens) || inputTokens < 0) throw quotaFailure("Could not determine this request's token count. No text-generation request was sent.");
    const configured = await getModelLimitProfile(key);
    const limits = modelCaps ? {
      ...configured,
      maxInputTokens: Math.min(configured.maxInputTokens, modelCaps.inputTokenLimit),
      maxOutputTokens: Math.min(configured.maxOutputTokens, modelCaps.outputTokenLimit)
    } : configured;
    const { modelUsage = {} } = await chrome.storage.local.get("modelUsage");
    const now = Date.now();
    const usage = currentModelUsage(modelUsage[key], now);
    checkModelBudget(limits, usage, inputTokens, now);
    usage.entries.push({ at: now, tokens: inputTokens });
    usage.requestsDay += 1;
    usage.tokensDay += inputTokens;
    modelUsage[key] = usage;
    // Reserve before sending. Failed or cancelled attempts retain their reservation.
    await chrome.storage.local.set({ modelUsage });
    return limits;
  });
}

function rememberModelCooldown(key, seconds) {
  return quotaLocked(async () => {
    const { modelUsage = {} } = await chrome.storage.local.get("modelUsage");
    const usage = currentModelUsage(modelUsage[key]);
    usage.cooldownUntil = Math.max(usage.cooldownUntil, Date.now() + Math.max(60, seconds || 60) * 1000);
    modelUsage[key] = usage;
    await chrome.storage.local.set({ modelUsage });
  });
}

function providerRetrySeconds(response, error) {
  const retry = response.headers?.get?.("Retry-After");
  if (retry) {
    const numeric = Number(retry);
    if (Number.isFinite(numeric)) return numeric;
    const date = Date.parse(retry);
    if (Number.isFinite(date)) return Math.max(0, (date - Date.now()) / 1000);
  }
  const details = error?.error?.details || [];
  const retryInfo = details.find(detail => detail.retryDelay);
  return parseFloat(retryInfo?.retryDelay) || 60;
}

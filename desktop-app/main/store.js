const Store = require('electron-store');
const { DEFAULT_LM_STUDIO_URL } = require('../shared/constants');

const HISTORY_LIMIT = 50;

const store = new Store({
  defaults: {
    aiProvider: 'gemini',
    geminiApiKey: '',
    geminiModel: '',
    geminiFallbackModel: '',
    lmStudioUrl: DEFAULT_LM_STUDIO_URL,
    lmStudioModel: '',
    includeContext: false,
    customPrompts: {},
    history: [],
    lifetimeStats: { count: 0, totalTimeMs: 0, totalTokens: 0 }
  }
});

function getSettings() {
  return {
    aiProvider: store.get('aiProvider'),
    geminiApiKey: store.get('geminiApiKey'),
    geminiModel: store.get('geminiModel'),
    geminiFallbackModel: store.get('geminiFallbackModel'),
    lmStudioUrl: store.get('lmStudioUrl'),
    lmStudioModel: store.get('lmStudioModel'),
    includeContext: store.get('includeContext')
  };
}

function saveSettings(settings) {
  store.set({
    aiProvider: settings.aiProvider,
    geminiApiKey: settings.geminiApiKey,
    geminiModel: settings.geminiModel,
    geminiFallbackModel: settings.geminiFallbackModel,
    lmStudioUrl: settings.lmStudioUrl,
    lmStudioModel: settings.lmStudioModel,
    includeContext: settings.includeContext
  });
}

function getPrompts() {
  return store.get('customPrompts');
}

function savePrompts(prompts) {
  store.set('customPrompts', prompts);
}

function resetPrompts() {
  store.delete('customPrompts');
  store.set('customPrompts', {});
}

function getHistory() {
  return { history: store.get('history'), lifetimeStats: store.get('lifetimeStats') };
}

// Detailed history only keeps the most recent HISTORY_LIMIT entries. Anything
// older is folded into lifetimeStats so aggregate totals survive forever.
function addHistoryEntry(entry) {
  const history = store.get('history');
  const combined = [entry, ...history];
  const kept = combined.slice(0, HISTORY_LIMIT);
  const evicted = combined.slice(HISTORY_LIMIT);

  if (evicted.length > 0) {
    const lifetimeStats = store.get('lifetimeStats');
    for (const item of evicted) {
      lifetimeStats.count += 1;
      lifetimeStats.totalTimeMs += item.responseTimeMs || 0;
      lifetimeStats.totalTokens += item.tokens?.total || 0;
    }
    store.set('lifetimeStats', lifetimeStats);
  }

  store.set('history', kept);
}

function clearHistory() {
  const history = store.get('history');
  const lifetimeStats = store.get('lifetimeStats');

  for (const item of history) {
    lifetimeStats.count += 1;
    lifetimeStats.totalTimeMs += item.responseTimeMs || 0;
    lifetimeStats.totalTokens += item.tokens?.total || 0;
  }

  store.set('lifetimeStats', lifetimeStats);
  store.set('history', []);
}

module.exports = {
  getSettings,
  saveSettings,
  getPrompts,
  savePrompts,
  resetPrompts,
  getHistory,
  addHistoryEntry,
  clearHistory
};

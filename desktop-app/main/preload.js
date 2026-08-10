const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runAction: (text, action, context) => ipcRenderer.invoke('runAction', text, action, context),
  cancelRun: () => ipcRenderer.invoke('cancelRun'),
  retryWithModel: (originalText, action, context, model) => ipcRenderer.invoke('retryWithModel', originalText, action, context, model),

  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('saveSettings', settings),

  getHistory: () => ipcRenderer.invoke('getHistory'),
  clearHistory: () => ipcRenderer.invoke('clearHistory'),

  getPrompts: () => ipcRenderer.invoke('getPrompts'),
  resetPrompts: () => ipcRenderer.invoke('resetPrompts'),

  getPromptHotkeys: () => ipcRenderer.invoke('getPromptHotkeys'),
  savePrompts: (prompts, promptHotkeys) => ipcRenderer.invoke('savePrompts', prompts, promptHotkeys),
  onReplyAssist: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('openReplyAssist', listener);
    return () => ipcRenderer.removeListener('openReplyAssist', listener);
  }
});

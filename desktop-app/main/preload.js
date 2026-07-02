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
  savePrompts: (prompts) => ipcRenderer.invoke('savePrompts', prompts),
  resetPrompts: () => ipcRenderer.invoke('resetPrompts')
});

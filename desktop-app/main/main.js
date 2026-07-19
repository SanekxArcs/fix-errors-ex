const { app, BrowserWindow, Tray, Menu, globalShortcut } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const store = require('./store');
const { runQuickFix } = require('./quick-fix');

// This is a small compose/utility window, not a graphics app — trading GPU
// compositing for software rendering avoids a real-world crash where a flaky
// GPU process (driver conflicts, several other Electron/Chromium apps
// fighting over the GPU) retries a few times and then Chromium fatally kills
// the whole process ("GPU process isn't usable. Goodbye."), which looks like
// "app flashes a white window and quits" to the user.
app.disableHardwareAcceleration();

const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: 'Fix Errors AI',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow?.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

function createTray() {
  tray = new Tray(ICON_PATH);
  tray.setToolTip('Fix Errors AI');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Fix Errors AI', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', toggleWindow);
}

function safeRegister(accelerator, callback) {
  try {
    const ok = globalShortcut.register(accelerator, callback);
    if (!ok) console.warn(`Failed to register hotkey: ${accelerator}`);
    return ok;
  } catch (error) {
    console.warn(`Invalid hotkey "${accelerator}":`, error.message);
    return false;
  }
}

// Both hotkeys are re-registered together (globalShortcut has no per-key
// update, only register/unregisterAll) whenever settings are saved.
function applyHotkeys({ globalHotkey, quickFixHotkey }) {
  globalShortcut.unregisterAll();

  const toggleOk = globalHotkey ? safeRegister(globalHotkey, toggleWindow) : true;

  let quickFixOk = true;
  if (quickFixHotkey) {
    quickFixOk = quickFixHotkey === globalHotkey ? false : safeRegister(quickFixHotkey, runQuickFix);
  }

  return { toggleOk, quickFixOk };
}

app.whenReady().then(() => {
  registerIpcHandlers({ onHotkeyChange: applyHotkeys });
  createWindow();
  createTray();
  applyHotkeys(store.getSettings());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep running in the tray; app.isQuitting (set from the tray menu) is what
  // actually ends the process — see the mainWindow 'close' handler above.
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

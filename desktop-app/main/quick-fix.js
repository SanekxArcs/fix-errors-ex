// System-wide "fix whatever text is selected, wherever it is" flow.
//
// There is no cross-application API for "read the current text selection" on
// Windows short of UI Automation (heavy) — so this uses the same trick as
// every other lightweight text-fixer utility: simulate Ctrl+C to copy the
// selection via the OS clipboard, run it through the AI, then simulate
// Ctrl+V to paste the result back into whatever still has focus. The app's
// own window is never shown/focused during this flow, so focus never leaves
// the app the user was typing in.
const { clipboard, Notification } = require('electron');
const { spawn } = require('child_process');
const store = require('./store');
const { isCapacityError, translitKeyboard, callGeminiAI, callLMStudioAI } = require('./ai-service');
const { DEFAULT_GEMINI_MODEL } = require('../shared/constants');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let activeNotification = null;

// Only ever sends fixed keyboard shortcuts below — never user text — so
// there's no command-injection surface here.
function sendLegacyKeys(sequence) {
  return new Promise((resolve, reject) => {
    const script = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 30; [System.Windows.Forms.SendKeys]::SendWait('${sequence}')`;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true }
    );
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Legacy SendKeys exited with code ${code}`))));
    child.on('error', reject);
  });
}

// Native fallback for apps where System.Windows.Forms.SendKeys does not reach
// the focused text control (notably some Chromium/Electron windows).
function sendNativeKeys(sequence) {
  const method = {
    '^c': 'SendCtrlC',
    '^v': 'SendCtrlV',
    '^insert': 'SendCtrlInsert'
  }[sequence];

  if (!method) return Promise.reject(new Error(`Unsupported key sequence: ${sequence}`));

  return new Promise((resolve, reject) => {
    const script = `
$source = @'
using System;
using System.Runtime.InteropServices;

public static class NativeKeyboard {
    private const byte VK_CONTROL = 0x11;
    private const byte VK_INSERT = 0x2D;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    private static void KeyDown(byte key) => keybd_event(key, 0, 0, UIntPtr.Zero);
    private static void KeyUp(byte key) => keybd_event(key, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

    public static void SendCtrlC() => SendCtrlKey(0x43);
    public static void SendCtrlV() => SendCtrlKey(0x56);
    public static void SendCtrlInsert() {
        KeyDown(VK_CONTROL);
        KeyDown(VK_INSERT);
        KeyUp(VK_INSERT);
        KeyUp(VK_CONTROL);
    }

    private static void SendCtrlKey(byte key) {
        KeyDown(VK_CONTROL);
        KeyDown(key);
        KeyUp(key);
        KeyUp(VK_CONTROL);
    }
}
'@
Add-Type -TypeDefinition $source
Start-Sleep -Milliseconds 30
[NativeKeyboard]::${method}()
`;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true }
    );
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Native keyboard input exited with code ${code}`))));
    child.on('error', reject);
  });
}

function notify(body) {
  if (!Notification.isSupported()) return;
  if (activeNotification) activeNotification.close();
  const notification = new Notification({ title: 'Fix Errors AI', body, silent: true });
  activeNotification = notification;
  notification.on('close', () => {
    if (activeNotification === notification) activeNotification = null;
  });
  notification.show();
}

async function captureSelection() {
  const previousClipboard = clipboard.readText();
  clipboard.writeText('');

  const copyAttempts = [
    () => sendLegacyKeys('^c'),
    () => sendNativeKeys('^c'),
    // Ctrl+Insert is supported by many editors and console-style apps as an
    // alternative copy shortcut, and is safer than sending another Ctrl+C.
    () => sendNativeKeys('^insert')
  ];

  for (const attempt of copyAttempts) {
    try {
      await attempt();
      await wait(220);
      if (clipboard.readText()) break;
    } catch (error) {
      // Try the next input method. The final user-facing error below explains
      // the likely permission/focus problem if all methods fail.
    }
  }

  const selectedText = clipboard.readText();

  if (!selectedText || !selectedText.trim()) {
    clipboard.writeText(previousClipboard);
    notify('Could not read selected text. The app may block copy, or it may be running as Administrator.');
    return null;
  }

  return { selectedText, previousClipboard };
}

async function runReplyAssist() {
  const captured = await captureSelection();
  if (!captured) return null;
  clipboard.writeText(captured.previousClipboard);
  return captured.selectedText;
}

async function runQuickFix(actionOverride = null) {
  const settings = store.getSettings();
  const action = actionOverride || settings.quickFixAction || 'fixGrammar';
  const captured = await captureSelection();
  if (!captured) return;
  const { selectedText, previousClipboard } = captured;

  try {
    let fixedText;
    let tokens = null;
    const t0 = Date.now();

    notify(action === 'translit' ? 'Switching keyboard layout…' : 'AI is working…');

    if (action === 'translit') {
      fixedText = translitKeyboard(selectedText);
      if (fixedText === selectedText) {
        clipboard.writeText(previousClipboard);
        notify('No keyboard layout change detected.');
        return;
      }
    } else {
      const { aiProvider, geminiApiKey, geminiModel, geminiFallbackModel, lmStudioUrl, lmStudioModel, includeContext } = settings;
      if (aiProvider !== 'lmstudio' && !geminiApiKey) {
        clipboard.writeText(previousClipboard);
        notify('Set your Gemini API key in Settings first.');
        return;
      }

      const { history } = store.getHistory();
      const historyContext = includeContext ? history : [];
      const result = aiProvider === 'lmstudio'
        ? await callLMStudioAI(selectedText, lmStudioUrl, lmStudioModel || '', action, historyContext)
        : await callGeminiAI(selectedText, geminiApiKey, action, geminiModel || DEFAULT_GEMINI_MODEL, geminiFallbackModel || '', historyContext);
      fixedText = result.text;
      tokens = result.tokens;
    }

    if (!fixedText) {
      clipboard.writeText(previousClipboard);
      notify('AI returned no usable text. Nothing was changed.');
      return;
    }

    const responseTimeMs = Date.now() - t0;
    store.addHistoryEntry({
      timestamp: new Date().toISOString(),
      original: selectedText,
      fixed: fixedText,
      action,
      tokens,
      responseTimeMs
    });

    clipboard.writeText(fixedText);
    try {
      await sendLegacyKeys('^v');
    } catch (error) {
      await sendNativeKeys('^v');
    }
    await wait(200);
    clipboard.writeText(previousClipboard);
    const elapsedSeconds = ((Date.now() - t0) / 1000).toFixed(1);
    notify(action === 'translit'
      ? 'Keyboard layout fixed.'
      : `Done — selected text replaced in ${elapsedSeconds}s.`);
  } catch (error) {
    clipboard.writeText(previousClipboard);
    const message = isCapacityError(error.message)
      ? 'AI is overloaded right now — try again in a moment.'
      : `Error: ${error.message}`;
    notify(message);
  }
}

module.exports = { runQuickFix, runReplyAssist };

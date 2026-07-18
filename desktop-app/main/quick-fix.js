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

// Only ever sends the fixed '^c' / '^v' literals below — never user text — so
// there's no command-injection surface here.
function sendKeys(sequence) {
  return new Promise((resolve, reject) => {
    const script = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 30; [System.Windows.Forms.SendKeys]::SendWait('${sequence}')`;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true }
    );
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`SendKeys exited with code ${code}`))));
    child.on('error', reject);
  });
}

function notify(body) {
  if (!Notification.isSupported()) return;
  new Notification({ title: 'Fix Errors AI', body, silent: true }).show();
}

async function runQuickFix() {
  const settings = store.getSettings();
  const action = settings.quickFixAction || 'fixGrammar';

  const previousClipboard = clipboard.readText();
  clipboard.writeText('');

  try {
    await sendKeys('^c');
  } catch (error) {
    notify('Could not copy the selection — the focused app may be blocking simulated input.');
    clipboard.writeText(previousClipboard);
    return;
  }

  await wait(120);
  const selectedText = clipboard.readText();

  if (!selectedText || !selectedText.trim()) {
    clipboard.writeText(previousClipboard);
    notify('No text selected. Highlight some text first, then press the hotkey.');
    return;
  }

  try {
    let fixedText;
    let tokens = null;
    const t0 = Date.now();

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
    await sendKeys('^v');
    await wait(200);
    clipboard.writeText(previousClipboard);
  } catch (error) {
    clipboard.writeText(previousClipboard);
    const message = isCapacityError(error.message)
      ? 'AI is overloaded right now — try again in a moment.'
      : `Error: ${error.message}`;
    notify(message);
  }
}

module.exports = { runQuickFix };

# Fix Errors AI — Desktop (Windows)

Standalone Electron port of the "Fix Errors AI" Chrome extension. Paste text into
the Compose tab, pick an action, and copy the result out, or run selected text
through a configurable global shortcut. Settings, history and custom prompts
work the same way as the extension's popup.

This app is independent of the Chrome extension in `../extension for browsers/`;
neither one depends on the other, and both can be used side by side.

## Run in development

```
npm install
npm start
```

## Build a Windows installer

```
npm install
npm run build
```

Produces an NSIS installer `.exe` under `dist/`. Cross-building the Windows
installer from Linux/macOS requires Wine; simplest is to run `npm run build`
directly on a Windows machine.

## Notes

- Settings/history/prompts are stored locally via `electron-store` in the
  per-user Electron app-data folder — no cloud sync, same as the extension's
  `chrome.storage.local`.
- The Gemini API key you enter in Settings is stored locally in that same
  file; nothing is sent anywhere except directly to `generativelanguage.googleapis.com`
  (or your configured LM Studio server).
- Settings include an optional Windows startup toggle. When enabled, the app starts
  hidden in the system tray.
- The separate Keyboard Layout hotkey runs the local UA↔EN keyboard-layout conversion
  on selected text without sending it to an AI provider. Its default is `Shift+Alt+L`.
- Each action in the Prompts tab has an optional global shortcut field. Leave it blank
  to disable the shortcut. A Reply Assist shortcut opens Compose with the selected text
  loaded and leaves the conversation context field ready for input.

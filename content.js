if (!window.lbxFixErrorsInjected) {
  window.lbxFixErrorsInjected = true;

  // Stores the selection/focus state captured at the moment Alt+Shift+A is pressed,
  // so we can restore it after the AI panel has stolen focus.
  let savedSelectionInfo = null;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "replaceText") {
      const { originalText, fixedText } = request;
      replaceSelectedText(originalText, fixedText);
      if (sendResponse) sendResponse({ status: "done" });
    } else if (request.action === "showToast") {
      showToast(request.message, request.type);
      if (sendResponse) sendResponse({ status: "done" });
    } else if (request.action === "showReplyAssistModal") {
      showReplyAssistPanel(request.selectedText);
      if (sendResponse) sendResponse({ status: "done" });
    } else if (request.action === "showRetryableError") {
      const { message, fallbackModel, models } = request;
      if (fallbackModel) {
        showToast(message, "error", {
          retryLabel: "↺ Retry",
          onRetry: () => chrome.runtime.sendMessage({ action: "retryAI", model: fallbackModel })
        });
      } else {
        showToast(message, "error", {
          retryLabel: "↺ Choose model",
          onRetry: () => showModelPickerPanel(models)
        });
      }
      if (sendResponse) sendResponse({ status: "done" });
    } else if (request.action === "getSelection") {
      const activeElement = document.activeElement;
      if (request.autoSelectAll && activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable)) {
        if (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA") {
          activeElement.select();
        } else {
          const range = document.createRange();
          range.selectNodeContents(activeElement);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }

      // Chat apps (Slack, Teams, etc.) often render an @mention as an atomic chip
      // element rather than plain text. If one sits at the edge of the selection,
      // shrink the selection to exclude it so it's never touched by the replace step.
      let leadingText = "", trailingText = "";
      const selection = window.getSelection();
      if (selection.rangeCount > 0 && activeElement && activeElement.isContentEditable) {
        const range = selection.getRangeAt(0);
        const edges = excludeEdgeAtomicNodes(range);
        leadingText = edges.leadingText;
        trailingText = edges.trailingText;
        if (leadingText || trailingText) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }

      const text = window.getSelection().toString();
      if (sendResponse) sendResponse({ text, leadingText, trailingText });
    }
    return true;
  });

  // A real mention/hashtag/emoji chip is a small inline element — never a block
  // wrapper that likely holds the entire message (which would empty the selection).
  function isLikelyAtomicChip(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.tagName === "DIV" || node.tagName === "P" || node.tagName === "SECTION" || node.tagName === "ARTICLE") {
      return false;
    }
    return (node.textContent || "").trim().length <= 60;
  }

  // Shrinks a Range so a leading/trailing atomic chip is excluded (left in the DOM
  // untouched). Returns the excluded chip text so callers can still show/log the
  // full message. Reverts if excluding the edges would leave nothing to fix.
  function excludeEdgeAtomicNodes(range) {
    if (range.collapsed) return { leadingText: "", trailingText: "" };

    const originalStart = { container: range.startContainer, offset: range.startOffset };
    const originalEnd = { container: range.endContainer, offset: range.endOffset };
    let leadingText = "";
    let trailingText = "";

    if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
      const node = range.startContainer.childNodes[range.startOffset];
      if (isLikelyAtomicChip(node)) {
        leadingText = node.textContent || "";
        range.setStartAfter(node);
      }
    }

    if (!range.collapsed && range.endContainer.nodeType === Node.ELEMENT_NODE) {
      const node = range.endContainer.childNodes[range.endOffset - 1];
      if (isLikelyAtomicChip(node)) {
        trailingText = node.textContent || "";
        range.setEndBefore(node);
      }
    }

    if (!range.toString().trim() && (leadingText || trailingText)) {
      range.setStart(originalStart.container, originalStart.offset);
      range.setEnd(originalEnd.container, originalEnd.offset);
      return { leadingText: "", trailingText: "" };
    }

    return { leadingText, trailingText };
  }

  // Capture the current selection state before showing the panel.
  // Must be called synchronously before any focus change occurs.
  function saveCurrentSelection(selectedText) {
    const activeElement = document.activeElement;

    if (activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")) {
      savedSelectionInfo = {
        type: "input",
        element: activeElement,
        start: activeElement.selectionStart,
        end: activeElement.selectionEnd,
        text: selectedText
      };
    } else if (activeElement && activeElement.isContentEditable) {
      const sel = window.getSelection();
      savedSelectionInfo = {
        type: "contenteditable",
        element: activeElement,
        range: sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null,
        text: selectedText
      };
    } else {
      const sel = window.getSelection();
      savedSelectionInfo = {
        type: "selection",
        range: sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null,
        text: selectedText
      };
    }
  }

  function showToast(message, type = "info", options = {}) {
    let toastId = "lbx-ai-toast";
    let toast = document.getElementById(toastId);

    if (!toast) {
      toast = document.createElement("div");
      toast.id = toastId;
      toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        z-index: 1000000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 10px;
        pointer-events: auto;
      `;
      document.body.appendChild(toast);
    }

    const colors = {
      working: "#1a73e8",
      success: "#2e7d32",
      error: "#d32f2f",
      info: "#333"
    };

    toast.style.backgroundColor = colors[type] || colors.info;

    toast.innerHTML = '';

    const textSpan = document.createElement("span");
    textSpan.innerText = message;
    toast.appendChild(textSpan);

    if (type === "working") {
      const cancelBtn = document.createElement("button");
      cancelBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      cancelBtn.style.cssText = `
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        margin-left: 4px;
        transition: background 0.2s;
      `;
      cancelBtn.onmouseover = () => cancelBtn.style.backgroundColor = "rgba(255, 255, 255, 0.3)";
      cancelBtn.onmouseout = () => cancelBtn.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
      cancelBtn.onclick = () => {
        chrome.runtime.sendMessage({ action: "cancelAI" });
        showToast("Cancelling...", "info");
      };
      toast.appendChild(cancelBtn);
    }

    if (options.onRetry) {
      const retryBtn = document.createElement("button");
      retryBtn.textContent = options.retryLabel || "↺ Retry";
      retryBtn.style.cssText = `
        background: rgba(255, 255, 255, 0.18);
        border: none;
        color: white;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        padding: 4px 10px;
        margin-left: 8px;
        white-space: nowrap;
        font-family: inherit;
      `;
      retryBtn.onmouseover = () => { retryBtn.style.background = "rgba(255,255,255,0.28)"; };
      retryBtn.onmouseout = () => { retryBtn.style.background = "rgba(255,255,255,0.18)"; };
      retryBtn.onclick = options.onRetry;
      toast.appendChild(retryBtn);
    }

    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    // Don't auto-hide if there's a retry button — user needs time to act
    if (type !== "working" && !options.onRetry) {
      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
      }, 4000);
    }
  }

  function showModelPickerPanel(models) {
    const existing = document.getElementById("lbx-model-picker-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "lbx-model-picker-panel";
    panel.style.cssText = `
      position: fixed;
      bottom: 72px;
      right: 20px;
      width: 270px;
      background: #1e1e1e;
      border: 1px solid #2a2a2a;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.55);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #d4d4d4;
      z-index: 1000002;
      overflow: hidden;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      padding: 10px 14px 9px;
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      border-bottom: 1px solid #2a2a2a;
    `;
    header.textContent = "Retry with model:";

    const list = document.createElement("div");
    list.style.cssText = "padding: 4px 0;";

    models.forEach(m => {
      const btn = document.createElement("button");
      btn.textContent = m.label;
      btn.style.cssText = `
        display: block;
        width: 100%;
        text-align: left;
        padding: 8px 14px;
        background: none;
        border: none;
        color: #c8c8c8;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
        line-height: 1.3;
      `;
      btn.onmouseover = () => { btn.style.background = "#2a2a2a"; btn.style.color = "#fff"; };
      btn.onmouseout = () => { btn.style.background = "none"; btn.style.color = "#c8c8c8"; };
      btn.onclick = () => {
        panel.remove();
        chrome.runtime.sendMessage({ action: "retryAI", model: m.id });
      };
      list.appendChild(btn);
    });

    panel.appendChild(header);
    panel.appendChild(list);
    document.body.appendChild(panel);

    // Close when clicking outside
    setTimeout(() => {
      const closeOnOutside = (e) => {
        if (!panel.contains(e.target)) {
          panel.remove();
          document.removeEventListener("click", closeOnOutside, true);
        }
      };
      document.addEventListener("click", closeOnOutside, true);
    }, 100);
  }

  // Non-blocking bottom-right panel — page stays interactive while open.
  // Selection is saved before rendering so focus change doesn't matter.
  function showReplyAssistPanel(selectedText) {
    // Capture selection state NOW, before any focus change
    saveCurrentSelection(selectedText);

    const existing = document.getElementById("lbx-reply-assist-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "lbx-reply-assist-panel";
    panel.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 320px;
      background: #1e1e1e;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #d4d4d4;
      z-index: 1000001;
      overflow: hidden;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 11px 14px 10px;
      border-bottom: 1px solid #2a2a2a;
    `;

    const titleEl = document.createElement("span");
    titleEl.textContent = "Reply Assist";
    titleEl.style.cssText = "font-size: 13px; font-weight: 600; color: #fff;";

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #555;
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 2px;
      border-radius: 4px;
      line-height: 1;
    `;
    closeBtn.onmouseover = () => { closeBtn.style.color = "#d4d4d4"; };
    closeBtn.onmouseout = () => { closeBtn.style.color = "#555"; };

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement("div");
    body.style.cssText = "padding: 12px 14px 10px;";

    const previewLabel = document.createElement("div");
    previewLabel.textContent = "Refining:";
    previewLabel.style.cssText = "font-size: 10px; color: #555; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500;";

    const preview = document.createElement("div");
    const previewText = selectedText.length > 90 ? selectedText.slice(0, 90) + "…" : selectedText;
    preview.textContent = `"${previewText}"`;
    preview.style.cssText = `
      font-size: 11px;
      color: #777;
      background: #161616;
      border-radius: 6px;
      padding: 7px 10px;
      margin-bottom: 11px;
      line-height: 1.45;
      font-style: italic;
      border: 1px solid #252525;
      word-break: break-word;
    `;

    const contextLabel = document.createElement("div");
    contextLabel.textContent = "Context (optional):";
    contextLabel.style.cssText = "font-size: 10px; color: #555; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500;";

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Paste conversation, describe tone, or add instructions…";
    textarea.rows = 3;
    textarea.style.cssText = `
      width: 100%;
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      color: #d4d4d4;
      font-size: 12px;
      padding: 8px 10px;
      resize: vertical;
      box-sizing: border-box;
      font-family: inherit;
      outline: none;
      line-height: 1.5;
      min-height: 64px;
    `;
    textarea.addEventListener("focus", () => { textarea.style.borderColor = "#3b82f6"; });
    textarea.addEventListener("blur", () => { textarea.style.borderColor = "#2a2a2a"; });

    body.appendChild(previewLabel);
    body.appendChild(preview);
    body.appendChild(contextLabel);
    body.appendChild(textarea);

    // Footer
    const footer = document.createElement("div");
    footer.style.cssText = `
      display: flex;
      gap: 8px;
      padding: 10px 14px 13px;
      justify-content: flex-end;
      align-items: center;
    `;

    const hint = document.createElement("span");
    hint.textContent = "Ctrl+Enter · Esc";
    hint.style.cssText = "font-size: 10px; color: #444; margin-right: auto;";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = `
      padding: 6px 13px;
      border-radius: 6px;
      border: 1px solid #3a3a3a;
      background: #2a2a2a;
      color: #d4d4d4;
      cursor: pointer;
      font-size: 12px;
    `;

    const refineBtn = document.createElement("button");
    refineBtn.textContent = "Refine";
    refineBtn.style.cssText = `
      padding: 6px 14px;
      border-radius: 6px;
      border: none;
      background: #1d4ed8;
      color: white;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    `;
    refineBtn.onmouseover = () => { refineBtn.style.background = "#2563eb"; };
    refineBtn.onmouseout = () => { refineBtn.style.background = "#1d4ed8"; };

    function submit() {
      const context = textarea.value.trim();
      panel.remove();
      chrome.runtime.sendMessage({ action: "replyAssistSubmit", selectedText, context });
    }

    function cancel() {
      savedSelectionInfo = null;
      panel.remove();
    }

    refineBtn.onclick = submit;
    cancelBtn.onclick = cancel;
    closeBtn.onclick = cancel;

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });

    footer.appendChild(hint);
    footer.appendChild(cancelBtn);
    footer.appendChild(refineBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    document.body.appendChild(panel);

    // Focus the textarea so the user can type right away.
    // The selection is already saved above, so this focus change is safe.
    setTimeout(() => textarea.focus(), 50);
  }

  // Rich-text editors (e.g. Slack) can wipe an entire editable region when the
  // replaced selection included a non-text embed such as an @mention chip —
  // execCommand("insertText") deletes the whole selection but the host page's
  // own editor sometimes fails to reconcile that and clears the field. Detect
  // that and restore the original text so the user's message isn't lost.
  function insertTextGuarded(el, replacement, original) {
    document.execCommand("insertText", false, replacement);
    if (original.trim() && replacement.trim() && el.innerText.trim() === "") {
      document.execCommand("insertText", false, original);
      showToast("Couldn't safely replace this text (likely an @mention) — original text restored.", "error");
    }
  }

  function replaceSelectedText(original, replacement) {
    // If we have a saved selection from Reply Assist, restore it and use it
    if (savedSelectionInfo) {
      const info = savedSelectionInfo;
      savedSelectionInfo = null;

      if (info.type === "input" && info.element) {
        const el = info.element;
        el.focus();
        const value = el.value;
        el.value = value.substring(0, info.start) + replacement + value.substring(info.end);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.setSelectionRange(info.start, info.start + replacement.length);
        return;
      }

      if (info.type === "contenteditable" && info.element && info.range) {
        const el = info.element;
        el.focus();
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(info.range);
        insertTextGuarded(el, replacement, original);
        return;
      }

      if (info.type === "selection" && info.range) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(info.range);
        info.range.deleteContents();
        info.range.insertNode(document.createTextNode(replacement));
        return;
      }
    }

    // Fallback: use current focus/selection (for context menu and other shortcuts)
    const activeElement = document.activeElement;

    if (activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")) {
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;
      const value = activeElement.value;

      activeElement.value = value.substring(0, start) + replacement + value.substring(end);

      activeElement.dispatchEvent(new Event("input", { bubbles: true }));
      activeElement.dispatchEvent(new Event("change", { bubbles: true }));

      activeElement.focus();
      activeElement.setSelectionRange(start, start + replacement.length);
      return;
    }

    if (activeElement && activeElement.isContentEditable) {
      activeElement.focus();
      insertTextGuarded(activeElement, replacement, original);
      return;
    }

    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(replacement));
    }
  }
}

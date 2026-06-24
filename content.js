if (!window.lbxFixErrorsInjected) {
  window.lbxFixErrorsInjected = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "replaceText") {
      const { originalText, fixedText } = request;
      replaceSelectedText(originalText, fixedText);
      if (sendResponse) sendResponse({ status: "done" });
    } else if (request.action === "showToast") {
      showToast(request.message, request.type);
      if (sendResponse) sendResponse({ status: "done" });
    } else if (request.action === "showReplyAssistModal") {
      showReplyAssistModal(request.selectedText);
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
      const text = window.getSelection().toString();
      if (sendResponse) sendResponse({ text });
    }
    return true;
  });

  function showToast(message, type = "info") {
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
    
    // Clear previous content
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

    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    if (type !== "working") {
      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
      }, 4000);
    }
  }

  function showReplyAssistModal(selectedText) {
    const existing = document.getElementById("lbx-reply-assist-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "lbx-reply-assist-modal";
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000001;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
      background: #1e1e1e;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 20px;
      width: 420px;
      max-width: 90vw;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      color: #d4d4d4;
    `;

    const title = document.createElement("div");
    title.textContent = "Reply Assist";
    title.style.cssText = "font-size: 16px; font-weight: 600; margin-bottom: 4px; color: #fff;";

    const subtitle = document.createElement("div");
    subtitle.textContent = "Add context to guide the refinement (optional)";
    subtitle.style.cssText = "font-size: 12px; color: #888; margin-bottom: 12px;";

    const textarea = document.createElement("textarea");
    textarea.placeholder = "E.g. paste the conversation thread, describe tone, or add any instructions...";
    textarea.rows = 4;
    textarea.style.cssText = `
      width: 100%;
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      color: #d4d4d4;
      font-size: 13px;
      padding: 10px;
      resize: vertical;
      box-sizing: border-box;
      font-family: inherit;
      outline: none;
      line-height: 1.5;
    `;
    textarea.addEventListener("focus", () => { textarea.style.borderColor = "#3b82f6"; });
    textarea.addEventListener("blur", () => { textarea.style.borderColor = "#2a2a2a"; });

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; align-items: center;";

    const hint = document.createElement("span");
    hint.textContent = "Ctrl+Enter to refine · Esc to cancel";
    hint.style.cssText = "font-size: 11px; color: #555; margin-right: auto;";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = `
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid #3a3a3a;
      background: #2a2a2a;
      color: #d4d4d4;
      cursor: pointer;
      font-size: 13px;
    `;

    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Refine";
    submitBtn.style.cssText = `
      padding: 8px 18px;
      border-radius: 6px;
      border: none;
      background: #1d4ed8;
      color: white;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    `;
    submitBtn.onmouseover = () => { submitBtn.style.background = "#2563eb"; };
    submitBtn.onmouseout = () => { submitBtn.style.background = "#1d4ed8"; };

    function submit() {
      const context = textarea.value.trim();
      overlay.remove();
      chrome.runtime.sendMessage({ action: "replyAssistSubmit", selectedText, context });
    }

    function cancel() {
      overlay.remove();
    }

    submitBtn.onclick = submit;
    cancelBtn.onclick = cancel;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cancel(); });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });

    btnRow.appendChild(hint);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);

    modal.appendChild(title);
    modal.appendChild(subtitle);
    modal.appendChild(textarea);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    setTimeout(() => textarea.focus(), 50);
  }

  function replaceSelectedText(original, replacement) {
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
      document.execCommand("insertText", false, replacement);
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

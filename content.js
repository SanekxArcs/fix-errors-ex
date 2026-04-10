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
        pointer-events: none;
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
    toast.innerText = message;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    if (type !== "working") {
      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
      }, 4000);
    }
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

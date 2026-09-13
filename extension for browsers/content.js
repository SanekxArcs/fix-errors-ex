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
          retryLabel: "Retry",
          onRetry: () => chrome.runtime.sendMessage({ action: "retryAI", model: fallbackModel })
        });
      } else {
        showToast(message, "error", {
          retryLabel: "Choose model",
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

  // Walks down from the range boundary's immediate child through block wrappers
  // (e.g. Slack wraps a message in <p>) to find the actual edge node — a leaf or
  // an atomic chip — instead of stopping at the wrapper itself.
  function deepEdgeNode(container, offset, direction) {
    let node = direction === "start" ? container.childNodes[offset] : container.childNodes[offset - 1];
    while (node && node.nodeType === Node.ELEMENT_NODE && node.childNodes.length && !isLikelyAtomicChip(node)) {
      node = direction === "start" ? node.firstChild : node.lastChild;
    }
    return node;
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
      const node = deepEdgeNode(range.startContainer, range.startOffset, "start");
      if (isLikelyAtomicChip(node)) {
        leadingText = node.textContent || "";
        range.setStartAfter(node);
      }
    }

    if (!range.collapsed && range.endContainer.nodeType === Node.ELEMENT_NODE) {
      const node = deepEdgeNode(range.endContainer, range.endOffset, "end");
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

  // ── Injected UI ─────────────────────────────────────────────────────────
  // The toast and panels below follow the shadcn/ui design language (slate base,
  // blue accent, 0.5rem radius), but are written as inline styles rather than a
  // stylesheet so no host-page CSS can bleed into them.
  const UI = {
    bg: "#020817",
    subtle: "#0b1324",
    fg: "#f8fafc",
    muted: "#1e293b",
    mutedHover: "#273549",
    mutedFg: "#94a3b8",
    border: "#1e293b",
    primary: "#3b82f6",
    primaryHover: "#5b9bf8",
    primaryFg: "#0f172a",
    destructive: "#f87171",
    success: "#4ade80",
    font: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    shadow: "0 10px 15px -3px rgba(0,0,0,0.45), 0 4px 6px -4px rgba(0,0,0,0.45)"
  };

  // Lucide icons — the same set shadcn/ui ships with.
  const ICON = {
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    spinner: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="animation: lbx-spin 0.8s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
    rotate: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1.06 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>'
  };

  // Keyframes can't live in an inline style attribute, so inject them once under
  // a prefixed name that won't collide with anything on the host page.
  function ensureKeyframes() {
    if (document.getElementById("lbx-ai-keyframes")) return;
    const style = document.createElement("style");
    style.id = "lbx-ai-keyframes";
    style.textContent = "@keyframes lbx-spin{to{transform:rotate(360deg)}}";
    (document.head || document.documentElement).appendChild(style);
  }

  // shadcn button variants/sizes, expressed as inline style strings.
  const BUTTON_VARIANTS = {
    primary: { base: UI.primary, fg: UI.primaryFg, hover: UI.primaryHover, border: "transparent" },
    secondary: { base: UI.muted, fg: UI.fg, hover: UI.mutedHover, border: "transparent" },
    outline: { base: "transparent", fg: UI.fg, hover: UI.muted, border: UI.border },
    ghost: { base: "transparent", fg: UI.mutedFg, hover: UI.muted, border: "transparent" },
    translucent: { base: "rgba(255,255,255,0.10)", fg: UI.fg, hover: "rgba(255,255,255,0.18)", border: "transparent" }
  };

  const BUTTON_SIZES = {
    default: "height:30px;padding:0 12px;font-size:12px;",
    sm: "height:26px;padding:0 10px;font-size:11.5px;",
    icon: "height:24px;width:24px;padding:0;"
  };

  function makeButton(label, { variant = "secondary", size = "default", icon = "", title = "" } = {}) {
    const v = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary;
    const btn = document.createElement("button");
    btn.type = "button";
    if (title) btn.title = title;
    btn.innerHTML = icon + (label ? `<span>${label}</span>` : "");
    btn.style.cssText = `
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:6px;
      ${BUTTON_SIZES[size] || BUTTON_SIZES.default}
      border:1px solid ${v.border};
      border-radius:6px;
      background:${v.base};
      color:${v.fg};
      font-family:${UI.font};
      font-weight:500;
      line-height:1;
      white-space:nowrap;
      cursor:pointer;
      transition:background-color .15s, color .15s, border-color .15s;
    `;
    btn.onmouseover = () => {
      btn.style.background = v.hover;
      if (variant === "ghost" || variant === "outline") btn.style.color = UI.fg;
    };
    btn.onmouseout = () => {
      btn.style.background = v.base;
      btn.style.color = v.fg;
    };
    return btn;
  }

  function makeLabel(text) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = `font-size:11.5px;font-weight:500;line-height:1.3;color:${UI.fg};margin-bottom:6px;`;
    return el;
  }

  function makeKbd(text) {
    const el = document.createElement("span");
    el.textContent = text;
    el.style.cssText = `
      display:inline-flex;
      align-items:center;
      padding:1px 5px;
      border:1px solid ${UI.border};
      border-radius:4px;
      background:${UI.muted};
      color:${UI.mutedFg};
      font-family:${UI.mono};
      font-size:10px;
      line-height:1.5;
    `;
    return el;
  }

  // Sonner-style toast: neutral popover surface with a coloured status icon,
  // rather than a fully colour-flooded bar.
  function showToast(message, type = "info", options = {}) {
    ensureKeyframes();

    const toastId = "lbx-ai-toast";
    let toast = document.getElementById(toastId);

    if (!toast) {
      toast = document.createElement("div");
      toast.id = toastId;
      document.body.appendChild(toast);
    }

    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 360px;
      padding: 11px 13px;
      border: 1px solid ${UI.border};
      border-radius: 10px;
      background: ${UI.bg};
      color: ${UI.fg};
      font-family: ${UI.font};
      font-size: 13px;
      font-weight: 500;
      line-height: 1.4;
      box-shadow: ${UI.shadow};
      z-index: 1000000;
      opacity: 1;
      transform: translateY(0);
      transition: opacity .25s ease, transform .25s cubic-bezier(0.32, 0.72, 0, 1);
      pointer-events: auto;
    `;

    const statuses = {
      working: { icon: ICON.spinner, color: UI.primary },
      success: { icon: ICON.check, color: UI.success },
      error: { icon: ICON.alert, color: UI.destructive },
      info: { icon: ICON.info, color: UI.mutedFg }
    };
    const status = statuses[type] || statuses.info;

    toast.innerHTML = "";

    const iconWrap = document.createElement("span");
    iconWrap.innerHTML = status.icon;
    iconWrap.style.cssText = `display:flex;flex-shrink:0;color:${status.color};`;
    toast.appendChild(iconWrap);

    const textSpan = document.createElement("span");
    textSpan.innerText = message;
    textSpan.style.cssText = "flex:1;min-width:0;";
    toast.appendChild(textSpan);

    if (type === "working") {
      const cancelBtn = makeButton("", { variant: "ghost", size: "icon", icon: ICON.x, title: "Cancel" });
      cancelBtn.style.marginLeft = "2px";
      cancelBtn.onclick = () => {
        chrome.runtime.sendMessage({ action: "cancelAI" });
        showToast("Cancelling...", "info");
      };
      toast.appendChild(cancelBtn);
    }

    if (options.onRetry) {
      const retryBtn = makeButton(options.retryLabel || "Retry", {
        variant: "secondary",
        size: "sm",
        icon: ICON.rotate
      });
      retryBtn.style.marginLeft = "2px";
      retryBtn.onclick = options.onRetry;
      toast.appendChild(retryBtn);
    }

    // Don't auto-hide if there's a retry button — user needs time to act
    if (type !== "working" && !options.onRetry) {
      clearTimeout(toast._hideTimer);
      toast._hideTimer = setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";
      }, 4000);
    } else {
      clearTimeout(toast._hideTimer);
    }
  }

  // Command-menu style popover listing the models available for a retry.
  function showModelPickerPanel(models) {
    const existing = document.getElementById("lbx-model-picker-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "lbx-model-picker-panel";
    panel.style.cssText = `
      position: fixed;
      bottom: 76px;
      right: 20px;
      width: 290px;
      border: 1px solid ${UI.border};
      border-radius: 10px;
      background: ${UI.bg};
      color: ${UI.fg};
      font-family: ${UI.font};
      box-shadow: ${UI.shadow};
      z-index: 1000002;
      overflow: hidden;
    `;

    const header = document.createElement("div");
    header.textContent = "Retry with model";
    header.style.cssText = `
      padding: 9px 12px 8px;
      border-bottom: 1px solid ${UI.border};
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: ${UI.mutedFg};
    `;

    const list = document.createElement("div");
    list.style.cssText = "padding:4px;max-height:260px;overflow-y:auto;";

    models.forEach(m => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = m.label;
      btn.style.cssText = `
        display: block;
        width: 100%;
        text-align: left;
        padding: 7px 9px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: ${UI.mutedFg};
        font-family: inherit;
        font-size: 12px;
        line-height: 1.35;
        cursor: pointer;
        transition: background-color .12s, color .12s;
      `;
      btn.onmouseover = () => { btn.style.background = UI.muted; btn.style.color = UI.fg; };
      btn.onmouseout = () => { btn.style.background = "transparent"; btn.style.color = UI.mutedFg; };
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
      width: 340px;
      border: 1px solid ${UI.border};
      border-radius: 12px;
      background: ${UI.bg};
      color: ${UI.fg};
      font-family: ${UI.font};
      box-shadow: ${UI.shadow};
      z-index: 1000001;
      overflow: hidden;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 12px 14px 11px;
      border-bottom: 1px solid ${UI.border};
    `;

    const titleWrap = document.createElement("div");

    const titleEl = document.createElement("div");
    titleEl.textContent = "Reply Assist";
    titleEl.style.cssText = `font-size:13.5px;font-weight:600;letter-spacing:-0.01em;color:${UI.fg};`;

    const descEl = document.createElement("div");
    descEl.textContent = "Refine the selected text in context.";
    descEl.style.cssText = `font-size:11.5px;color:${UI.mutedFg};margin-top:2px;`;

    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(descEl);

    const closeBtn = makeButton("", { variant: "ghost", size: "icon", icon: ICON.x, title: "Close" });

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement("div");
    body.style.cssText = "padding:12px 14px 12px;";

    const preview = document.createElement("div");
    const previewText = selectedText.length > 90 ? selectedText.slice(0, 90) + "…" : selectedText;
    preview.textContent = previewText;
    preview.style.cssText = `
      padding: 8px 10px;
      margin-bottom: 12px;
      border: 1px solid ${UI.border};
      border-left: 2px solid ${UI.primary};
      border-radius: 6px;
      background: ${UI.subtle};
      color: ${UI.mutedFg};
      font-size: 11.5px;
      line-height: 1.5;
      word-break: break-word;
    `;

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Paste conversation, describe tone, or add instructions…";
    textarea.rows = 3;
    textarea.style.cssText = `
      width: 100%;
      min-height: 68px;
      padding: 8px 10px;
      border: 1px solid ${UI.border};
      border-radius: 6px;
      background: ${UI.bg};
      color: ${UI.fg};
      font-family: inherit;
      font-size: 12.5px;
      line-height: 1.5;
      resize: vertical;
      box-sizing: border-box;
      outline: none;
      transition: border-color .15s, box-shadow .15s;
    `;
    textarea.addEventListener("focus", () => {
      textarea.style.borderColor = UI.primary;
      textarea.style.boxShadow = `0 0 0 1px ${UI.primary}`;
    });
    textarea.addEventListener("blur", () => {
      textarea.style.borderColor = UI.border;
      textarea.style.boxShadow = "none";
    });

    body.appendChild(makeLabel("Refining"));
    body.appendChild(preview);
    body.appendChild(makeLabel("Context (optional)"));
    body.appendChild(textarea);

    // Footer
    const footer = document.createElement("div");
    footer.style.cssText = `
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 11px 14px 13px;
      border-top: 1px solid ${UI.border};
    `;

    const hint = document.createElement("div");
    hint.style.cssText = "display:flex;align-items:center;gap:4px;margin-right:auto;";
    hint.appendChild(makeKbd("Ctrl+↵"));
    hint.appendChild(makeKbd("Esc"));

    const cancelBtn = makeButton("Cancel", { variant: "outline" });
    const refineBtn = makeButton("Refine", { variant: "primary" });

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

  // When a selection boundary sits immediately next to an inline element (e.g. a
  // Slack @mention chip left in place by excludeEdgeAtomicNodes),
  // execCommand("insertText") tends to type INTO that element instead of beside
  // it, corrupting the chip. Insert a tiny real text-node buffer via direct DOM
  // ops (not Range) so the caret unambiguously lands in plain text first.
  function bufferAwayFromAdjacentElement(range) {
    const wasCollapsed = range.collapsed;

    if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
      const prev = range.startContainer.childNodes[range.startOffset - 1];
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const buffer = document.createTextNode("\u200B");
        range.startContainer.insertBefore(buffer, range.startContainer.childNodes[range.startOffset] || null);
        range.setStart(buffer, 1);
        if (wasCollapsed) range.setEnd(buffer, 1);
      }
    }

    if (!wasCollapsed && range.endContainer.nodeType === Node.ELEMENT_NODE) {
      const next = range.endContainer.childNodes[range.endOffset];
      if (next && next.nodeType === Node.ELEMENT_NODE) {
        const buffer = document.createTextNode("\u200B");
        range.endContainer.insertBefore(buffer, next);
        range.setEnd(buffer, 0);
      }
    }
  }

  // Rich-text editors (e.g. Slack) can wipe an entire editable region when the
  // replaced selection included a non-text embed such as an @mention chip —
  // execCommand("insertText") deletes the whole selection but the host page's
  // own editor sometimes fails to reconcile that and clears the field. Detect
  // that and restore the original text so the user's message isn't lost.
  function insertTextGuarded(el, replacement, original) {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      bufferAwayFromAdjacentElement(sel.getRangeAt(0));
    }
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

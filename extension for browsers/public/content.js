if (!window.lbxFixErrorsInjected) {
  window.lbxFixErrorsInjected = true;

  // Stores the selection/focus state captured at the moment Alt+Shift+A is pressed,
  // so we can restore it after the AI panel has stolen focus.
  let savedSelectionInfo = null;

  // True while a request is running, i.e. while the "working" toast is up. Gates
  // the Alt+Shift+Esc cancel shortcut so it never swallows a plain Escape.
  let aiInProgress = false;
  let cancelCurrentReview = null;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "replaceText") {
      const { originalText, fixedText } = request;
      replaceSelectedText(originalText, fixedText)
        .then(() => sendResponse({ status: "done", replaced: true }))
        .catch(error => sendResponse({ replaced: false, error: error.message }));
    } else if (request.action === "dismissReview") {
      // A new request is starting from the user's current selection; don't restore the old one.
      cancelCurrentReview?.({ restore: false });
      sendResponse({ status: "done" });
    } else if (request.action === "restoreSelection") {
      restoreSavedSelection();
      sendResponse({ status: "done" });
    } else if (request.action === "showToast") {
      showToast(request.message, request.type, { copyText: request.copyText, timeoutMs: request.timeoutMs, durationMs: request.durationMs });
      if (sendResponse) sendResponse({ status: "done" });
    } else if (request.action === "showReplyAssistModal") {
      showReplyAssistPanel(request.selectedText);
      if (sendResponse) sendResponse({ status: "done" });
    } else if (request.action === "openReviewPanel") {
      showInlineReviewPanel(request);
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
          onRetry: () => {
            chrome.runtime.sendMessage({ action: "retryPickerOpened" });
            showModelPickerPanel(models);
          }
        });
      }
      if (sendResponse) sendResponse({ status: "done" });
    } else if (request.action === "getSelection") {
      const activeElement = deepActiveElement();
      if (document.getElementById("lbx-inline-review")?.contains(document.activeElement) && savedSelectionInfo) {
        sendResponse({ text: savedSelectionInfo.text, hadEditableTarget: savedSelectionInfo.type !== "selection" });
        return false;
      }
      const editable = isEditableElement(activeElement);
      if (request.autoSelectAll && editable) {
        if (isTextInput(activeElement)) {
          activeElement.select();
        } else {
          const range = document.createRange();
          range.selectNodeContents(activeElement);
          const selection = getSelectionFor(activeElement);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }

      // Chat apps (Slack, Teams, etc.) often render an @mention as an atomic chip
      // element rather than plain text. If one sits at the edge of the selection,
      // shrink the selection to exclude it so it's never touched by the replace step.
      let leadingText = "", trailingText = "";
      const selection = getSelectionFor(activeElement);
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

      const text = isTextInput(activeElement)
        ? activeElement.value.substring(activeElement.selectionStart, activeElement.selectionEnd)
        : getSelectionFor(activeElement).toString();
      saveCurrentSelection(text);
      // hadEditableTarget lets the background tell "nothing was selected" apart
      // from "auto-select had no text field to work with", so the toast can say
      // which one it was instead of the shortcut failing silently.
      if (sendResponse) sendResponse({ text, leadingText, trailingText, hadEditableTarget: editable });
    }
    return true;
  });

  // document.activeElement stops at a shadow host, so on sites that build their
  // editor as a web component it reports the wrapper rather than the field the
  // caret is actually in. Walk down through open shadow roots to the real one.
  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    if (isEditableElement(el)) return el;
    // Context menus and some editors focus a wrapper/body while keeping a range
    // inside the actual editable field.
    const selection = getSelectionFor(el);
    const node = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
    const owner = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return owner?.closest('[contenteditable]:not([contenteditable="false"])') || el;
  }

  function isEditableElement(el) {
    if (!el) return false;
    return isTextInput(el) || el.isContentEditable;
  }

  function isTextInput(el) {
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && typeof el.selectionStart === "number");
  }

  // A selection inside a shadow root lives on that root, not on the document.
  function getSelectionFor(el) {
    const root = el && el.getRootNode ? el.getRootNode() : null;
    if (root && root.getSelection) return root.getSelection();
    return window.getSelection();
  }

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
    const activeElement = deepActiveElement();

    if (isTextInput(activeElement)) {
      savedSelectionInfo = {
        type: "input",
        element: activeElement,
        start: activeElement.selectionStart,
        end: activeElement.selectionEnd,
        value: activeElement.value,
        text: selectedText
      };
    } else if (activeElement && activeElement.isContentEditable) {
      const sel = getSelectionFor(activeElement);
      const range = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
      savedSelectionInfo = {
        type: "contenteditable",
        element: activeElement,
        value: activeElement.textContent,
        range,
        // Selection.toString() puts newlines between paragraphs, Range.toString()
        // does not; keep the range's own text to verify and recover the range.
        rangeText: range ? range.toString() : "",
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

  function restoreSavedSelection() {
    const info = savedSelectionInfo;
    if (!info) return;
    if (info.element?.isConnected) info.element.focus();
    if (info.type === "input" && info.element?.isConnected) {
      info.element.setSelectionRange(info.start, info.end);
    } else if (info.range?.startContainer.isConnected && info.range?.endContainer.isConnected) {
      const selection = getSelectionFor(info.element);
      selection.removeAllRanges();
      selection.addRange(info.range);
    }
  }

  // ── Injected UI ─────────────────────────────────────────────────────────
  // The toast and panels below share the popup's design system (popup.css:
  // slate surface, pale periwinkle primary, 12/13/14/16 type scale, 8/10/12
  // radii), but are written as inline styles rather than a stylesheet so no
  // host-page CSS can bleed into them. Every value mirrors a popup token.
  const UI = {
    bg: "#181f2a",           // panel surface (popup --card)
    field: "#10151e",        // inputs, textareas, selects (popup --background)
    fg: "#e8ebf3",
    secondaryFg: "#dfe3ec",
    muted: "#1f2937",
    mutedHover: "#273345",
    mutedFg: "#97a1af",
    border: "#303b4a",
    primary: "#b3c8ff",
    primaryHover: "#a4b7ea",
    primaryFg: "#172136",
    destructive: "#ef8f8f",
    destructiveBorder: "rgba(239,143,143,.35)",
    success: "#76cb9a",
    successBorder: "rgba(118,203,154,.35)",
    ring: "#7e9dec",
    text: { xs: "12px", sm: "13px", base: "14px", lg: "16px" },
    leading: { tight: 1.25, snug: 1.4, normal: 1.5 },
    weight: { regular: 400, medium: 500, semibold: 600 },
    radius: { sm: "8px", md: "10px", lg: "12px", pill: "999px" },
    disabledOpacity: 0.5,
    font: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    shadow: "0 12px 28px -6px rgba(0,0,0,.45), 0 4px 10px -4px rgba(0,0,0,.35)"
  };

  // Text properties host pages commonly set on button/div/textarea; every
  // light-DOM node we build resets them so the page cannot restyle our text.
  const TEXT_RESET = "letter-spacing:normal;text-transform:none;font-style:normal;";

  // Lucide icons — the same set shadcn/ui ships with.
  const ICON = {
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    spinner: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="animation: lbx-spin 0.8s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
    rotate: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1.06 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>'
  };

  // Reduced motion: transitions and spinners collapse to a single instant frame.
  // The spinner may then sit still, which is fine: it always has text beside it.
  const REDUCED_MOTION = selector =>
    `${selector}{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}`;

  // Panels are small non-modal dialogs: Tab and Shift+Tab cycle inside them
  // while focus is inside. `root` is the panel's shadow root, or document.
  function trapTabKey(event, container, root) {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const focusable = [...container.querySelectorAll("button, select, textarea, input, [href], [tabindex]:not([tabindex='-1'])")]
      .filter(el => !el.disabled && el.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = root.activeElement;
    const outside = !focusable.includes(current);
    if (event.shiftKey && (current === first || outside)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (current === last || outside)) {
      event.preventDefault(); first.focus();
    }
  }

  // The element that really has focus, looking through open shadow roots.
  function focusedElement() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  // Hand focus back to where it was before a panel opened, if it still exists.
  function returnFocus(previous, panel) {
    if (savedSelectionInfo?.element?.isConnected) { restoreSavedSelection(); return; }
    if (previous?.isConnected && !panel?.contains(previous) && previous !== document.body) {
      try { previous.focus({ preventScroll: true }); } catch { /* not focusable */ }
    }
  }

  // Toast and retry picker share the bottom-right corner with the Review and
  // Reply panels. Bottom up the stack is: panel -> toast -> picker, 8px apart.
  // With no panel the toast sits at 20px and the picker at 76px, as before.
  // If there's no room above the panel (short viewports) they move to the free
  // area left of it, or, when the panel spans the width, just below its header
  // so the title and close button stay visible and clickable (the toast itself
  // is click-through; only its own buttons take clicks).
  const STACK_GAP = 8;

  function openPanels() {
    return [document.getElementById("lbx-inline-review"), document.getElementById("lbx-reply-assist-panel")]
      .filter(node => node?.isConnected);
  }

  function panelHeaderBottom(panel) {
    const header = panel.shadowRoot ? panel.shadowRoot.querySelector(".top") : panel.firstElementChild;
    return (header || panel).getBoundingClientRect().bottom;
  }

  function restackFloatingUI() {
    const toast = document.getElementById("lbx-ai-toast");
    const picker = document.getElementById("lbx-model-picker-panel");
    const items = [toast, picker].filter(node => node?.isConnected);
    if (!items.length) return;
    for (const el of items) {
      el.style.top = "auto";
      el.style.left = "auto";
      el.style.right = "20px";
      el.style.maxWidth = el === toast ? "min(360px, calc(100% - 40px))" : "";
    }
    const panels = openPanels();
    if (!panels.length) {
      if (toast) toast.style.bottom = "20px";
      if (picker) picker.style.bottom = `${toast ? 20 + toast.offsetHeight + STACK_GAP : 76}px`;
      return;
    }
    // Panels use the maximum z-index too, so the toast/picker must come later
    // in the DOM to paint above them.
    for (const el of items) {
      if (panels.some(panel => panel.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) {
        document.documentElement.appendChild(el);
      }
    }
    const rects = panels.map(panel => panel.getBoundingClientRect());
    const panelTop = Math.min(...rects.map(r => r.top));
    const panelLeft = Math.min(...rects.map(r => r.left));
    const viewportHeight = window.innerHeight;
    const stackHeight = () => items.reduce((sum, el) => sum + el.offsetHeight, 0) + STACK_GAP * (items.length - 1);

    if (panelTop - STACK_GAP - stackHeight() >= 12) {
      let bottom = viewportHeight - panelTop + STACK_GAP;
      for (const el of items) {
        el.style.bottom = `${Math.round(bottom)}px`;
        bottom += el.offsetHeight + STACK_GAP;
      }
      return;
    }

    const freeLeft = panelLeft - 20 - STACK_GAP;
    if (freeLeft >= 240) {
      let bottom = 20;
      for (const el of items) {
        el.style.right = "auto";
        el.style.left = "20px";
        el.style.maxWidth = `${Math.floor(Math.min(360, freeLeft))}px`;
        el.style.bottom = `${bottom}px`;
        bottom += el.offsetHeight + STACK_GAP;
      }
      return;
    }

    const headerBottom = Math.max(...panels.map(panelHeaderBottom));
    let top = Math.max(12, Math.min(headerBottom + STACK_GAP, viewportHeight - stackHeight() - 12));
    for (const el of items) {
      el.style.bottom = "auto";
      el.style.top = `${Math.round(top)}px`;
      top += el.offsetHeight + STACK_GAP;
    }
  }

  // Re-stack when the viewport changes or an open panel resizes (e.g. the user
  // drags a textarea taller), at most once per frame.
  let restackFrame = 0;
  function scheduleRestack() {
    if (restackFrame) return;
    restackFrame = requestAnimationFrame(() => { restackFrame = 0; restackFloatingUI(); });
  }
  window.addEventListener("resize", scheduleRestack);
  const panelResizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleRestack) : null;
  function watchPanel(panel) { panelResizeObserver?.observe(panel); }
  function unwatchPanel(panel) { if (panel) panelResizeObserver?.unobserve(panel); }

  // Keyframes and :focus-visible can't live in an inline style attribute, so
  // inject them once under prefixed names that won't collide with the host page.
  // The focus ring matches the popup's: 2px outline in the ring colour, 2px
  // offset (the offset always lands on our own panel background).
  function ensureKeyframes() {
    if (document.getElementById("lbx-ai-keyframes")) return;
    const style = document.createElement("style");
    style.id = "lbx-ai-keyframes";
    style.textContent = "@keyframes lbx-spin{to{transform:rotate(360deg)}}" +
      `[data-lbx-ui] :focus-visible{outline:2px solid ${UI.ring}!important;outline-offset:2px!important}` +
      `[data-lbx-ui] button:disabled{opacity:${UI.disabledOpacity}!important;cursor:default!important}` +
      `@media (prefers-reduced-motion: reduce){${REDUCED_MOTION("[data-lbx-ui],[data-lbx-ui] *")}}`;
    (document.head || document.documentElement).appendChild(style);
  }

  // Button variants/sizes mirroring popup.css .btn-*, as inline style strings.
  const BUTTON_VARIANTS = {
    primary: { base: UI.primary, fg: UI.primaryFg, hover: UI.primaryHover, border: "transparent" },
    secondary: { base: UI.muted, fg: UI.secondaryFg, hover: UI.mutedHover, border: "transparent" },
    outline: { base: UI.field, fg: UI.fg, hover: UI.muted, border: UI.border },
    ghost: { base: "transparent", fg: UI.fg, hover: UI.muted, border: "transparent" }
  };

  const BUTTON_SIZES = {
    default: `height:32px;padding:0 12px;border-radius:${UI.radius.md};`,
    sm: `height:28px;padding:0 10px;border-radius:${UI.radius.sm};`,
    icon: `height:28px;width:28px;padding:0;border-radius:${UI.radius.sm};`
  };

  function makeButton(label, { variant = "secondary", size = "default", icon = "", title = "", ariaLabel = "" } = {}) {
    const v = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary;
    // Icon-only ghost buttons (close / cancel) stay quiet until hovered.
    const fg = variant === "ghost" && size === "icon" ? UI.mutedFg : v.fg;
    const btn = document.createElement("button");
    btn.type = "button";
    if (title) btn.title = title;
    // Icon-only buttons always get an accessible name.
    if (ariaLabel || (!label && title)) btn.setAttribute("aria-label", ariaLabel || title);
    btn.innerHTML = icon + (label ? `<span style="${TEXT_RESET}">${label}</span>` : "");
    alignInjectedIcons(btn);
    btn.style.cssText = `
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:6px;
      box-sizing:border-box;
      margin:0;
      flex-shrink:0;
      ${BUTTON_SIZES[size] || BUTTON_SIZES.default}
      border:1px solid ${v.border};
      background:${v.base};
      color:${fg};
      font-family:${UI.font};
      font-size:${UI.text.sm};
      font-weight:${UI.weight.medium};
      line-height:${UI.leading.tight};
      ${TEXT_RESET}
      white-space:nowrap;
      cursor:pointer;
      pointer-events:auto;
      transition:background-color .15s, color .15s, border-color .15s;
    `;
    btn.onmouseover = () => {
      if (btn.disabled) return;
      btn.style.background = v.hover;
      if (variant === "ghost" || variant === "outline") btn.style.color = UI.fg;
    };
    btn.onmouseout = () => {
      btn.style.background = v.base;
      btn.style.color = fg;
    };
    return btn;
  }

  function alignInjectedIcons(container) {
    for (const icon of container.querySelectorAll("svg")) {
      icon.style.cssText += `;position:static;display:block;float:none;flex:0 0 auto;margin:0;padding:0;width:${icon.getAttribute("width") || 14}px;height:${icon.getAttribute("height") || 14}px;max-width:none;max-height:none;fill:none;stroke:currentColor;`;
    }
  }

  function makeLabel(text) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = `display:block;margin:0 0 6px;font-family:${UI.font};font-size:${UI.text.sm};font-weight:${UI.weight.medium};line-height:${UI.leading.tight};color:${UI.fg};${TEXT_RESET}`;
    return el;
  }

  function makeKbd(text) {
    const el = document.createElement("span");
    el.textContent = text;
    el.style.cssText = `
      display:inline-flex;
      align-items:center;
      padding:2px 7px;
      border:1px solid ${UI.border};
      border-radius:${UI.radius.sm};
      background:${UI.muted};
      color:${UI.fg};
      font-family:${UI.mono};
      font-size:${UI.text.xs};
      font-weight:${UI.weight.regular};
      line-height:${UI.leading.tight};
      white-space:nowrap;
      ${TEXT_RESET}
    `;
    return el;
  }

  // Aborts the running request and leaves the selected text untouched. Shared by
  // the toast's cancel button and the Alt+Shift+Esc shortcut.
  function cancelActiveJob() {
    chrome.runtime.sendMessage({ action: "cancelAI" });
    showToast("Cancelling...", "info");
  }

  // Alt+Shift+Esc cancels a running request. This can't be a chrome.commands
  // shortcut — Chrome reserves Escape and won't bind it — so it's a page-level
  // listener instead, which means it works while the page has focus.
  //
  // Capture phase + stopPropagation so it fires before the Reply Assist and
  // model-picker panels, which close on a bare Escape.
  document.addEventListener("keydown", (e) => {
    if (!aiInProgress && !cancelCurrentReview) return;
    if (e.key !== "Escape" && e.code !== "Escape") return;
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (cancelCurrentReview) cancelCurrentReview();
    else cancelActiveJob();
  }, true);

  // Sonner-style toast: neutral popover surface with a coloured status icon,
  // rather than a fully colour-flooded bar.
  function showToast(message, type = "info", options = {}) {
    ensureKeyframes();
    aiInProgress = type === "working";

    const toastId = "lbx-ai-toast";
    let toast = document.getElementById(toastId);

    if (!toast) {
      toast = document.createElement("div");
      toast.id = toastId;
      toast.setAttribute("data-lbx-ui", "");
      document.body.appendChild(toast);
    }

    // A toast that is on its way out is being reused: cancel both the fade and
    // the removal so it doesn't disappear while showing the new message.
    clearTimeout(toast._hideTimer);
    clearTimeout(toast._removeTimer);
    clearInterval(toast._elapsedTimer);
    toast.dataset.type = type;
    // Live region only: a toast never takes focus.
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
    toast.setAttribute("aria-atomic", "true");

    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-sizing: border-box;
      max-width: min(360px, calc(100% - 40px));
      padding: 10px 12px;
      border: 1px solid ${UI.border};
      border-radius: ${UI.radius.lg};
      background: ${UI.bg};
      color: ${UI.fg};
      font-family: ${UI.font};
      font-size: ${UI.text.sm};
      font-weight: ${UI.weight.medium};
      line-height: ${UI.leading.snug};
      ${TEXT_RESET}
      text-align: left;
      box-shadow: ${UI.shadow};
      z-index: 2147483647;
      margin: 0 !important;
      opacity: 1;
      transform: none !important;
      transition: opacity .25s ease;
      pointer-events: none !important;
    `;

    const statuses = {
      working: { icon: ICON.spinner, color: UI.primary },
      success: { icon: ICON.check, color: UI.success },
      error: { icon: ICON.alert, color: UI.destructive },
      info: { icon: ICON.info, color: UI.mutedFg }
    };
    const status = statuses[type] || statuses.info;

    toast.innerHTML = "";
    // The toast itself never intercepts clicks; only its buttons do.

    const iconWrap = document.createElement("span");
    iconWrap.innerHTML = status.icon;
    iconWrap.setAttribute("aria-hidden", "true");
    alignInjectedIcons(iconWrap);
    iconWrap.style.cssText = `display:flex;align-items:center;justify-content:center;flex:0 0 14px;width:14px;height:14px;color:${status.color};${TEXT_RESET}`;
    toast.appendChild(iconWrap);

    const textSpan = document.createElement("span");
    textSpan.innerText = message;
    textSpan.style.cssText = `flex:1;min-width:0;${TEXT_RESET}`;
    toast.appendChild(textSpan);

    if (type === "working") {
      // Elapsed time shows the request is alive. Status updates during one
      // request (e.g. "Trying fallback") keep counting from the first.
      if (!toast._workingSince) toast._workingSince = Date.now();
      const elapsed = document.createElement("span");
      elapsed.style.cssText = `flex-shrink:0;color:${UI.mutedFg};font-variant-numeric:tabular-nums;font-size:${UI.text.xs};line-height:${UI.leading.tight};${TEXT_RESET}`;
      const tick = () => { elapsed.textContent = `${Math.floor((Date.now() - toast._workingSince) / 1000)}s`; };
      tick();
      toast._elapsedTimer = setInterval(tick, 1000);
      toast.appendChild(elapsed);

      const kbd = makeKbd("Alt+Shift+Esc");
      kbd.style.flexShrink = "0";
      kbd.title = "Cancel without changing your text";
      toast.appendChild(kbd);

      const cancelBtn = makeButton("", {
        variant: "ghost",
        size: "icon",
        icon: ICON.x,
        title: "Cancel (Alt+Shift+Esc)",
        ariaLabel: "Cancel request"
      });
      cancelBtn.style.marginLeft = "2px";
      cancelBtn.onclick = cancelActiveJob;
      toast.appendChild(cancelBtn);
    }

    if (typeof options.copyText === "string" && options.copyText) {
      const copyBtn = makeButton("Copy result", { variant: "secondary", size: "sm" });
      copyBtn.style.flexShrink = "0";
      copyBtn.onclick = async () => {
        copyBtn.disabled = true;
        try {
          await navigator.clipboard.writeText(options.copyText);
          // A later request may already have replaced this toast.
          if (toast.contains(copyBtn)) showToast("Copied! Paste the result into your message.", "success");
        } catch {
          if (toast.contains(copyBtn)) {
            textSpan.innerText = "Could not copy. Try again, or copy the result from extension history.";
            copyBtn.disabled = false;
          }
        }
      };
      toast.appendChild(copyBtn);
    }

    if (options.onRetry) {
      const retryBtn = makeButton(options.retryLabel || "Retry", {
        variant: "secondary",
        size: "sm",
        icon: ICON.rotate
      });
      retryBtn.style.marginLeft = "2px";
      retryBtn.onclick = () => {
        hideToast(toast);
        options.onRetry();
      };
      toast.appendChild(retryBtn);
    }

    if (options.onRetry || options.copyText) {
      // Result warnings remain available until copied or dismissed.
      const closeBtn = makeButton("", {
        variant: "ghost",
        size: "icon",
        icon: ICON.x,
        title: "Dismiss notification"
      });
      closeBtn.style.marginLeft = "2px";
      closeBtn.onclick = () => hideToast(toast);
      toast.appendChild(closeBtn);
    }

    restackFloatingUI();

    if (type !== "working") toast._workingSince = null;
    // Retry notices allow more time, but always expire.
    if (type !== "working" && !options.copyText) {
      toast._hideTimer = setTimeout(() => hideToast(toast), options.onRetry ? 15000 : options.durationMs || 4000);
    } else if (type === "working") {
      // Safety net: if the background worker dies mid-request no final toast
      // ever arrives. Say so instead of spinning forever or vanishing silently.
      const limit = options.timeoutMs || 90000;
      toast._hideTimer = setTimeout(() => {
        showToast(`No answer after ${Math.round(limit / 1000)} seconds. Your text is unchanged; please try again.`, "error");
      }, limit);
    }
  }

  // Dismissed notices leave the DOM immediately, including their buttons.
  function hideToast(toast) {
    toast = toast || document.getElementById("lbx-ai-toast");
    if (!toast) return;
    clearTimeout(toast._hideTimer);
    clearTimeout(toast._removeTimer);
    clearInterval(toast._elapsedTimer);
    toast.remove();
  }

  // Command-menu style popover listing the models available for a retry.
  function showModelPickerPanel(models) {
    const existing = document.getElementById("lbx-model-picker-panel");
    if (existing) existing._dismiss();

    ensureKeyframes();
    const panel = document.createElement("div");
    panel.id = "lbx-model-picker-panel";
    panel.setAttribute("data-lbx-ui", "");
    panel.style.cssText = `
      position: fixed;
      bottom: 76px;
      right: 20px;
      box-sizing: border-box;
      width: min(290px, calc(100% - 40px));
      border: 1px solid ${UI.border};
      border-radius: ${UI.radius.lg};
      background: ${UI.bg};
      color: ${UI.fg};
      font-family: ${UI.font};
      font-size: ${UI.text.sm};
      line-height: ${UI.leading.snug};
      ${TEXT_RESET}
      box-shadow: ${UI.shadow};
      z-index: 2147483647;
      overflow: hidden;
    `;

    const header = document.createElement("div");
    header.textContent = "Retry with model";
    header.style.cssText = `
      padding: 10px 14px 8px;
      border-bottom: 1px solid ${UI.border};
      font-family: ${UI.font};
      font-size: ${UI.text.xs};
      font-weight: ${UI.weight.medium};
      line-height: ${UI.leading.tight};
      ${TEXT_RESET}
      color: ${UI.mutedFg};
    `;

    const list = document.createElement("div");
    list.style.cssText = `padding:4px;max-height:260px;overflow-y:auto;${TEXT_RESET}`;

    models.forEach(m => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = m.label;
      btn.style.cssText = `
        display: block;
        width: 100%;
        text-align: left;
        box-sizing: border-box;
        margin: 0;
        padding: 8px 10px;
        border: none;
        border-radius: ${UI.radius.sm};
        background: transparent;
        color: ${UI.fg};
        font-family: ${UI.font};
        font-size: ${UI.text.sm};
        font-weight: ${UI.weight.regular};
        line-height: ${UI.leading.snug};
        ${TEXT_RESET}
        white-space: normal;
        cursor: pointer;
        transition: background-color .12s;
      `;
      btn.onmouseover = () => { btn.style.background = UI.muted; };
      btn.onmouseout = () => { btn.style.background = "transparent"; };
      btn.onclick = () => {
        panel._dismiss();
        chrome.runtime.sendMessage({ action: "retryAI", model: m.id, provider: m.provider });
      };
      list.appendChild(btn);
    });

    panel.appendChild(header);
    panel.appendChild(list);
    document.body.appendChild(panel);
    restackFloatingUI();

    const closeOnOutside = event => { if (!panel.contains(event.target)) panel._dismiss(); };
    const closeOnEscape = event => { if (event.key === "Escape") panel._dismiss(); };
    let attachTimer, expiryTimer;
    panel._dismiss = () => {
      clearTimeout(attachTimer); clearTimeout(expiryTimer);
      document.removeEventListener("click", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      panel.remove();
    };
    attachTimer = setTimeout(() => document.addEventListener("click", closeOnOutside, true), 100);
    document.addEventListener("keydown", closeOnEscape, true);
    expiryTimer = setTimeout(panel._dismiss, 15000);
  }

  // Non-blocking bottom-right panel — page stays interactive while open.
  // Selection is saved before rendering so focus change doesn't matter.
  // The selection was saved by getSelection, possibly in another frame; this
  // panel only collects context.
  function showReplyAssistPanel(selectedText) {
    const existing = document.getElementById("lbx-reply-assist-panel");
    if (existing) { unwatchPanel(existing); existing.remove(); }
    const previousFocus = focusedElement();

    ensureKeyframes();
    const panel = document.createElement("div");
    panel.id = "lbx-reply-assist-panel";
    panel.setAttribute("data-lbx-ui", "");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-labelledby", "lbx-reply-assist-title");
    panel.setAttribute("aria-describedby", "lbx-reply-assist-desc");
    panel.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      box-sizing: border-box;
      width: min(340px, calc(100% - 40px));
      border: 1px solid ${UI.border};
      border-radius: ${UI.radius.lg};
      background: ${UI.bg};
      color: ${UI.fg};
      font-family: ${UI.font};
      font-size: ${UI.text.sm};
      line-height: ${UI.leading.normal};
      ${TEXT_RESET}
      text-align: left;
      box-shadow: ${UI.shadow};
      z-index: 2147483647;
      overflow: hidden;
      display: block !important;
      margin: 0 !important;
      transform: none !important;
      pointer-events: auto !important;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      padding: 14px 12px 0 16px;
      ${TEXT_RESET}
    `;

    const titleWrap = document.createElement("div");
    titleWrap.style.cssText = `min-width:0;flex:1;padding-top:2px;${TEXT_RESET}`;

    const titleEl = document.createElement("div");
    titleEl.id = "lbx-reply-assist-title";
    titleEl.textContent = "Reply Assist";
    titleEl.style.cssText = `font-family:${UI.font};font-size:${UI.text.base};font-weight:${UI.weight.semibold};line-height:${UI.leading.tight};color:${UI.fg};${TEXT_RESET}`;

    const descEl = document.createElement("div");
    descEl.id = "lbx-reply-assist-desc";
    descEl.textContent = "Refine the selected text in context.";
    descEl.style.cssText = `font-family:${UI.font};font-size:${UI.text.sm};font-weight:${UI.weight.regular};line-height:${UI.leading.snug};color:${UI.mutedFg};margin-top:4px;${TEXT_RESET}`;

    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(descEl);

    const closeBtn = makeButton("", { variant: "ghost", size: "icon", icon: ICON.x, title: "Close", ariaLabel: "Close Reply Assist" });

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement("div");
    body.style.cssText = `padding:14px 16px 16px;${TEXT_RESET}`;

    const preview = document.createElement("div");
    const previewText = selectedText.length > 90 ? selectedText.slice(0, 90) + "…" : selectedText;
    preview.textContent = previewText;
    preview.style.cssText = `
      box-sizing: border-box;
      padding: 8px 10px;
      margin: 0 0 16px;
      border: 1px solid ${UI.border};
      border-radius: ${UI.radius.md};
      background: ${UI.field};
      color: ${UI.mutedFg};
      font-family: ${UI.font};
      font-size: ${UI.text.sm};
      line-height: ${UI.leading.normal};
      ${TEXT_RESET}
      word-break: break-word;
    `;

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Paste conversation, describe tone, or add instructions…";
    textarea.setAttribute("aria-label", "Context (optional)");
    textarea.rows = 3;
    textarea.style.cssText = `
      display: block;
      width: 100%;
      min-height: 72px;
      margin: 0;
      padding: 8px 10px;
      border: 1px solid ${UI.border};
      border-radius: ${UI.radius.md};
      background: ${UI.field};
      color: ${UI.fg};
      font-family: ${UI.font};
      font-size: ${UI.text.base};
      line-height: ${UI.leading.normal};
      ${TEXT_RESET}
      resize: vertical;
      box-sizing: border-box;
      outline: none;
      pointer-events: auto !important;
      transition: border-color .15s, box-shadow .15s;
    `;
    // The ring itself comes from the shared [data-lbx-ui] :focus-visible rule.
    textarea.addEventListener("focus", () => {
      textarea.style.borderColor = UI.ring;
    });
    textarea.addEventListener("blur", () => {
      textarea.style.borderColor = UI.border;
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
      padding: 12px 16px;
      border-top: 1px solid ${UI.border};
      ${TEXT_RESET}
    `;

    const hint = document.createElement("div");
    hint.style.cssText = `display:flex;align-items:center;gap:4px;margin-right:auto;min-width:0;${TEXT_RESET}`;
    hint.appendChild(makeKbd("Ctrl+↵"));
    hint.appendChild(makeKbd("Esc"));

    const cancelBtn = makeButton("Cancel", { variant: "ghost" });
    const refineBtn = makeButton("Refine", { variant: "primary" });

    function submit() {
      const context = textarea.value.trim();
      unwatchPanel(panel);
      panel.remove();
      restackFloatingUI();
      chrome.runtime.sendMessage({ action: "replyAssistSubmit", selectedText, context });
    }

    function cancel() {
      unwatchPanel(panel);
      panel.remove();
      restackFloatingUI();
      returnFocus(previousFocus, panel);
    }

    refineBtn.onclick = submit;
    cancelBtn.onclick = cancel;
    closeBtn.onclick = cancel;

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });
    // Escape closes from anywhere in the panel; Tab stays inside it.
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      trapTabKey(e, panel, document);
    });

    footer.appendChild(hint);
    footer.appendChild(cancelBtn);
    footer.appendChild(refineBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    // Appended to <html> like the Review host, so a Reply opened while Review
    // is open paints above it (same z-index, later in the DOM).
    (document.documentElement || document.body).appendChild(panel);
    watchPanel(panel);
    restackFloatingUI();

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
    const buffers = [];

    if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
      const prev = range.startContainer.childNodes[range.startOffset - 1];
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const buffer = document.createTextNode("\u200B");
        range.startContainer.insertBefore(buffer, range.startContainer.childNodes[range.startOffset] || null);
        buffers.push(buffer);
        range.setStart(buffer, 1);
        if (wasCollapsed) range.setEnd(buffer, 1);
      }
    }

    if (!wasCollapsed && range.endContainer.nodeType === Node.ELEMENT_NODE) {
      const next = range.endContainer.childNodes[range.endOffset];
      if (next && next.nodeType === Node.ELEMENT_NODE) {
        const buffer = document.createTextNode("\u200B");
        range.endContainer.insertBefore(buffer, next);
        buffers.push(buffer);
        range.setEnd(buffer, 0);
      }
    }
    return buffers;
  }

  // The zero-width buffers only steer the caret; never leave them in the message.
  function removeBuffers(buffers) {
    for (const buffer of buffers) {
      if (!buffer.isConnected) continue;
      if (buffer.data === "\u200B") buffer.remove();
      else buffer.data = buffer.data.replace(/\u200B/g, "");
    }
  }

  // Rich-text editors (e.g. Slack) can wipe an entire editable region when the
  // replaced selection included a non-text embed such as an @mention chip —
  // execCommand("insertText") deletes the whole selection but the host page's
  // own editor sometimes fails to reconcile that and clears the field. Detect
  // that and restore the original text so the user's message isn't lost.
  async function insertTextGuarded(el, replacement, original) {
    const before = el.innerText;
    const sel = getSelectionFor(el);
    const buffers = sel.rangeCount > 0 ? bufferAwayFromAdjacentElement(sel.getRangeAt(0)) : [];
    if (!document.execCommand("insertText", false, replacement)) {
      removeBuffers(buffers);
      throw new Error("This editor could not accept the text. Copy the result and paste it manually.");
    }
    removeBuffers(buffers);
    // Let framework editors reconcile the native edit before acknowledging it.
    await new Promise(resolve => setTimeout(resolve, 50));
    if (!el.isConnected) {
      throw new Error("The editor was replaced. Copy the result from extension history and paste it manually.");
    }
    if (original.trim() && replacement.trim() && el.innerText.trim() === "") {
      document.execCommand("insertText", false, original);
      throw new Error("Couldn't safely replace this text — original text restored. Copy the result and paste it manually.");
    }
    if (original !== replacement && el.innerText === before) {
      throw new Error("The editor did not keep the replacement. Copy the result from extension history and paste it manually.");
    }
  }

  function recoverEditableRange(info) {
    const el = info.element;
    const text = info.rangeText ?? info.text;
    if (!el.isConnected || el.textContent !== info.value || !text) return null;
    const start = el.textContent.indexOf(text);
    if (start < 0 || el.textContent.indexOf(text, start + 1) >= 0) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0, foundStart = false, node;
    while ((node = walker.nextNode())) {
      const end = offset + node.length;
      if (!foundStart && start < end) {
        range.setStart(node, start - offset);
        foundStart = true;
      }
      if (foundStart && start + text.length <= end) {
        range.setEnd(node, start + text.length - offset);
        return range;
      }
      offset = end;
    }
    return null;
  }

  async function replaceSelectedText(original, replacement) {
    // If we have a saved selection from Reply Assist, restore it and use it
    if (savedSelectionInfo) {
      const info = savedSelectionInfo;
      if (info.text !== original) {
        throw new Error("Another selection replaced this request. Copy the result from extension history and paste it manually.");
      }

      if (info.type === "input" && info.element) {
        const el = info.element;
        if (!el.isConnected || el.value !== info.value || el.value.substring(info.start, info.end) !== info.text) {
          throw new Error("The original text changed. Copy the result and paste it where you need it.");
        }
        el.focus();
        const value = el.value;
        const setter = Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set;
        const expected = value.substring(0, info.start) + replacement + value.substring(info.end);
        setter.call(el, expected);
        el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.setSelectionRange(info.start, info.start + replacement.length);
        await new Promise(resolve => setTimeout(resolve, 50));
        if (!el.isConnected || el.value !== expected) {
          throw new Error("The field did not keep the replacement. Copy the result from extension history and paste it manually.");
        }
        if (savedSelectionInfo === info) savedSelectionInfo = null;
        return;
      }

      if (info.type === "contenteditable" && info.element && info.range) {
        const el = info.element;
        if (!el.isConnected) {
          throw new Error("The original text changed. Copy the result and paste it where you need it.");
        }
        if (!el.contains(info.range.commonAncestorContainer) || info.range.toString() !== (info.rangeText ?? info.text)) {
          info.range = recoverEditableRange(info);
        }
        if (!info.range) throw new Error("The original selection changed. Copy the result from extension history and paste it manually.");
        el.focus();
        const sel = getSelectionFor(el);
        sel.removeAllRanges();
        sel.addRange(info.range);
        await insertTextGuarded(el, replacement, original);
        if (savedSelectionInfo === info) savedSelectionInfo = null;
        return;
      }

      if (info.type === "selection" && info.range) {
        if (!info.range.startContainer.isConnected || !info.range.endContainer.isConnected || info.range.toString() !== original) {
          throw new Error("The original selection changed. Copy the result from extension history and paste it manually.");
        }
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(info.range);
        info.range.deleteContents();
        info.range.insertNode(document.createTextNode(replacement));
        if (savedSelectionInfo === info) savedSelectionInfo = null;
        return;
      }
      throw new Error("The original field is no longer available. Copy the result from extension history and paste it manually.");
    }

    throw new Error("The original selection is no longer available. Copy the result from extension history and paste it manually.");
  }

  function showInlineReviewPanel(request) {
    const previous = document.getElementById("lbx-inline-review");
    if (previous?.dataset.reviewId) chrome.runtime.sendMessage({ action: "cancelReview", reviewId: previous.dataset.reviewId });
    unwatchPanel(previous);
    previous?.remove();
    const previousFocus = focusedElement();
    const host = document.createElement("div");
    host.id = "lbx-inline-review";
    host.dataset.reviewId = request.reviewId;
    host.style.cssText = "all:initial;position:fixed;right:20px;bottom:20px;max-width:calc(100% - 40px);z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "open" });
    const actions = [
      ["fixGrammar", "Fix spelling & grammar"], ["addPolish", "Add polish"],
      ["toneFormal", "Make more formal"], ["toneCasual", "Make more casual"],
      ["toneEmpathetic", "Make more empathetic"], ["toneEmojis", "Add emojis"],
      ["emailStyle", "Rewrite as an email"], ["makeShorter", "Make shorter"],
      ["makeLonger", "Make longer"], ["translatePolish", "Translate to Polish"],
      ["translateUkrainian", "Translate to Ukrainian"], ["translateEnglish", "Translate to English"],
      ["formatMarkdown", "Format as Markdown"], ["formatSlack", "Format for Slack"],
      ["translit", "Fix keyboard layout"], ["aiPrompt", "Use as an AI prompt"]
    ];
    shadow.innerHTML = `
      <style>
        :host{color-scheme:dark}
        *,*::before,*::after{box-sizing:border-box}
        .panel{width:min(340px,calc(100vw - 40px));max-width:100%;max-height:calc(100vh - 40px);overflow:auto;border:1px solid ${UI.border};border-radius:${UI.radius.lg};background:${UI.bg};color:${UI.fg};font:${UI.weight.regular} ${UI.text.sm}/${UI.leading.normal} ${UI.font};letter-spacing:normal;text-align:left;box-shadow:${UI.shadow}}
        .top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:14px 12px 0 16px}
        .heading{min-width:0;flex:1;padding-top:2px}.heading strong{display:block;font-size:${UI.text.base};font-weight:${UI.weight.semibold};line-height:${UI.leading.tight};color:${UI.fg}}
        .heading p{margin:4px 0 0;font-size:${UI.text.sm};line-height:${UI.leading.snug};color:${UI.mutedFg}}
        button,select,textarea{font:inherit;margin:0}button{cursor:pointer}button:disabled{opacity:${UI.disabledOpacity};cursor:default}
        svg{display:block;position:static;width:14px;height:14px;flex:0 0 14px}
        .close{display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:${UI.radius.sm};background:transparent;color:${UI.mutedFg};font-size:${UI.text.sm};line-height:${UI.leading.tight}}
        .close:hover{background:${UI.muted};color:${UI.fg}}
        .body{padding:14px 16px 16px}
        .field{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
        .fieldhead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:20px}
        .lab{display:flex;align-items:center;gap:8px;min-width:0}
        label{font-size:${UI.text.sm};font-weight:${UI.weight.medium};line-height:${UI.leading.tight};color:${UI.fg}}
        .count{font-size:${UI.text.xs};line-height:${UI.leading.tight};color:${UI.mutedFg};font-variant-numeric:tabular-nums;white-space:nowrap}
        select{width:100%;height:34px;border:1px solid ${UI.border};border-radius:${UI.radius.md};background:${UI.field};color:${UI.fg};padding:0 8px;font:${UI.weight.regular} ${UI.text.base}/${UI.leading.normal} ${UI.font}}
        :focus{outline:none}:focus-visible{outline:2px solid ${UI.ring};outline-offset:2px}
        select:focus-visible,textarea:focus-visible{border-color:${UI.ring}}
        .text{display:block;width:100%;min-height:72px;max-height:160px;resize:vertical;border:1px solid ${UI.border};border-radius:${UI.radius.md};background:${UI.field};color:${UI.fg};padding:8px 10px;font:${UI.weight.regular} ${UI.text.base}/${UI.leading.normal} ${UI.font};transition:border-color .15s}
        .text:disabled{color:${UI.mutedFg}}.text::placeholder{color:${UI.mutedFg}}.result{min-height:88px}
        .badge{display:inline-flex;align-items:center;padding:1px 8px;border:1px solid ${UI.border};border-radius:${UI.radius.pill};color:${UI.mutedFg};font-size:${UI.text.xs};font-weight:${UI.weight.medium};line-height:${UI.leading.tight};white-space:nowrap}
        .badge[data-state="success"]{color:${UI.success};border-color:${UI.successBorder}}
        .badge[data-state="destructive"]{color:${UI.destructive};border-color:${UI.destructiveBorder}}
        .status{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;min-height:${2 * UI.leading.snug}em;color:${UI.mutedFg};font-size:${UI.text.sm};line-height:${UI.leading.snug};overflow-wrap:anywhere}.status.error{display:block;-webkit-line-clamp:none;overflow:visible;color:${UI.destructive}}.status.good{color:${UI.success}}
        .footer{padding:12px 16px 14px;border-top:1px solid ${UI.border}}
        .actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}
        .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;border-radius:${UI.radius.md};padding:0 12px;border:1px solid transparent;background:transparent;color:${UI.fg};font-size:${UI.text.sm};font-weight:${UI.weight.medium};line-height:${UI.leading.tight};white-space:nowrap;transition:background-color .15s,color .15s}
        .btn:hover:not(:disabled){background:${UI.muted}}
        .btn.outline{border-color:${UI.border};background:${UI.field}}
        .btn.primary{background:${UI.primary};color:${UI.primaryFg}}.btn.primary:hover:not(:disabled){background:${UI.primaryHover}}
        .hint{display:flex;align-items:center;gap:4px;color:${UI.mutedFg};font-size:${UI.text.xs};line-height:${UI.leading.tight};margin:10px 0 0}
        .hint span{margin-left:4px}
        .hint kbd{display:inline-flex;align-items:center;font:${UI.weight.regular} ${UI.text.xs}/${UI.leading.tight} ${UI.mono};border:1px solid ${UI.border};background:${UI.muted};border-radius:${UI.radius.sm};padding:2px 7px;color:${UI.fg};white-space:nowrap}
        .panel:focus-visible{outline:none}
        @media (prefers-reduced-motion: reduce){${REDUCED_MOTION("*,*::before,*::after")}}
        .spin{width:12px;height:12px;flex:0 0 12px;border:2px solid ${UI.mutedFg};border-top-color:${UI.fg};border-radius:50%;display:block;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
      </style>
      <section class="panel" role="dialog" aria-modal="false" aria-labelledby="review-title" aria-describedby="review-desc" tabindex="-1">
        <header class="top"><div class="heading"><strong id="review-title">Review text</strong><p id="review-desc">Refine, review, then copy or apply.</p></div><button type="button" class="close" id="close" aria-label="Close review" title="Close">${ICON.x}</button></header>
        <main class="body">
          <div class="field"><label for="action">Editing action</label><select id="action" aria-label="Choose an editing action"></select></div>
          <div class="field"><div class="fieldhead"><label for="source">Your text</label><span class="count" id="source-count">0 characters</span></div><textarea id="source" class="text" aria-label="Your text" placeholder="Type or paste text to refine…"></textarea></div>
          <div class="field"><div class="fieldhead"><span class="lab"><label for="result">Improved version</label><span class="badge" id="badge" data-state="neutral">Ready</span></span><span class="count" id="result-count">0 characters</span></div><textarea id="result" class="text result" aria-label="Improved version" placeholder="Your refined text will appear here…"></textarea></div>
          <div id="status" class="status" role="status" aria-live="polite"></div>
        </main>
        <footer class="footer"><div class="actions"><button type="button" class="btn ghost" id="cancel">Cancel</button><button type="button" class="btn outline" id="rewrite">${ICON.rotate}<span>Regenerate</span></button><button type="button" class="btn primary" id="done" disabled>Done &amp; copy</button></div><p class="hint"><kbd>Ctrl + Enter</kbd><kbd>Esc</kbd><span>Apply or close</span></p></footer>
      </section>`;
    (document.documentElement || document.body).appendChild(host);

    const $ = (id) => shadow.getElementById(id);
    const source = $("source"), result = $("result"), actionSelect = $("action");
    let lastResult = null;
    let processing = false;
    for (const [value, label] of actions) {
      const option = document.createElement("option");
      option.value = value; option.textContent = label; actionSelect.appendChild(option);
    }
    actionSelect.value = request.actionId || "fixGrammar";
    source.value = request.original || "";

    function counts() {
      $("source-count").textContent = `${source.value.length.toLocaleString()} characters`;
      $("result-count").textContent = `${result.value.length.toLocaleString()} characters`;
      $("done").disabled = processing || !lastResult || !result.value.trim();
    }
    // Popup-style badge: the text says what happened, data-state picks the tint.
    function badge(text, state = "neutral") {
      $("badge").textContent = text;
      $("badge").dataset.state = state;
    }
    function status(message, type = "") {
      $("status").textContent = message;
      // Normal states are clamped to two reserved lines (no height change); errors wrap in full.
      $("status").title = message;
      $("status").className = `status ${type}`;
    }
    async function run() {
      if (!source.value.trim()) { status("Add or paste some text above to begin.", "error"); source.focus(); return; }
      processing = true; lastResult = null; source.disabled = true;
      counts();
      $("rewrite").disabled = true; actionSelect.disabled = true;
      $("rewrite").innerHTML = '<span class="spin"></span> Working';
      badge("Processing");
      status("Working on your text…");
      try {
        const response = await chrome.runtime.sendMessage({
          action: "processReview", reviewId: request.reviewId,
          actionId: actionSelect.value, text: source.value
        });
        if (!response?.ok) throw new Error(response?.error || "Could not process this text.");
        result.value = response.text;
        if (!host.isConnected) return;
        lastResult = { tokens: response.tokens, responseTimeMs: response.responseTimeMs, action: actionSelect.value, originalText: source.value };
        badge("Editable", "success");
        status("Ready. Make any final changes, then apply it to the page.", "good");
        counts(); result.focus();
      } catch (error) {
        badge("Try again", "destructive");
        status(error.message || "Something went wrong. Please try again.", "error");
      } finally {
        processing = false; source.disabled = false;
        counts();
        $("rewrite").disabled = false; actionSelect.disabled = false;
        $("rewrite").innerHTML = ICON.rotate + '<span>Regenerate</span>';
      }
    }
    async function copyResult() {
      try { await navigator.clipboard.writeText(result.value); return true; }
      catch {
        const temp = document.createElement("textarea");
        temp.value = result.value; temp.style.cssText = "position:fixed;opacity:0;";
        shadow.appendChild(temp); temp.focus(); temp.select();
        const copied = document.execCommand("copy"); temp.remove(); return copied;
      }
    }

    source.addEventListener("input", counts);
    result.addEventListener("input", counts);
    $("rewrite").addEventListener("click", run);
    actionSelect.addEventListener("change", () => { if (source.value.trim()) run(); });
    function closeReview({ restore = true } = {}) {
      chrome.runtime.sendMessage({ action: "cancelReview", reviewId: request.reviewId });
      const hadFocus = host.contains(document.activeElement);
      unwatchPanel(host);
      host.remove();
      restackFloatingUI();
      cancelCurrentReview = null;
      if (restore) {
        restoreSavedSelection();
        if (hadFocus && !savedSelectionInfo?.element?.isConnected) returnFocus(previousFocus, host);
      }
    }
    $("cancel").addEventListener("click", () => closeReview());
    $("close").addEventListener("click", () => closeReview());
    cancelCurrentReview = closeReview;
    $("done").addEventListener("click", async () => {
      if (!lastResult || !result.value.trim()) return;
      $("done").disabled = true; $("done").textContent = "Applying…";
      const copied = await copyResult();
      try {
        if (!copied) throw new Error("Could not copy the result. Select it above and copy it manually.");
        const response = await chrome.runtime.sendMessage({
          action: "commitReview", reviewId: request.reviewId, originalText: lastResult.originalText,
          text: result.value, actionId: lastResult.action,
          tokens: lastResult.tokens, responseTimeMs: lastResult.responseTimeMs
        });
        if (!response?.ok) throw new Error(response?.error || "Could not apply the result.");
        status(response.replaced ? "Applied to the page and copied to your clipboard." : "Copied to your clipboard. Paste it where you need it.", "good");
        badge("Applied", "success");
        cancelCurrentReview = null;
        setTimeout(() => {
          const hadFocus = host.contains(document.activeElement);
          unwatchPanel(host);
          host.remove();
          restackFloatingUI();
          if (hadFocus) returnFocus(previousFocus, host);
        }, 600);
      } catch (error) {
        status(error.message || "Could not apply the result.", "error");
        $("done").disabled = false; $("done").textContent = "Done & copy";
      }
    });
    shadow.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault(); event.stopPropagation();
        if (!$("done").disabled) $("done").click();
      }
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        $("cancel").click();
        return;
      }
      trapTabKey(event, shadow.querySelector(".panel"), shadow);
    });

    watchPanel(host);
    restackFloatingUI();
    counts();
    // Move focus into the dialog; run() moves it on to the result when ready.
    shadow.querySelector(".panel").focus({ preventScroll: true });
    if (!request.original?.trim()) {
      status(request.canReplace
        ? "Nothing selected. Type text above; the result will be inserted at your cursor."
        : "Nothing selected. Type text above; the result will be copied when you finish.");
      source.focus();
    } else {
      run();
    }
  }
}

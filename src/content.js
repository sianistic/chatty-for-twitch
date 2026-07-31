(function startChatty() {
  "use strict";

  const core = globalThis.ChattyCore;
  const VIRTUAL_OVERSCAN = 10;
  const VIRTUAL_ROW_HEIGHT = 28;
  const VIRTUAL_VIEWPORT_FALLBACK = 480;
  const OUTGOING_ECHO_TTL = 15000;
  const state = {
    root: null,
    list: null,
    virtualWindow: null,
    virtualTop: null,
    virtualBottom: null,
    messages: [],
    virtualStart: -1,
    virtualEnd: -1,
    virtualRowHeight: VIRTUAL_ROW_HEIGHT,
    virtualRenderFrame: 0,
    virtualDirty: false,
    followLatest: true,
    settings: core.sanitizeSettings({}),
    emotes: new Map(),
    channel: "",
    seen: new Set(),
    outgoingDrafts: [],
    processedNodes: new WeakSet(),
    messageSequence: 0,
    observer: null,
    nativeContainer: null,
    nativeComposer: null,
    nativeComposerAbort: null,
    nativeComposerResizeObserver: null,
    autocompleteRange: null,
    autocompleteQuery: "",
    autocompleteIndex: 0,
    claimedPointButtons: new WeakSet(),
    revealedFilterButtons: new WeakSet(),
    unreadCount: 0,
    isModerator: false,
    pinnedSignature: "",
    dismissedPinnedSignature: "",
    route: window.location.href,
    rescanTimer: 0,
    pointsScanTimer: 0
  };

  const SELECTORS = {
    chatShell: [
      ".stream-chat",
      "[data-test-selector='chat-room-component-layout']",
      "[data-a-target='right-column-chat-bar']"
    ],
    message: [
      ".chat-line__message",
      "[data-a-target='chat-line-message']",
      "[data-test-selector='chat-line-message']"
    ].join(","),
    scroll: [
      "[data-a-target='chat-scroller']",
      ".chat-scrollable-area__message-container"
    ],
    nativeInput: "[data-a-target='chat-input'][contenteditable='true']",
    pinned: ".pinned-chat__highlight-card",
    pointsClaim: [
      "button[aria-label*='Claim Bonus' i]",
      "button[data-test-selector='community-points-claim-button']",
      "[data-test-selector='community-points-summary'] button[aria-label*='claim' i]",
      "[data-a-target='community-points-summary'] button[aria-label*='claim' i]"
    ].join(",")
  };

  function first(selectors, scope = document) {
    for (const selector of selectors) {
      const node = scope.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function channelFromLocation() {
    const reserved = new Set([
      "directory", "downloads", "inventory", "jobs", "p", "search",
      "settings", "subscriptions", "turbo", "videos", "wallet"
    ]);
    const name = window.location.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
    return reserved.has(name) ? "" : name;
  }

  function findViewerName() {
    const candidates = [
      "[data-a-target='user-menu-toggle'] img[alt]",
      "[data-test-selector='user-menu-dropdown__username']"
    ];
    for (const selector of candidates) {
      const node = document.querySelector(selector);
      const value = node?.getAttribute("alt") || node?.textContent;
      if (value?.trim()) return value.trim();
    }
    return "";
  }

  function makeButton(label, title, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chatty-button";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  function buildPanel(host) {
    const panel = document.createElement("section");
    const logoUrl = chrome.runtime.getURL?.("assets/icons/chatty-32.png") || "assets/icons/chatty-32.png";
    panel.id = "chatty-panel";
    panel.setAttribute("aria-label", "Chatty message stream");
    panel.innerHTML = `
      <header class="chatty-header">
        <div class="chatty-title-wrap">
          <div class="chatty-title-line">
            <img class="chatty-logo" src="${logoUrl}" alt="">
            <strong class="chatty-title">Chatty</strong>
          </div>
          <span class="chatty-status">Connecting…</span>
        </div>
        <div class="chatty-actions"></div>
      </header>
      <aside class="chatty-pinned" aria-label="Pinned message" hidden>
        <div class="chatty-pinned-header">
          <strong>PINNED</strong>
          <span class="chatty-pinned-meta"></span>
          <div class="chatty-pinned-actions">
            <button type="button" class="chatty-pinned-open">View</button>
            <button type="button" class="chatty-pinned-hide">Hide</button>
          </div>
        </div>
        <div class="chatty-pinned-content"></div>
      </aside>
      <div class="chatty-list" role="log" aria-live="polite" aria-relevant="additions">
        <div class="chatty-virtual-spacer chatty-virtual-top" aria-hidden="true"></div>
        <div class="chatty-virtual-window"></div>
        <div class="chatty-virtual-spacer chatty-virtual-bottom" aria-hidden="true"></div>
      </div>
      <button type="button" class="chatty-jump" hidden>Jump to latest</button>
      <div class="chatty-autocomplete" role="listbox" aria-label="7TV emotes" hidden></div>
      <div class="chatty-emote-card" role="tooltip" hidden>
        <img class="chatty-emote-preview" alt="">
        <div>
          <strong class="chatty-emote-name"></strong>
          <span class="chatty-emote-provider"></span>
          <small class="chatty-emote-details"></small>
        </div>
      </div>
      <div class="chatty-settings" hidden>
        <nav class="chatty-settings-tabs" aria-label="Settings sections">
          <button type="button" class="chatty-tab is-active" data-settings-tab="chat">Chat</button>
          <button type="button" class="chatty-tab" data-settings-tab="automation">Automation</button>
        </nav>
        <section data-settings-panel="chat">
          <label>Highlight users <input data-setting="highlightUsers" placeholder="user1, user2"></label>
          <label>Highlight words <input data-setting="highlightWords" placeholder="giveaway, your phrase"></label>
          <div class="chatty-setting-row">
            <label>Highlight <input type="color" data-setting="highlightColor"></label>
            <label>Mention <input type="color" data-setting="mentionColor"></label>
          </div>
          <label class="chatty-check"><input type="checkbox" data-setting="timestamps"> Timestamps</label>
          <label class="chatty-check"><input type="checkbox" data-setting="compact"> Compact rows</label>
          <label>Font size <input type="range" min="10" max="22" data-setting="fontSize"></label>
        </section>
        <section data-settings-panel="automation" hidden>
          <label class="chatty-check">
            <input type="checkbox" data-setting="autoClaimPoints">
            Automatically claim bonus channel points
          </label>
          <label class="chatty-check">
            <input type="checkbox" data-setting="autoOpenLive">
            Open watched channels when they go live
          </label>
          <label>
            Watched Twitch channels
            <textarea data-setting="liveChannels" rows="4" placeholder="xqc, pokimane"></textarea>
          </label>
          <label>
            Check every
            <select data-setting="liveCheckMinutes">
              <option value="1">1 minute</option>
              <option value="2">2 minutes</option>
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
            </select>
          </label>
          <small class="chatty-settings-note">A channel opens once when its state changes from offline to live.</small>
        </section>
        <button type="button" class="chatty-save">Save settings</button>
      </div>`;

    const actions = panel.querySelector(".chatty-actions");
    actions.append(makeButton("\u2699", "Chatty settings", toggleSettings));
    host.classList.add("chatty-host");
    host.append(panel);
    state.root = panel;
    state.list = panel.querySelector(".chatty-list");
    state.virtualWindow = panel.querySelector(".chatty-virtual-window");
    state.virtualTop = panel.querySelector(".chatty-virtual-top");
    state.virtualBottom = panel.querySelector(".chatty-virtual-bottom");
    state.list.addEventListener("scroll", handleVirtualScroll, { passive: true });
    panel.querySelector(".chatty-jump").addEventListener("click", jumpToLatest);
    panel.querySelector(".chatty-pinned-open").addEventListener("click", openNativePinned);
    panel.querySelector(".chatty-pinned-hide").addEventListener("click", hidePinnedMessage);
    panel.querySelector(".chatty-save").addEventListener("click", savePanelSettings);
    for (const tab of panel.querySelectorAll("[data-settings-tab]")) {
      tab.addEventListener("click", switchSettingsTab);
    }
    panel.addEventListener("mouseover", showEmoteCard);
    panel.addEventListener("focusin", showEmoteCard);
    panel.addEventListener("mouseout", hideEmoteCard);
    panel.addEventListener("focusout", hideEmoteCard);
    applySettings();
    syncNativeComposer(host);
    syncPinnedMessage();
    scanChannelPoints();
  }

  function switchSettingsTab(event) {
    const selected = event.currentTarget.dataset.settingsTab;
    for (const tab of state.root.querySelectorAll("[data-settings-tab]")) {
      tab.classList.toggle("is-active", tab.dataset.settingsTab === selected);
    }
    for (const panel of state.root.querySelectorAll("[data-settings-panel]")) {
      panel.hidden = panel.dataset.settingsPanel !== selected;
    }
  }

  function syncNativeComposer(host) {
    const composer =
      host.querySelector(".chat-input") ||
      document.querySelector(".chat-input");
    if (!composer) {
      setStatus("Waiting for Twitch composer\u2026");
      return;
    }
    if (state.nativeComposer === composer) {
      measureNativeComposer();
      return;
    }

    state.nativeComposerAbort?.abort();
    state.nativeComposerResizeObserver?.disconnect();
    state.nativeComposer?.classList.remove("chatty-native-composer");
    state.nativeComposer = composer;
    composer.classList.add("chatty-native-composer");
    state.nativeComposerAbort = new AbortController();

    const input = composer.querySelector(SELECTORS.nativeInput);
    input?.addEventListener("input", updateAutocomplete, {
      signal: state.nativeComposerAbort.signal
    });
    input?.addEventListener("keydown", handleAutocompleteKeys, {
      capture: true,
      signal: state.nativeComposerAbort.signal
    });
    composer.addEventListener("keydown", captureOutgoingEnter, {
      capture: true,
      signal: state.nativeComposerAbort.signal
    });
    composer.addEventListener("click", captureOutgoingClick, {
      capture: true,
      signal: state.nativeComposerAbort.signal
    });

    if (typeof ResizeObserver === "function") {
      state.nativeComposerResizeObserver = new ResizeObserver(measureNativeComposer);
      state.nativeComposerResizeObserver.observe(composer);
    }
    measureNativeComposer();
  }

  function measureNativeComposer() {
    const host = state.root?.parentElement;
    if (!host || !state.nativeComposer) return;
    const measured = Math.ceil(state.nativeComposer.getBoundingClientRect().height);
    host.style.setProperty(
      "--chatty-native-composer-height",
      `${Math.max(72, measured || 90)}px`
    );
  }

  function autocompleteContext(input) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !input.contains(selection.anchorNode)) return null;
    const caret = selection.getRangeAt(0);
    if (!caret.collapsed) return null;
    const before = caret.cloneRange();
    before.selectNodeContents(input);
    before.setEnd(caret.endContainer, caret.endOffset);
    const match = before.toString().match(/(?:^|\s)([^\s]{2,})$/);
    if (!match) return null;
    return { query: match[1], range: caret.cloneRange() };
  }

  function updateAutocomplete(event) {
    const context = autocompleteContext(event.currentTarget);
    if (!context) {
      hideAutocomplete();
      return;
    }
    const suggestions = core.findEmoteSuggestions(
      context.query,
      state.emotes,
      8
    );
    if (!suggestions.length) {
      hideAutocomplete();
      return;
    }
    state.autocompleteQuery = context.query;
    state.autocompleteRange = context.range;
    state.autocompleteIndex = 0;
    renderAutocomplete(suggestions);
  }

  function renderAutocomplete(suggestions) {
    const menu = state.root?.querySelector(".chatty-autocomplete");
    if (!menu) return;
    menu.replaceChildren();
    for (const [index, emote] of suggestions.entries()) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "chatty-autocomplete-option";
      option.classList.toggle("is-active", index === state.autocompleteIndex);
      option.dataset.emoteName = emote.name;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === state.autocompleteIndex));
      const image = document.createElement("img");
      image.src = emote.url;
      image.alt = "";
      const label = document.createElement("span");
      label.textContent = emote.name;
      option.append(image, label);
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        completeAutocomplete(emote.name);
      });
      menu.append(option);
    }
    menu.hidden = false;
  }

  function handleAutocompleteKeys(event) {
    const menu = state.root?.querySelector(".chatty-autocomplete");
    if (!menu || menu.hidden) return;
    const options = Array.from(menu.querySelectorAll(".chatty-autocomplete-option"));
    if (!options.length) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      state.autocompleteIndex =
        (state.autocompleteIndex + direction + options.length) % options.length;
      options.forEach((option, index) => {
        option.classList.toggle("is-active", index === state.autocompleteIndex);
        option.setAttribute("aria-selected", String(index === state.autocompleteIndex));
      });
      return;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      completeAutocomplete(options[state.autocompleteIndex].dataset.emoteName);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideAutocomplete();
    }
  }

  function completeAutocomplete(name) {
    const input = state.nativeComposer?.querySelector(SELECTORS.nativeInput);
    const selection = window.getSelection();
    if (!input || !selection || !state.autocompleteRange) return;
    input.focus();
    const replacementRange = state.autocompleteRange.cloneRange();
    const before = replacementRange.cloneRange();
    before.selectNodeContents(input);
    before.setEnd(
      state.autocompleteRange.endContainer,
      state.autocompleteRange.endOffset
    );
    const desiredOffset = Math.max(
      0,
      before.toString().length - state.autocompleteQuery.length
    );
    const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let textNode;
    while ((textNode = walker.nextNode())) {
      const next = consumed + textNode.nodeValue.length;
      if (desiredOffset <= next) {
        replacementRange.setStart(textNode, desiredOffset - consumed);
        break;
      }
      consumed = next;
    }
    selection.removeAllRanges();
    selection.addRange(replacementRange);
    const replacement = `${name} `;
    const inserted = document.execCommand("insertText", false, replacement);
    if (!inserted && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const text = document.createTextNode(replacement);
      range.insertNode(text);
      range.setStartAfter(text);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: replacement
      }));
    }
    hideAutocomplete();
  }

  function hideAutocomplete() {
    const menu = state.root?.querySelector(".chatty-autocomplete");
    if (menu) {
      menu.hidden = true;
      menu.replaceChildren();
    }
    state.autocompleteRange = null;
    state.autocompleteQuery = "";
    state.autocompleteIndex = 0;
  }

  function largestImageCandidate(srcset) {
    return String(srcset || "")
      .split(",")
      .map((candidate) => {
        const [url, descriptor = "1x"] = candidate.trim().split(/\s+/);
        return {
          url,
          score: Number.parseFloat(descriptor) || 1
        };
      })
      .filter((candidate) => candidate.url)
      .sort((left, right) => right.score - left.score)[0]?.url || "";
  }

  function highResolutionBadgeUrl(image) {
    const source =
      largestImageCandidate(image.srcset) ||
      image.currentSrc ||
      image.src;
    try {
      const url = new URL(source, window.location.href);
      if (
        /(^|\.)jtvnw\.net$/i.test(url.hostname) &&
        url.pathname.startsWith("/badges/v1/")
      ) {
        url.pathname = url.pathname.replace(/\/(?:1|2|3)$/, "/3");
      }
      return url.href;
    } catch {
      return source;
    }
  }

  function showEmoteCard(event) {
    const emote = event.target.closest?.(".chatty-emote, .chatty-badge");
    if (!emote || !state.root?.contains(emote)) return;
    const card = state.root.querySelector(".chatty-emote-card");
    const preview = card.querySelector(".chatty-emote-preview");
    preview.src = emote.dataset.previewSrc || emote.src;
    preview.alt = emote.alt;
    card.querySelector(".chatty-emote-name").textContent =
      emote.dataset.emoteName || emote.alt || "Emote";
    card.querySelector(".chatty-emote-provider").textContent =
      emote.dataset.provider || "Twitch";
    const details = [
      emote.dataset.owner ? `by ${emote.dataset.owner}` : "",
      emote.dataset.animated === "true" ? "Animated" : "",
      emote.dataset.emoteId ? `ID ${emote.dataset.emoteId}` : ""
    ].filter(Boolean);
    card.querySelector(".chatty-emote-details").textContent = details.join(" · ");
    card.hidden = false;

    const panelRect = state.root.getBoundingClientRect();
    const emoteRect = emote.getBoundingClientRect();
    const left = Math.min(
      state.root.clientWidth - card.offsetWidth - 8,
      Math.max(8, emoteRect.left - panelRect.left - card.offsetWidth / 2 + emoteRect.width / 2)
    );
    const above = emoteRect.top - panelRect.top - card.offsetHeight - 8;
    card.style.left = `${left}px`;
    card.style.top = `${above > 44 ? above : emoteRect.bottom - panelRect.top + 8}px`;
  }

  function hideEmoteCard(event) {
    if (event.relatedTarget?.closest?.(".chatty-emote-card")) return;
    const card = state.root?.querySelector(".chatty-emote-card");
    if (card) card.hidden = true;
  }

  function toggleSettings() {
    const settings = state.root.querySelector(".chatty-settings");
    settings.hidden = !settings.hidden;
    if (!settings.hidden) populateSettingsForm();
  }

  function findClaimButton() {
    return document.querySelector(SELECTORS.pointsClaim);
  }

  function scanChannelPoints() {
    if (!state.root) return;
    const claim = findClaimButton();

    if (
      claim &&
      state.settings.autoClaimPoints &&
      !state.claimedPointButtons.has(claim)
    ) {
      state.claimedPointButtons.add(claim);
      claim.click();
      setStatus("Bonus auto-claimed");
    }
  }

  function schedulePointsScan() {
    if (state.pointsScanTimer) return;
    state.pointsScanTimer = setTimeout(() => {
      state.pointsScanTimer = 0;
      scanChannelPoints();
    }, 250);
  }

  function populateSettingsForm() {
    for (const element of state.root.querySelectorAll("[data-setting]")) {
      const key = element.dataset.setting;
      const value = state.settings[key];
      if (element.type === "checkbox") element.checked = Boolean(value);
      else if (Array.isArray(value)) element.value = value.join(", ");
      else element.value = value;
    }
  }

  async function savePanelSettings() {
    const next = { ...state.settings };
    for (const element of state.root.querySelectorAll("[data-setting]")) {
      const key = element.dataset.setting;
      next[key] = element.type === "checkbox" ? element.checked : element.value;
    }
    state.settings = core.sanitizeSettings(next);
    await chrome.storage.sync.set({ chattySettings: state.settings });
    applySettings();
    scanChannelPoints();
    toggleSettings();
  }

  function applySettings() {
    if (!state.root) return;
    state.root.style.setProperty("--chatty-font-size", `${state.settings.fontSize}px`);
    state.root.classList.toggle("chatty-roomy", !state.settings.compact);
    state.root.classList.toggle("chatty-no-time", !state.settings.timestamps);
    state.virtualRowHeight = state.settings.compact ? VIRTUAL_ROW_HEIGHT : 34;
    state.virtualDirty = true;
    trimMessageHistory();
    scheduleVirtualRender();
  }

  function setStatus(text) {
    const node = state.root?.querySelector(".chatty-status");
    if (node) node.textContent = text;
  }

  function virtualViewportHeight() {
    return state.list?.clientHeight || VIRTUAL_VIEWPORT_FALLBACK;
  }

  function virtualScrollHeight() {
    return state.messages.length * state.virtualRowHeight;
  }

  function effectiveScrollHeight() {
    if (!state.list) return virtualScrollHeight();
    const viewport = virtualViewportHeight();
    return state.list.scrollHeight > viewport
      ? state.list.scrollHeight
      : virtualScrollHeight();
  }

  function isNearBottom() {
    if (!state.list) return true;
    return (
      effectiveScrollHeight() -
      state.list.scrollTop -
      virtualViewportHeight() <
      80
    );
  }

  function handleVirtualScroll() {
    state.followLatest = isNearBottom();
    scheduleVirtualRender();
    updateJumpButton();
  }

  function updateJumpButton() {
    const button = state.root?.querySelector(".chatty-jump");
    if (!button) return;
    const nearBottom = state.followLatest || isNearBottom();
    if (nearBottom) {
      state.followLatest = true;
      state.unreadCount = 0;
    }
    button.hidden = nearBottom;
    button.textContent = state.unreadCount
      ? `${state.unreadCount} new - Jump to latest`
      : "Jump to latest";
  }

  function jumpToLatest() {
    if (!state.list) return;
    state.followLatest = true;
    renderVirtualWindow();
    state.list.scrollTop = effectiveScrollHeight();
    state.unreadCount = 0;
    updateJumpButton();
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function collectFragments(container) {
    const fragments = [];
    function visit(parent) {
      for (const child of parent.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.nodeValue) fragments.push({ type: "text", value: child.nodeValue });
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.matches("[data-a-target='chat-badge'], [data-a-target='chat-message-username']")) {
          continue;
        }
        if (child instanceof HTMLImageElement) {
          fragments.push({
            type: "image",
            src: child.currentSrc || child.src,
            alt: child.alt || child.title || "emote"
          });
          continue;
        }
        if (child instanceof HTMLAnchorElement) {
          const href = safeHttpUrl(child.href);
          if (href) {
            fragments.push({ type: "link", href, value: child.textContent || href });
            continue;
          }
        }
        visit(child);
      }
    }
    visit(container);
    return fragments;
  }

  function appendFragments(container, fragments) {
    for (const fragment of fragments) {
      if (fragment.type === "link") {
        const link = document.createElement("a");
        link.className = "chatty-link";
        link.href = fragment.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = fragment.value || fragment.href;
        container.append(link);
        continue;
      }
      if (fragment.type === "image") {
        const image = document.createElement("img");
        image.className = "chatty-emote";
        image.src = fragment.src;
        image.alt = fragment.alt;
        image.title = fragment.alt;
        image.loading = "lazy";
        image.decoding = "async";
        image.fetchPriority = "low";
        decorateEmote(image, {
          name: fragment.alt,
          provider: "Twitch",
          id: twitchEmoteId(fragment.src)
        });
        container.append(image);
        continue;
      }
      for (const token of core.tokenizeEmotes(fragment.value, state.emotes)) {
        if (token.type === "text") {
          container.append(document.createTextNode(token.value));
          continue;
        }
        const image = document.createElement("img");
        image.className = "chatty-emote";
        image.src = token.emote.url;
        image.alt = token.value;
        image.title = token.value;
        image.loading = "lazy";
        image.decoding = "async";
        image.fetchPriority = "low";
        decorateEmote(image, token.emote);
        container.append(image);
      }
    }
  }

  function readPinnedMessage(node) {
    if (!node) return null;
    const messageNode = node.querySelector(".pinned-chat__message");
    if (!messageNode) return null;
    const meta = node.querySelector(".pinned-chat__pinned-by")?.textContent?.trim() || "Pinned message";
    const fragments = collectFragments(messageNode);
    const text = fragments.map((fragment) => fragment.value || fragment.alt || "").join("").trim();
    const signature = `${meta}|${text}|${fragments.map((fragment) => fragment.href || "").join("|")}`;
    return { meta, fragments, signature, nativeNode: node };
  }

  function syncPinnedMessage() {
    if (!state.root) return;
    const nativePinned = Array.from(document.querySelectorAll(SELECTORS.pinned))
      .find((node) => !state.root.contains(node));
    const pinned = readPinnedMessage(nativePinned);
    const panel = state.root.querySelector(".chatty-pinned");
    if (!pinned || pinned.signature === state.dismissedPinnedSignature) {
      panel.hidden = true;
      if (!pinned) state.pinnedSignature = "";
      return;
    }
    if (pinned.signature === state.pinnedSignature && !panel.hidden) return;
    state.pinnedSignature = pinned.signature;
    panel.dataset.signature = pinned.signature;
    panel.querySelector(".chatty-pinned-meta").textContent = pinned.meta;
    const content = panel.querySelector(".chatty-pinned-content");
    content.replaceChildren();
    appendFragments(content, pinned.fragments);
    panel.hidden = false;
  }

  function mutationsTouchSelector(records, selector) {
    const nodeTouchesSelector = (node) =>
      node?.nodeType === Node.ELEMENT_NODE &&
      (
        node.matches?.(selector) ||
        node.querySelector?.(selector)
      );
    return records.some((record) => {
      if (record.target?.closest?.(selector)) return true;
      return [...record.addedNodes, ...record.removedNodes].some(nodeTouchesSelector);
    });
  }

  function openNativePinned() {
    const nativePinned = Array.from(document.querySelectorAll(SELECTORS.pinned))
      .find((node) => !state.root?.contains(node));
    const button = Array.from(nativePinned?.querySelectorAll("button") || [])
      .find((candidate) => /expand|view/i.test(
        `${candidate.getAttribute("aria-label") || ""} ${candidate.textContent || ""}`
      ));
    button?.click();
  }

  function hidePinnedMessage() {
    const panel = state.root?.querySelector(".chatty-pinned");
    if (!panel) return;
    state.dismissedPinnedSignature = panel.dataset.signature || state.pinnedSignature;
    panel.hidden = true;
  }

  function findNativeContainer(shell) {
    for (const selector of SELECTORS.scroll) {
      const node = shell.querySelector(selector);
      if (node) return node;
    }
    const message = shell.querySelector(SELECTORS.message);
    return message?.parentElement || null;
  }

  function readMessage(node) {
    const usernameNode =
      node.querySelector("[data-a-user]") ||
      node.querySelector("[data-a-target='chat-message-username']") ||
      node.querySelector(".chat-author__display-name");
    const username =
      usernameNode?.getAttribute("data-a-user") ||
      usernameNode?.textContent?.trim() ||
      "";
    const body =
      node.querySelector("[data-a-target='chat-line-message-body']") ||
      node.querySelector(".text-fragment")?.parentElement ||
      node;
    const fragments = collectFragments(body);
    const text = fragments
      .map((fragment) => fragment.value || fragment.alt || "")
      .join("")
      .trim();
    if (!username && !text) return null;

    const id =
      node.getAttribute("data-id") ||
      node.querySelector("[data-a-target='chat-message-text']")?.id ||
      `chatty-${++state.messageSequence}`;
    const color =
      usernameNode?.style?.color ||
      getComputedStyle(usernameNode || node).color ||
      "#adadb8";
    const badges = Array.from(
      node.querySelectorAll("img.chat-badge, [data-a-target='chat-badge'] img, img[alt$='Badge']")
    ).map((image) => ({
      src: image.currentSrc || image.src,
      previewSrc: highResolutionBadgeUrl(image),
      alt: image.alt || "badge"
    }));
    const reward = Boolean(
      node.querySelector("[data-test-selector*='reward'], [data-a-target*='reward']") ||
      node.closest("[data-test-selector*='reward']")
    );
    return {
      id,
      username,
      text,
      color,
      badges,
      fragments,
      reward,
      usernameNode,
      nativeNode: node
    };
  }

  function createMessageRow(message) {
    const row = document.createElement("div");
    row.className = "chatty-message";
    row.dataset.messageId = message.id;
    const highlight = core.getHighlight(message, state.settings, findViewerName());
    if (highlight) {
      row.classList.add(`chatty-highlight-${highlight.type}`);
      row.style.setProperty("--chatty-highlight", highlight.color);
    }
    if (message.reward) row.classList.add("chatty-reward");

    const time = document.createElement("time");
    time.className = "chatty-time";
    time.textContent = new Date(message.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    row.append(time);

    const badges = document.createElement("span");
    badges.className = "chatty-badges";
    for (const badge of message.badges) {
      const image = document.createElement("img");
      image.className = "chatty-badge";
      image.src = badge.src;
      image.alt = badge.alt;
      image.title = badge.alt;
      image.loading = "lazy";
      image.decoding = "async";
      image.fetchPriority = "low";
      image.tabIndex = 0;
      image.dataset.emoteName = badge.alt || "Twitch badge";
      image.dataset.provider = "Twitch badge";
      image.dataset.previewSrc = badge.previewSrc || badge.src;
      image.setAttribute("aria-label", `${badge.alt || "Twitch"} badge`);
      badges.append(image);
    }
    row.append(badges);

    const name = document.createElement("button");
    name.type = "button";
    name.className = "chatty-name";
    name.style.color = message.color;
    name.textContent = message.username;
    name.title = `Open ${message.username}'s Twitch user card`;
    name.addEventListener("click", () => openUserCard(message));
    row.append(name, document.createTextNode(": "));

    const content = document.createElement("span");
    content.className = "chatty-content";
    appendFragments(content, message.fragments || [{ type: "text", value: message.text }]);
    row.append(content);
    if (
      state.isModerator &&
      message.username &&
      message.username.toLowerCase() !== findViewerName().toLowerCase()
    ) {
      row.append(buildModeratorActions(message));
    }
    return row;
  }

  function trimMessageHistory() {
    const excess = state.messages.length - state.settings.maxMessages;
    if (excess <= 0) return;
    state.messages.splice(0, excess);
    if (!state.followLatest && state.list) {
      state.list.scrollTop = Math.max(
        0,
        state.list.scrollTop - excess * state.virtualRowHeight
      );
    }
  }

  function renderVirtualWindow() {
    if (!state.list || !state.virtualWindow) return;
    const total = state.messages.length;
    const viewport = virtualViewportHeight();
    const visibleRows = Math.ceil(viewport / state.virtualRowHeight);
    const windowSize = visibleRows + VIRTUAL_OVERSCAN * 2;
    const start = state.followLatest
      ? Math.max(0, total - windowSize)
      : Math.max(
        0,
        Math.min(
          Math.floor(state.list.scrollTop / state.virtualRowHeight) - VIRTUAL_OVERSCAN,
          Math.max(0, total - windowSize)
        )
      );
    const end = Math.min(total, start + windowSize);

    if (
      !state.virtualDirty &&
      start === state.virtualStart &&
      end === state.virtualEnd
    ) {
      return;
    }

    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      fragment.append(createMessageRow(state.messages[index]));
    }
    state.virtualWindow.replaceChildren(fragment);
    state.virtualTop.style.height = `${start * state.virtualRowHeight}px`;
    state.virtualBottom.style.height = `${(total - end) * state.virtualRowHeight}px`;
    state.virtualStart = start;
    state.virtualEnd = end;
    state.virtualDirty = false;

    if (state.followLatest) {
      state.list.scrollTop = effectiveScrollHeight();
      state.unreadCount = 0;
    }
    updateJumpButton();
  }

  function scheduleVirtualRender() {
    if (state.virtualRenderFrame) return;
    state.virtualRenderFrame = 1;
    queueMicrotask(() => {
      state.virtualRenderFrame = 0;
      renderVirtualWindow();
    });
  }

  function normalizeEchoText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function composerDraftText(input) {
    if (!input) return "";
    return collectFragments(input)
      .map((fragment) => fragment.value || fragment.alt || "")
      .join("");
  }

  function rememberOutgoingDraft(value) {
    const text = normalizeEchoText(value);
    if (!text) return false;
    const now = Date.now();
    state.outgoingDrafts = state.outgoingDrafts.filter(
      (draft) => now - draft.createdAt < OUTGOING_ECHO_TTL
    );
    state.outgoingDrafts.push({
      text,
      createdAt: now,
      matches: 0,
      username: ""
    });
    return true;
  }

  function captureOutgoingEnter(event) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      event.defaultPrevented
    ) {
      return;
    }
    const input = event.target?.closest?.(SELECTORS.nativeInput);
    if (input) rememberOutgoingDraft(composerDraftText(input));
  }

  function captureOutgoingClick(event) {
    const button = event.target?.closest?.("[data-a-target='chat-send-button']");
    if (!button || !event.currentTarget.contains(button)) return;
    const input = event.currentTarget.querySelector(SELECTORS.nativeInput);
    rememberOutgoingDraft(composerDraftText(input));
  }

  function isDuplicateOutgoingEcho(message) {
    const text = normalizeEchoText(message.text);
    if (!text) return false;
    const now = Date.now();
    state.outgoingDrafts = state.outgoingDrafts.filter(
      (draft) => now - draft.createdAt < OUTGOING_ECHO_TTL
    );
    const index = state.outgoingDrafts.findLastIndex(
      (draft) => draft.text === text
    );
    if (index < 0) return false;

    const draft = state.outgoingDrafts[index];
    const username = String(message.username || "").trim().toLowerCase();
    if (draft.matches === 0) {
      draft.matches = 1;
      draft.username = username;
      return false;
    }
    if (draft.username && username !== draft.username) return false;
    if (!draft.username && username) draft.username = username;
    draft.matches += 1;
    return true;
  }

  function appendMessage(message) {
    if (!message || state.seen.has(message.id)) return;
    state.seen.add(message.id);
    if (isDuplicateOutgoingEcho(message)) return;
    if (state.seen.size > state.settings.maxMessages * 2) {
      state.seen = new Set(Array.from(state.seen).slice(-state.settings.maxMessages));
    }

    state.messages.push({
      ...message,
      timestamp: message.timestamp || Date.now(),
      usernameNode: null,
      nativeNode: null
    });
    trimMessageHistory();
    if (state.followLatest) state.unreadCount = 0;
    else state.unreadCount += 1;
    state.virtualDirty = true;
    scheduleVirtualRender();
  }

  function detectModerator(scope = document) {
    if (
      document.querySelector(
        "[data-a-target='mod-view-button'], [data-test-selector='mod-view-link'], a[href*='/moderator/']"
      )
    ) {
      return true;
    }
    const viewer = findViewerName().toLowerCase();
    if (!viewer) return false;
    for (const message of scope.querySelectorAll?.(SELECTORS.message) || []) {
      const username =
        message.querySelector("[data-a-user]")?.getAttribute("data-a-user") ||
        message.querySelector("[data-a-target='chat-message-username']")?.textContent ||
        "";
      if (username.trim().toLowerCase() !== viewer) continue;
      const badgeText = Array.from(
        message.querySelectorAll("img[alt], [data-a-target='chat-badge']")
      ).map((node) => `${node.getAttribute("alt") || ""} ${node.textContent || ""}`).join(" ");
      if (/\b(moderator|broadcaster)\b/i.test(badgeText)) return true;
    }
    return false;
  }

  function buildModeratorActions(message) {
    const actions = document.createElement("span");
    actions.className = "chatty-mod-actions";
    const definitions = [
      ["delete", "Del", "Delete this message"],
      ["timeout", "10m", `Timeout ${message.username} for 10 minutes`],
      ["ban", "Ban", `Ban ${message.username}`]
    ];
    for (const [action, label, title] of definitions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.modAction = action;
      button.textContent = label;
      button.title = title;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        runModeratorAction(action, message);
      });
      actions.append(button);
    }
    return actions;
  }

  function runModeratorAction(action, message) {
    if (!state.isModerator) return;
    if (action === "ban" && !window.confirm(`Ban ${message.username}?`)) return;
    const command = action === "delete"
      ? `/delete ${message.id}`
      : action === "timeout"
        ? `/timeout ${message.username} 600`
        : `/ban ${message.username}`;
    sendNativeCommand(command);
  }

  function sendNativeCommand(command) {
    const input = state.nativeComposer?.querySelector(SELECTORS.nativeInput);
    const send = state.nativeComposer?.querySelector("[data-a-target='chat-send-button']");
    const selection = window.getSelection();
    if (!input || !send || !selection) {
      setStatus("Moderator command unavailable");
      return;
    }
    const previousDraft = input.textContent || "";
    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    const inserted = document.execCommand("insertText", false, command);
    if (!inserted) {
      input.textContent = command;
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: command
      }));
    }
    send.click();
    setStatus(`Moderator action sent for ${command.split(" ")[1] || "message"}`);
    if (previousDraft) {
      setTimeout(() => {
        input.textContent = previousDraft;
        input.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: previousDraft
        }));
      }, 80);
    }
  }

  function twitchEmoteId(src) {
    return String(src || "").match(/\/emoticons\/v2\/([^/]+)/)?.[1] || "";
  }

  function decorateEmote(image, emote) {
    image.tabIndex = 0;
    image.dataset.emoteName = emote.name || image.alt || "Emote";
    image.dataset.provider = emote.provider || "Twitch";
    image.dataset.owner = emote.owner || "";
    image.dataset.animated = String(Boolean(emote.animated));
    image.dataset.emoteId = emote.id || "";
    image.setAttribute(
      "aria-label",
      `${image.dataset.emoteName} - ${image.dataset.provider} emote`
    );
  }

  function openUserCard(message) {
    let usernameNode = message.usernameNode;
    if (!usernameNode?.isConnected) {
      const username = message.username.toLowerCase();
      const nodes = Array.from(
        state.nativeContainer?.querySelectorAll("[data-a-user]") || []
      ).filter((node) =>
        node.getAttribute("data-a-user")?.toLowerCase() === username
      );
      usernameNode = nodes[nodes.length - 1];
    }
    if (usernameNode) {
      usernameNode.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      }));
      return;
    }
    setStatus(`User card unavailable for ${message.username}`);
  }

  function revealFilteredMessage(node) {
    const button = Array.from(node.querySelectorAll("button")).find((candidate) => {
      if (state.revealedFilterButtons.has(candidate)) return false;
      const label = `${candidate.getAttribute("aria-label") || ""} ${candidate.textContent || ""}`;
      return (
        candidate.matches("[data-a-target*='blocked' i], [data-test-selector*='blocked' i]") ||
        candidate.closest("[data-a-target*='blocked' i], [data-test-selector*='blocked' i]") ||
        /\b(show|reveal|unhide)\b.*\bmessage\b/i.test(label)
      );
    });
    if (!button) return false;
    state.revealedFilterButtons.add(button);
    button.click();
    setTimeout(() => {
      state.processedNodes.delete(node);
      ingest(node);
    }, 0);
    return true;
  }

  function ingest(scope = document) {
    for (const node of scope.querySelectorAll?.(SELECTORS.message) || []) {
      if (state.processedNodes.has(node)) continue;
      if (revealFilteredMessage(node)) continue;
      state.processedNodes.add(node);
      appendMessage(readMessage(node));
    }
    if (scope.matches?.(SELECTORS.message) && !state.processedNodes.has(scope)) {
      if (revealFilteredMessage(scope)) return;
      state.processedNodes.add(scope);
      appendMessage(readMessage(scope));
    }
  }

  function observeNative(container) {
    state.observer?.disconnect();
    state.nativeContainer = container;
    state.isModerator = detectModerator(container);
    state.root?.classList.toggle("chatty-is-moderator", state.isModerator);
    ingest(container);
    state.observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) ingest(node);
        }
      }
    });
    state.observer.observe(container, { childList: true, subtree: true });
  }

  async function loadEmotes(channel) {
    setStatus("Loading 7TV…");
    const response = await chrome.runtime.sendMessage({ type: "CHATTY_FETCH_7TV", channel });
    if (!response?.ok) {
      setStatus("7TV unavailable");
      return;
    }
    state.emotes = core.indexEmotes([
      response.data.global,
      response.data.channelSet
    ]);
    state.virtualDirty = true;
    scheduleVirtualRender();
    setStatus(`${state.emotes.size} emotes`);
  }

  function unmount() {
    state.observer?.disconnect();
    state.nativeComposerAbort?.abort();
    state.nativeComposerResizeObserver?.disconnect();
    state.nativeComposer?.classList.remove("chatty-native-composer");
    state.root?.parentElement?.style.removeProperty("--chatty-native-composer-height");
    state.root?.remove();
    document.querySelector(".chatty-host")?.classList.remove("chatty-host");
    state.root = null;
    state.list = null;
    state.virtualWindow = null;
    state.virtualTop = null;
    state.virtualBottom = null;
    state.messages = [];
    state.virtualStart = -1;
    state.virtualEnd = -1;
    state.virtualRenderFrame = 0;
    state.virtualDirty = false;
    state.followLatest = true;
    state.nativeContainer = null;
    state.nativeComposer = null;
    state.nativeComposerAbort = null;
    state.nativeComposerResizeObserver = null;
    state.seen.clear();
    state.outgoingDrafts = [];
    state.processedNodes = new WeakSet();
    state.claimedPointButtons = new WeakSet();
    state.revealedFilterButtons = new WeakSet();
    state.unreadCount = 0;
    state.isModerator = false;
    state.pinnedSignature = "";
    state.dismissedPinnedSignature = "";
    document.documentElement.classList.remove("chatty-active");
  }

  async function mount() {
    if (!state.settings.enabled) return;
    const channel = channelFromLocation();
    const shell = first(SELECTORS.chatShell);
    if (!channel || !shell) return;
    if (state.root && state.channel === channel && state.root.isConnected) return;

    unmount();
    state.channel = channel;
    const host = shell.querySelector(".chat-room__content") || shell;
    buildPanel(host);
    const nativeContainer = findNativeContainer(shell);
    if (!nativeContainer) {
      setStatus("Waiting for chat…");
      return;
    }
    document.documentElement.classList.add("chatty-active");
    observeNative(nativeContainer);
    loadEmotes(channel);
  }

  function scheduleMount() {
    clearTimeout(state.rescanTimer);
    state.rescanTimer = setTimeout(mount, 350);
  }

  async function boot() {
    const stored = await chrome.storage.sync.get("chattySettings");
    state.settings = core.sanitizeSettings(stored.chattySettings);
    const pageObserver = new MutationObserver((records) => {
      if (window.location.href !== state.route) {
        state.route = window.location.href;
        scheduleMount();
      } else if (!state.root?.isConnected) {
        scheduleMount();
      }
      if (state.root && !state.nativeComposer?.isConnected) {
        syncNativeComposer(state.root.parentElement);
      }
      if (state.root && mutationsTouchSelector(records, SELECTORS.pinned)) {
        syncPinnedMessage();
      }
      if (state.root && mutationsTouchSelector(records, SELECTORS.pointsClaim)) {
        schedulePointsScan();
      }
    });
    pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.chattySettings) return;
      state.settings = core.sanitizeSettings(changes.chattySettings.newValue);
      if (!state.settings.enabled) unmount();
      else {
        applySettings();
        scheduleMount();
      }
    });
    mount();
  }

  boot().catch((error) => console.error("[Chatty] Failed to start:", error));
})();

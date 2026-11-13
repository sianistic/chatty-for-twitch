(function startCanty() {
  "use strict";

  const core = globalThis.ChattyCore;
  const VIRTUAL_OVERSCAN = 10;
  const VIRTUAL_ROW_HEIGHT = 28;
  const VIRTUAL_VIEWPORT_FALLBACK = 480;
  const VIRTUAL_HEIGHT_BLOCK = 64;
  const OUTGOING_ECHO_TTL = 15000;
  const messageTime = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
  const state = {
    root: null,
    list: null,
    jumpButton: null,
    virtualWindow: null,
    virtualTop: null,
    virtualBottom: null,
    virtualRows: new Map(),
    messages: [],
    historyStart: 0,
    virtualStart: -1,
    virtualEnd: -1,
    virtualHistoryStart: 0,
    virtualHistoryEnd: 0,
    virtualRowHeight: VIRTUAL_ROW_HEIGHT,
    virtualRenderedEstimate: VIRTUAL_ROW_HEIGHT,
    virtualWidth: 0,
    virtualWindowHeight: 0,
    measuredHeights: new Map(),
    heightDeltas: new Map(),
    virtualRenderFrame: 0,
    virtualRenderTimer: 0,
    virtualResizeObserver: null,
    virtualDirty: false,
    lastScrollMax: 0,
    internalScrollTop: null,
    highlightMatcher: null,
    viewerName: "",
    replyInteractionUntil: 0,
    activeReplyRow: null,
    threadAnchor: null,
    threadDirty: false,
    followLatest: true,
    search: null,
    settingsToggle: null,
    settings: core.sanitizeSettings({}),
    emotes: new Map(),
    emoteLoad: null,
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
    predictionSignature: "",
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
    chatReady: [
      ".stream-chat",
      "[data-test-selector='chat-room-component-layout']",
      "[data-a-target='chat-scroller']",
      ".chat-scrollable-area__message-container"
    ].join(","),
    nativeInput: "[data-a-target='chat-input'][contenteditable='true']",
    idleDraft: [
      ".chat-input [contenteditable='true']",
      ".chat-input textarea",
      "[data-a-target='chat-input'][contenteditable='true']",
      "[data-a-target='chat-input'] textarea"
    ].join(","),
    composer: ".chat-input, [data-a-target='chat-input'][contenteditable='true']",
    replyContext: [
      "[data-a-target='chat-message-reply-context']",
      "[data-test-selector='chat-message-reply-context']",
      "[data-a-target='reply-context']",
      "[data-test-selector='reply-context']",
      "[data-a-target*='reply-context' i]",
      "[data-test-selector*='reply-context' i]",
      ".chat-line__message--reply"
    ].join(","),
    pinned: ".pinned-chat__highlight-card",
    prediction: [
      "[data-test-selector='community-prediction-highlight']",
      "[data-a-target='community-prediction-highlight']",
      "[data-test-selector='prediction-highlight']",
      "[data-test-selector^='community-prediction-highlight-']",
      "[data-test-selector*='community-prediction' i]",
      "[data-a-target*='community-prediction' i]",
      ".community-prediction-highlight"
    ].join(","),
    predictionMutation: [
      "[data-test-selector='community-prediction-highlight']",
      "[data-a-target='community-prediction-highlight']",
      "[data-test-selector='prediction-highlight']",
      "[data-test-selector^='community-prediction-highlight-']",
      "[data-a-target^='community-prediction-highlight-']",
      ".community-prediction-highlight"
    ].join(","),
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

  function uniqueSelectorMatches(selectors, scope = document) {
    const seen = new Set();
    const matches = [];
    for (const selector of selectors) {
      for (const node of scope.querySelectorAll(selector)) {
        if (seen.has(node)) continue;
        seen.add(node);
        matches.push(node);
      }
    }
    return matches;
  }

  function elementLayoutScore(node) {
    if (
      !node?.isConnected ||
      node.closest?.("[hidden], [aria-hidden='true'], [inert]")
    ) {
      return -1;
    }
    const style = window.getComputedStyle?.(node);
    if (style?.display === "none" || style?.visibility === "hidden") return -1;
    const rect = node.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0 ? 1 : 0;
  }

  function compareLayoutRank(left, right) {
    return (
      Number(right.layout >= 0) - Number(left.layout >= 0) ||
      Number(right.layout > 0) - Number(left.layout > 0)
    );
  }

  function findChatShell(requireContainer = false) {
    const candidates = uniqueSelectorMatches(SELECTORS.chatShell);
    const scored = candidates.map((shell, index) => {
      const container = findNativeContainer(shell);
      const messages = shell.querySelectorAll(SELECTORS.message).length;
      const composer = shell.querySelector(".chat-input");
      return {
        shell,
        container,
        messages,
        composer,
        layout: elementLayoutScore(shell),
        index,
      };
    }).filter((candidate) => !requireContainer || candidate.container);
    scored.sort((left, right) =>
      compareLayoutRank(left, right) ||
      Number(Boolean(right.container)) - Number(Boolean(left.container)) ||
      right.messages - left.messages ||
      Number(Boolean(right.composer)) - Number(Boolean(left.composer)) ||
      left.index - right.index
    );
    return scored[0]?.shell || null;
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
    panel.setAttribute("aria-label", "Canty message stream");
    panel.innerHTML = `
      <header class="chatty-header">
        <div class="chatty-title-wrap">
          <div class="chatty-title-line">
            <img class="chatty-logo" src="${logoUrl}" alt="">
            <strong class="chatty-title">Canty</strong>
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
      <aside class="chatty-prediction" aria-label="Active Twitch Prediction" aria-live="polite" hidden>
        <div class="chatty-prediction-header">
          <strong>PREDICTION</strong>
          <span class="chatty-prediction-status"></span>
          <button type="button" class="chatty-prediction-open">Open in Twitch</button>
        </div>
        <div class="chatty-prediction-title"></div>
        <div class="chatty-prediction-outcomes"></div>
      </aside>
      <div id="chatty-search" class="chatty-search" role="search" aria-label="Find in chat" hidden>
        <input type="search" placeholder="Phrase or @username" aria-label="Search loaded chat">
        <span class="chatty-search-status" role="status"></span>
        <button type="button" class="chatty-search-older" title="Older match (Enter)" aria-label="Older match" disabled>↑</button>
        <button type="button" class="chatty-search-newer" title="Newer match (Shift+Enter)" aria-label="Newer match" disabled>↓</button>
      </div>
      <div class="chatty-list" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions" tabindex="0">
        <div class="chatty-virtual-spacer chatty-virtual-top" aria-hidden="true"></div>
        <div class="chatty-virtual-window"></div>
        <div class="chatty-virtual-spacer chatty-virtual-bottom" aria-hidden="true"></div>
      </div>
      <section class="chatty-thread" aria-label="Message thread" hidden>
        <header class="chatty-thread-header">
          <button type="button" class="chatty-thread-close" aria-label="Close thread">&#8592;</button>
          <strong>Thread</strong>
          <span class="chatty-thread-count"></span>
        </header>
        <div class="chatty-thread-list"></div>
      </section>
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
      <div id="chatty-settings" class="chatty-settings" aria-label="Canty settings" hidden>
        <nav class="chatty-settings-tabs" aria-label="Settings sections">
          <button type="button" class="chatty-tab is-active" data-settings-tab="chat" aria-pressed="true">Chat</button>
          <button type="button" class="chatty-tab" data-settings-tab="performance" aria-pressed="false">Performance</button>
          <button type="button" class="chatty-tab" data-settings-tab="automation" aria-pressed="false">Automation</button>
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
        <section data-settings-panel="performance" hidden>
          <label>Chat history per tab
            <input type="number" min="500" max="5000" step="1" inputmode="numeric" data-setting="maxMessages" aria-describedby="chatty-history-note">
          </label>
          <p class="chatty-settings-note" id="chatty-history-note">500–5,000 messages. A smaller history uses less memory and limits search and reply threads.</p>
          <label class="chatty-check"><input type="checkbox" data-setting="textOnlyEmotes" aria-describedby="chatty-text-emotes-note"> Show emotes as text in chat</label>
          <p class="chatty-settings-note" id="chatty-text-emotes-note">Skips Canty’s emote images and 7TV autocomplete. Twitch’s emote picker still works.</p>
          <label>Unload idle Twitch tabs
            <select data-setting="idleTwitchMinutes" aria-describedby="chatty-idle-tabs-note">
              <option value="0">Off</option>
              <option value="15">After 15 minutes</option>
              <option value="30">After 30 minutes</option>
              <option value="60">After 60 minutes</option>
            </select>
          </label>
          <p class="chatty-settings-note" id="chatty-idle-tabs-note">Only idle background tabs are eligible. Playing streams, pinned tabs, and unsent chat stay open. Unloaded tabs reload when selected and lose their in-memory chat history.</p>
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
        <p class="chatty-save-error" role="alert" hidden>Could not save settings. Please try again.</p>
        <button type="button" class="chatty-save">Save settings</button>
      </div>`;

    const actions = panel.querySelector(".chatty-actions");
    const searchToggle = makeButton("", "Find in chat", toggleChatSearch);
    searchToggle.setAttribute("aria-controls", "chatty-search");
    searchToggle.setAttribute("aria-expanded", "false");
    searchToggle.setAttribute("aria-label", "Find in chat");
    searchToggle.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>`;
    const settingsToggle = makeButton("\u2699", "Canty settings", toggleSettings);
    settingsToggle.setAttribute("aria-label", "Canty settings");
    settingsToggle.setAttribute("aria-controls", "chatty-settings");
    settingsToggle.setAttribute("aria-expanded", "false");
    actions.append(searchToggle, settingsToggle);
    host.classList.add("chatty-host");
    host.append(panel);
    state.root = panel;
    state.settingsToggle = settingsToggle;
    state.list = panel.querySelector(".chatty-list");
    state.virtualWindow = panel.querySelector(".chatty-virtual-window");
    state.virtualTop = panel.querySelector(".chatty-virtual-top");
    state.virtualBottom = panel.querySelector(".chatty-virtual-bottom");
    state.list.addEventListener("scroll", handleVirtualScroll, { passive: true });
    state.list.addEventListener("wheel", handleVirtualWheel, { passive: true });
    if (typeof ResizeObserver === "function") {
      state.virtualResizeObserver = new ResizeObserver(scheduleVirtualRender);
      state.virtualResizeObserver.observe(state.list);
      state.virtualResizeObserver.observe(state.virtualWindow);
    }
    const searchPanel = panel.querySelector(".chatty-search");
    state.search = {
      panel: searchPanel,
      toggle: searchToggle,
      input: searchPanel.querySelector("input"),
      status: searchPanel.querySelector(".chatty-search-status"),
      older: searchPanel.querySelector(".chatty-search-older"),
      newer: searchPanel.querySelector(".chatty-search-newer"),
      query: "",
      scannedThrough: 0,
      matches: [],
      selected: null,
      target: null
    };
    state.search.input.addEventListener("input", findChatMessages);
    state.search.input.addEventListener("compositionend", findChatMessages);
    state.search.older.addEventListener("click", () => stepChatSearch(-1));
    state.search.newer.addEventListener("click", () => stepChatSearch(1));
    searchPanel.addEventListener("keydown", handleChatSearchKeys);
    state.jumpButton = panel.querySelector(".chatty-jump");
    state.jumpButton.addEventListener("click", jumpToLatest);
    panel.querySelector(".chatty-pinned-open").addEventListener("click", openNativePinned);
    panel.querySelector(".chatty-pinned-hide").addEventListener("click", hidePinnedMessage);
    panel.querySelector(".chatty-prediction-open").addEventListener("click", openNativePrediction);
    panel.querySelector(".chatty-thread-close").addEventListener("click", closeThread);
    panel.querySelector(".chatty-save").addEventListener("click", savePanelSettings);
    panel.querySelector(".chatty-settings").addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      toggleSettings();
    });
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
    syncPrediction();
    scanChannelPoints();
  }

  function switchSettingsTab(event) {
    const selected = event.currentTarget.dataset.settingsTab;
    for (const tab of state.root.querySelectorAll("[data-settings-tab]")) {
      const active = tab.dataset.settingsTab === selected;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    }
    for (const panel of state.root.querySelectorAll("[data-settings-panel]")) {
      panel.hidden = panel.dataset.settingsPanel !== selected;
    }
  }

  function syncNativeComposer(host) {
    const composer = uniqueSelectorMatches([".chat-input"], host)
      .map((node, index) => ({
        node,
        index,
        input: Boolean(node.querySelector(SELECTORS.nativeInput)),
        send: Boolean(node.querySelector("[data-a-target='chat-send-button']")),
        layout: elementLayoutScore(node)
      }))
      .sort((left, right) =>
        compareLayoutRank(left, right) ||
        Number(right.input) - Number(left.input) ||
        Number(right.send) - Number(left.send) ||
        left.index - right.index
      )[0]
      ?.node || null;
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
    if (state.settings.textOnlyEmotes) return;
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
    state.settingsToggle.setAttribute("aria-expanded", String(!settings.hidden));
    if (settings.hidden) {
      state.settingsToggle.focus({ preventScroll: true });
    } else {
      settings.querySelector(".chatty-save-error").hidden = true;
      populateSettingsForm();
      settings.querySelector(".chatty-tab.is-active").focus({ preventScroll: true });
    }
  }

  function findClaimButton() {
    return document.querySelector(SELECTORS.pointsClaim);
  }

  function scanChannelPoints() {
    if (!state.root || !state.settings.autoClaimPoints) return;
    const claim = findClaimButton();

    if (
      claim &&
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
    const panel = state.root;
    const save = panel.querySelector(".chatty-save");
    const error = panel.querySelector(".chatty-save-error");
    const next = { ...state.settings };
    for (const element of panel.querySelectorAll("[data-setting]")) {
      const key = element.dataset.setting;
      if (element.type === "number" && element.value === "") continue;
      next[key] = element.type === "checkbox" ? element.checked : element.value;
    }
    const settings = core.sanitizeSettings(next);
    error.hidden = true;
    save.disabled = true;
    try {
      await chrome.storage.sync.set({ chattySettings: settings });
      if (state.root !== panel) return;
      updateSettings(settings);
      scanChannelPoints();
      if (!panel.querySelector(".chatty-settings").hidden) toggleSettings();
    } catch {
      if (state.root === panel) error.hidden = false;
    } finally {
      save.disabled = false;
    }
  }

  function updateSettings(settings) {
    const previous = state.settings;
    state.settings = settings;
    applySettings(previous);
  }

  function applySettings(previous) {
    if (!state.root) return;
    const settings = state.settings;
    const appearanceChanged = !previous || settings.fontSize !== previous.fontSize ||
      settings.compact !== previous.compact || settings.timestamps !== previous.timestamps;
    const highlightsChanged = !previous || settings.highlightColor !== previous.highlightColor ||
      settings.mentionColor !== previous.mentionColor ||
      JSON.stringify(settings.highlightUsers) !== JSON.stringify(previous.highlightUsers) ||
      JSON.stringify(settings.highlightWords) !== JSON.stringify(previous.highlightWords);
    const emotesChanged = previous && settings.textOnlyEmotes !== previous.textOnlyEmotes;
    if (appearanceChanged) {
      state.root.style.setProperty("--chatty-font-size", settings.fontSize + "px");
      state.root.classList.toggle("chatty-roomy", !settings.compact);
      state.root.classList.toggle("chatty-no-time", !settings.timestamps);
      state.virtualRowHeight = settings.compact ? VIRTUAL_ROW_HEIGHT : 34;
    }
    if (highlightsChanged) state.highlightMatcher = null;
    if (emotesChanged) {
      state.pinnedSignature = "";
      syncPinnedMessage();
      if (state.threadAnchor) state.threadDirty = true;
      hideAutocomplete();
      hideEmoteCard({});
      if (settings.textOnlyEmotes) {
        state.emotes = new Map();
        setStatus("Text-only emotes");
      } else if (state.nativeContainer?.isConnected) {
        loadEmotes(state.channel);
      }
    }
    if (appearanceChanged || highlightsChanged || emotesChanged) state.virtualDirty = true;
    if (state.virtualDirty || settings.maxMessages !== previous?.maxMessages) scheduleVirtualRender();
  }

  function setStatus(text) {
    const node = state.root?.querySelector(".chatty-status");
    if (node && node.textContent !== text) node.textContent = text;
  }

  function handleVirtualWheel(event) {
    if (state.followLatest && !event.ctrlKey && event.deltaY < 0 && state.list.scrollTop > 0) {
      state.followLatest = false;
      scheduleVirtualRender();
    }
  }

  function handleVirtualScroll() {
    const { scrollTop, scrollHeight, clientHeight } = state.list;
    const internal = state.internalScrollTop;
    state.internalScrollTop = null;
    if (internal !== null && Math.abs(scrollTop - internal) <= 0.5) return;

    const max = Math.max(0, scrollHeight - clientHeight);
    // Resizing can generate a scroll event even though the reader didn't move.
    if (max === state.lastScrollMax && state.search.target === null) {
      state.followLatest = max - scrollTop <= 1;
    }
    scheduleVirtualRender();
  }

  function setVirtualScrollTop(top) {
    const list = state.list;
    const previous = list.scrollTop;
    if (Math.abs(top - previous) <= 0.5) return;
    list.scrollTop = top;
    if (list.scrollTop !== previous) state.internalScrollTop = list.scrollTop;
  }

  function updateJumpButton() {
    const button = state.jumpButton;
    if (state.followLatest) state.unreadCount = 0;
    if (button.hidden !== state.followLatest) button.hidden = state.followLatest;
    const label = state.unreadCount
      ? `${state.unreadCount} new - Jump to latest`
      : "Jump to latest";
    if (button.textContent !== label) button.textContent = label;
  }

  function jumpToLatest() {
    if (!state.list) return;
    selectChatSearchMatch(null);
    state.followLatest = true;
    renderVirtualWindow(true);
  }

  function toggleChatSearch() {
    const search = state.search;
    search.panel.hidden = !search.panel.hidden;
    search.toggle.setAttribute("aria-expanded", String(!search.panel.hidden));
    if (search.panel.hidden) {
      search.input.value = "";
      findChatMessages();
      search.toggle.focus({ preventScroll: true });
    } else {
      search.input.focus({ preventScroll: true });
    }
  }

  function handleChatSearchKeys(event) {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      toggleChatSearch();
    } else if (event.key === "Enter" && event.target === state.search.input) {
      event.preventDefault();
      stepChatSearch(event.shiftKey ? 1 : -1);
    }
  }

  function findChatMessages(event) {
    if (event?.isComposing) return;
    const search = state.search;
    const query = search.input.value.trim().replace(/\s+/g, " ").toLowerCase();
    if (query === search.query) return;
    search.query = query;
    search.matches = [];
    search.scannedThrough = state.historyStart;
    const userQuery = query.match(/^@([a-z0-9_]+)(?: (.+))?$/);
    search.username = userQuery?.[1] || "";
    search.phrase = userQuery ? (userQuery[2] || "") : query;
    refreshChatSearch();
    selectChatSearchMatch(search.matches.at(-1) ?? null);
  }

  function refreshChatSearch() {
    const search = state.search;
    if (!search.query) return;
    const historyEnd = state.historyStart + state.messages.length;
    if (search.matches[0] < state.historyStart) {
      const expired = search.matches.findIndex((index) => index >= state.historyStart);
      search.matches.splice(0, expired < 0 ? search.matches.length : expired);
    } else if (search.scannedThrough === historyEnd) {
      return;
    }
    if (search.selected !== null && search.selected < state.historyStart) {
      selectChatSearchMatch(null);
    }
    for (let index = Math.max(0, search.scannedThrough - state.historyStart);
      index < state.messages.length; index += 1) {
      const message = state.messages[index];
      if (search.username && message.username.toLowerCase() !== search.username) continue;
      if (search.phrase && !message.text.toLowerCase().replace(/\s+/g, " ").includes(search.phrase)) continue;
      search.matches.push(state.historyStart + index);
    }
    search.scannedThrough = historyEnd;
    updateChatSearchStatus();
  }

  function updateChatSearchStatus() {
    const search = state.search;
    const count = search.matches.length;
    const position = search.matches.indexOf(search.selected);
    const label = !search.query ? "" : count === 0 ? "No matches" : position < 0
      ? `${count} ${count === 1 ? "match" : "matches"}`
      : `${position + 1} of ${count}`;
    if (search.status.textContent !== label) search.status.textContent = label;
    search.older.disabled = !count || position === 0;
    search.newer.disabled = !count || position === count - 1;
  }

  function stepChatSearch(direction) {
    const { matches, selected } = state.search;
    const position = matches.indexOf(selected);
    const index = position < 0 ? matches.length - 1 : position + direction;
    if (index >= 0 && index < matches.length) selectChatSearchMatch(matches[index]);
  }

  function selectChatSearchMatch(index) {
    const search = state.search;
    if (search.selected !== null) {
      const previous = state.messages[search.selected - state.historyStart];
      state.virtualRows.get(previous)?.classList.remove("chatty-search-match");
    }
    search.selected = index;
    search.target = index;
    updateChatSearchStatus();
    if (index === null) return;
    state.followLatest = false;
    scheduleVirtualRender();
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
    const textOnly = state.settings.textOnlyEmotes;
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
        if (textOnly) {
          container.append(document.createTextNode(fragment.alt || "emote"));
          continue;
        }
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
      if (textOnly) {
        container.append(document.createTextNode(fragment.value));
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

  function pageFeatureMutationRecords(records) {
    const host = state.root?.parentElement;
    if (!host) return [];
    return records.filter((record) => {
      const target = record.target;
      if (!target || (target !== host && !host.contains(target))) return false;
      if (state.root?.contains(target)) return false;
      if (state.nativeContainer?.contains(target)) return false;
      return true;
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

  function firstText(node, selectors) {
    for (const selector of selectors) {
      const value = node.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
      if (value) return value;
    }
    return "";
  }

  function findNativePrediction() {
    const rootSelector = [
      "[data-test-selector='community-prediction-highlight']",
      "[data-a-target='community-prediction-highlight']",
      "[data-test-selector='prediction-highlight']",
      ".community-prediction-highlight",
      ".community-highlight-stack__card",
      ".community-highlight-stack__card--wide",
      ".community-highlight"
    ].join(",");
    const scope = state.root?.parentElement || document;
    for (const marker of scope.querySelectorAll(SELECTORS.prediction)) {
      if (state.root?.contains(marker)) continue;
      const root = marker.closest(rootSelector) || marker;
      if (!state.root?.contains(root)) return root;
    }
    return null;
  }

  function readPrediction(node) {
    if (!node) return null;
    const title = firstText(node, [
      "[data-test-selector='prediction-title']",
      "[data-a-target='prediction-title']",
      "[data-test-selector='community-prediction-highlight-header__title']",
      "[data-test-selector*='prediction-title']",
      "h3",
      "h4"
    ]);
    if (!title) return null;

    let outcomeNodes = Array.from(node.querySelectorAll(
      [
        "[data-test-selector='prediction-outcome']",
        "[data-a-target='prediction-outcome']",
        "[data-test-selector='community-prediction-highlight-body__outcome']"
      ].join(",")
    ));
    if (!outcomeNodes.length) {
      outcomeNodes = Array.from(node.querySelectorAll("button")).filter((button) =>
        !/view|details|predict now|manage/i.test(
          `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`
        )
      );
    }
    const outcomes = outcomeNodes.slice(0, 4).map((outcome) => {
      const label = firstText(outcome, [
        "[data-test-selector='prediction-outcome-title']",
        "[data-a-target='prediction-outcome-title']",
        "[data-test-selector='community-prediction-highlight-body__outcome-title']",
        "strong"
      ]) || outcome.textContent?.replace(/\s+/g, " ").trim() || "Outcome";
      const detail = firstText(outcome, [
        "[data-test-selector='prediction-outcome-points']",
        "[data-test-selector='prediction-outcome-percentage']",
        "[data-a-target='prediction-outcome-points']",
        "[data-test-selector='community-prediction-highlight-body__outcome-points']",
        "small"
      ]);
      return { label, detail };
    });
    const status = firstText(node, [
      "[data-test-selector='prediction-status']",
      "[data-a-target='prediction-status']",
      "[data-test-selector*='prediction-timer']",
      "time"
    ]);
    const signature = `${title}|${status}|${outcomes
      .map((outcome) => `${outcome.label}:${outcome.detail}`)
      .join("|")}`;
    return { title, outcomes, status, signature };
  }

  function syncPrediction() {
    if (!state.root) return;
    const panel = state.root.querySelector(".chatty-prediction");
    const prediction = readPrediction(findNativePrediction());
    if (!prediction) {
      panel.hidden = true;
      state.predictionSignature = "";
      return;
    }
    if (prediction.signature === state.predictionSignature && !panel.hidden) return;
    state.predictionSignature = prediction.signature;
    panel.querySelector(".chatty-prediction-title").textContent = prediction.title;
    panel.querySelector(".chatty-prediction-status").textContent = prediction.status || "Live";
    const outcomes = panel.querySelector(".chatty-prediction-outcomes");
    outcomes.replaceChildren();
    for (const outcome of prediction.outcomes) {
      const item = document.createElement("div");
      item.className = "chatty-prediction-outcome";
      const label = document.createElement("strong");
      label.textContent = outcome.label;
      const detail = document.createElement("span");
      detail.textContent = outcome.detail;
      item.append(label, detail);
      outcomes.append(item);
    }
    panel.hidden = false;
  }

  function openNativePrediction() {
    const native = findNativePrediction();
    if (!native) {
      setStatus("No active Twitch Prediction");
      return;
    }
    const explicit = native.querySelector([
      "[data-test-selector='prediction-details']",
      "[data-test-selector='community-prediction-highlight-header__action']",
      "[data-a-target='community-prediction-highlight-action']"
    ].join(","));
    const candidates = Array.from(native.querySelectorAll("button")).filter((button) => {
      if (button.disabled || button.getAttribute("aria-disabled") === "true") return false;
      if (button.closest("[data-test-selector*='outcome' i], [data-a-target*='outcome' i]")) {
        return false;
      }
      return !/how-to-play|terms-and-conditions|send-feedback|dismiss-message/i.test(
        `${button.dataset.testSelector || ""} ${button.dataset.aTarget || ""}`
      );
    });
    const trigger = explicit && !explicit.disabled
      ? explicit
      : candidates.length === 1
        ? candidates[0]
        : native.matches("button") && !native.disabled
          ? native
          : null;
    if (trigger) {
      trigger.click();
      setStatus("Opened Twitch Prediction");
      return;
    }

    const points = document.querySelector(
      "[data-test-selector='community-points-summary'] button, " +
      "[data-a-target='community-points-summary'] button"
    );
    if (points) {
      points.click();
      setStatus("Opened Channel Points — choose Predictions");
      return;
    }
    setStatus("Prediction controls unavailable");
  }

  function findNativeContainer(shell) {
    const container = uniqueSelectorMatches(SELECTORS.scroll, shell)
      .map((node, index) => ({
        node,
        index,
        messages: node.querySelectorAll(SELECTORS.message).length,
        layout: elementLayoutScore(node)
      }))
      .sort((left, right) =>
        compareLayoutRank(left, right) ||
        right.messages - left.messages ||
        left.index - right.index
      )[0]
      ?.node;
    if (container) return container;
    const message = shell.querySelector(SELECTORS.message);
    return message?.parentElement || null;
  }

  function replyIdentity(username, text) {
    const user = String(username || "").replace(/^@/, "").trim().toLowerCase();
    const body = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
    return `${user}|${body}`;
  }

  function findReplyContextNode(node) {
    const structured = Array.from(node.querySelectorAll(SELECTORS.replyContext))
      .find((candidate) => candidate !== node);
    if (structured) return structured;
    if (!/^Replying to\b/i.test(node.getAttribute("aria-label") || "")) return null;
    return Array.from(node.querySelectorAll("p")).find((candidate) =>
      /^Replying to\b/i.test(candidate.textContent?.replace(/\s+/g, " ").trim() || "")
    ) || null;
  }

  function firstOutsideContext(node, selector, context) {
    return Array.from(node.querySelectorAll(selector)).find((candidate) =>
      !context?.contains(candidate)
    ) || null;
  }

  function currentUsernameNode(node, context = findReplyContextNode(node)) {
    return firstOutsideContext(node, "[data-a-target='chat-message-username']", context) ||
      firstOutsideContext(node, "[data-a-user]", context) ||
      firstOutsideContext(node, ".chat-author__display-name", context);
  }

  function currentMessageBody(node, context = findReplyContextNode(node)) {
    return firstOutsideContext(node, "[data-a-target='chat-line-message-body']", context) ||
      firstOutsideContext(node, ".text-fragment", context)?.parentElement ||
      node;
  }

  function readReplyContext(node, context) {
    if (!context) return null;

    const parentUserNode = context.querySelector([
      "[data-a-target*='reply-context-username' i]",
      "[data-test-selector*='reply-context-username' i]",
      "[data-a-target*='reply-parent-user' i]",
      "[data-test-selector*='reply-parent-user' i]",
      "[data-a-user]"
    ].join(","));
    const parentBodyNode = context.querySelector([
      "[data-a-target*='reply-context-body' i]",
      "[data-test-selector*='reply-context-body' i]",
      "[data-a-target*='reply-message-body' i]",
      "[data-test-selector*='reply-message-body' i]",
      "[data-a-target*='reply-text' i]",
      "[data-test-selector*='reply-text' i]"
    ].join(","));
    let parentUsername =
      context.getAttribute("data-reply-parent-user-login") ||
      context.getAttribute("data-reply-parent-display-name") ||
      parentUserNode?.getAttribute("data-a-user") ||
      parentUserNode?.textContent ||
      "";
    let parentText = parentBodyNode
      ? collectFragments(parentBodyNode)
        .map((fragment) => fragment.value || fragment.alt || "")
        .join("")
      : "";

    const raw = context.textContent?.replace(/\s+/g, " ").trim() || "";
    const parsed = raw.match(/^Replying to\s+@?([^:]+):\s*(.*)$/i);
    if (!parentUsername && parsed) parentUsername = parsed[1];
    if (!parentText && parsed) parentText = parsed[2];
    if (!parentUsername) {
      parentUsername = (node.getAttribute("aria-label") || "")
        .match(/^Replying to\s+([^,]+)/i)?.[1] || "";
    }

    parentUsername = parentUsername.replace(/^@/, "").trim();
    parentText = parentText.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!parentUsername && !parentText) return null;
    const parentMessageId =
      context.getAttribute("data-reply-parent-msg-id") ||
      context.getAttribute("data-reply-parent-message-id") ||
      context.getAttribute("data-parent-message-id") ||
      "";
    return {
      parentMessageId,
      parentUsername,
      parentText,
      signature: replyIdentity(parentUsername, parentText)
    };
  }

  function readMessage(node) {
    const replyContext = findReplyContextNode(node);
    const reply = readReplyContext(node, replyContext);
    const usernameNode = currentUsernameNode(node, replyContext);
    const username =
      usernameNode?.getAttribute("data-a-user") ||
      usernameNode?.textContent?.trim() ||
      "";
    const body = currentMessageBody(node, replyContext);
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
    ).filter((image) => !replyContext?.contains(image)).map((image) => ({
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
      reply,
      usernameNode,
      nativeNode: node
    };
  }

  function messageIdentity(message) {
    return replyIdentity(message?.username, message?.text);
  }

  function findReplyParentIndex(reply, beforeIndex) {
    if (!reply) return -1;
    for (let index = Math.min(beforeIndex - 1, state.messages.length - 1); index >= 0; index -= 1) {
      const candidate = state.messages[index];
      if (reply.parentMessageId && candidate.id === reply.parentMessageId) return index;
      if (messageIdentity(candidate) === reply.signature) return index;
    }
    return -1;
  }

  function loadedThreadMessages(anchor) {
    let currentIndex = state.messages.indexOf(anchor);
    if (currentIndex < 0) {
      currentIndex = state.messages.findIndex((message) => message.id === anchor?.id);
    }
    let current = currentIndex >= 0 ? state.messages[currentIndex] : anchor;
    let rootSignature = messageIdentity(current);
    let syntheticRoot = null;
    const visited = new Set();

    while (current?.reply && !visited.has(rootSignature)) {
      visited.add(rootSignature);
      const parentIndex = findReplyParentIndex(current.reply, currentIndex);
      if (parentIndex < 0) {
        rootSignature = current.reply.signature;
        syntheticRoot = {
          id: `thread-parent-${rootSignature}`,
          username: current.reply.parentUsername,
          text: current.reply.parentText,
          timestamp: current.timestamp,
          fragments: [{ type: "text", value: current.reply.parentText }],
          synthetic: true
        };
        break;
      }
      currentIndex = parentIndex;
      current = state.messages[currentIndex];
      rootSignature = messageIdentity(current);
    }

    const known = new Set([rootSignature]);
    const loaded = [];
    for (const message of state.messages) {
      const identity = messageIdentity(message);
      if (known.has(identity) || (message.reply && known.has(message.reply.signature))) {
        loaded.push(message);
        known.add(identity);
      }
    }
    if (syntheticRoot && !loaded.some((message) => messageIdentity(message) === rootSignature)) {
      loaded.unshift(syntheticRoot);
    }
    if (anchor && !loaded.some((message) => message.id === anchor.id)) loaded.push(anchor);
    return loaded;
  }

  function createThreadMessage(message) {
    const entry = document.createElement("article");
    entry.className = "chatty-thread-message";
    const meta = document.createElement("div");
    meta.className = "chatty-thread-meta";
    const user = document.createElement("strong");
    user.className = "chatty-thread-user";
    user.textContent = `@${message.username || "unknown"}`;
    const time = document.createElement("time");
    time.textContent = messageTime.format(message.timestamp || Date.now());
    meta.append(user, time);
    const body = document.createElement("div");
    body.className = "chatty-thread-text";
    appendFragments(body, message.fragments || [{ type: "text", value: message.text || "" }]);
    entry.append(meta, body);
    return entry;
  }

  function renderThread(anchor = state.threadAnchor) {
    if (!state.root || !anchor) return;
    const panel = state.root.querySelector(".chatty-thread");
    const list = panel.querySelector(".chatty-thread-list");
    const messages = loadedThreadMessages(anchor);
    list.replaceChildren(...messages.map(createThreadMessage));
    const replyCount = Math.max(0, messages.length - 1);
    panel.querySelector(".chatty-thread-count").textContent =
      `${replyCount} ${replyCount === 1 ? "reply" : "replies"} loaded`;
  }

  function openThread(message) {
    state.threadAnchor = message;
    renderThread(message);
    state.root.querySelector(".chatty-thread").hidden = false;
  }

  function closeThread() {
    state.threadAnchor = null;
    state.threadDirty = false;
    const panel = state.root?.querySelector(".chatty-thread");
    if (panel) {
      panel.hidden = true;
      panel.querySelector(".chatty-thread-list").replaceChildren();
    }
  }

  function holdReplyInteraction(event) {
    state.activeReplyRow = event.currentTarget.closest(".chatty-message");
    state.replyInteractionUntil = Math.max(state.replyInteractionUntil, Date.now() + 650);
  }

  function createMessageRow(message) {
    const row = document.createElement("div");
    row.className = "chatty-message";
    row.dataset.messageId = message.id;
    const highlight = state.highlightMatcher(message);
    if (highlight) {
      row.classList.add(`chatty-highlight-${highlight.type}`);
      row.style.setProperty("--chatty-highlight", highlight.color);
    }
    if (message.reward) row.classList.add("chatty-reward");

    const time = document.createElement("time");
    time.className = "chatty-time";
    time.textContent = messageTime.format(message.timestamp);
    row.append(time);

    if (message.reply) {
      const context = document.createElement("button");
      context.type = "button";
      context.className = "chatty-reply-context";
      context.title = `View thread \u2014 replying to ${message.reply.parentUsername}: ${message.reply.parentText}`;
      context.setAttribute(
        "aria-label",
        `Open thread. Replying to ${message.reply.parentUsername}: ${message.reply.parentText}`
      );
      const arrow = document.createElement("span");
      arrow.className = "chatty-reply-context-arrow";
      arrow.textContent = "\u21b3";
      const user = document.createElement("strong");
      user.textContent = `@${message.reply.parentUsername}`;
      const snippet = document.createElement("span");
      snippet.className = "chatty-reply-context-text";
      snippet.textContent = message.reply.parentText || "Parent message";
      context.append(arrow, user, snippet);
      context.addEventListener("click", () => openThread(message));
      row.append(context);
    }

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

    const reply = document.createElement("button");
    reply.type = "button";
    reply.className = "chatty-reply";
    reply.textContent = "↩";
    reply.title = `Reply to ${message.username}`;
    reply.setAttribute("aria-label", `Reply to ${message.username}`);
    for (const eventName of ["pointerenter", "pointermove", "pointerdown", "focus"]) {
      reply.addEventListener(eventName, holdReplyInteraction);
    }
    reply.addEventListener("click", (event) => {
      event.stopPropagation();
      openNativeReply(message);
    });
    row.append(reply);

    if (
      state.isModerator &&
      message.username &&
      message.username.toLowerCase() !== state.viewerName.toLowerCase()
    ) {
      row.append(buildModeratorActions(message));
    }
    return row;
  }

  function trimMessageHistory() {
    const excess = state.messages.length - state.settings.maxMessages;
    if (excess <= 0) return;
    state.messages.splice(0, excess);
    state.historyStart += excess;
  }

  function storeVirtualHeight(index, height) {
    const heights = state.measuredHeights;
    const estimate = state.virtualRenderedEstimate;
    const previous = heights.get(index) ?? estimate;
    if (height === estimate) heights.delete(index);
    else heights.set(index, height);
    if (height === previous) return;

    const block = Math.floor(index / VIRTUAL_HEIGHT_BLOCK);
    const delta = (state.heightDeltas.get(block) || 0) + height - previous;
    if (delta) state.heightDeltas.set(block, delta);
    else state.heightDeltas.delete(block);
  }

  // Whole blocks keep spacer updates cheap even when thousands of rows have been measured.
  function virtualRangeHeight(start, end) {
    const estimate = state.virtualRenderedEstimate;
    let height = (end - start) * estimate;
    for (let index = start; index < end;) {
      if (index % VIRTUAL_HEIGHT_BLOCK === 0 && index + VIRTUAL_HEIGHT_BLOCK <= end) {
        height += state.heightDeltas.get(index / VIRTUAL_HEIGHT_BLOCK) || 0;
        index += VIRTUAL_HEIGHT_BLOCK;
      } else {
        height += (state.measuredHeights.get(index) ?? estimate) - estimate;
        index += 1;
      }
    }
    return height;
  }

  function virtualEstimatedAnchor(start, end, offset) {
    let low = start;
    let high = Math.max(start, end - 1);
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (virtualRangeHeight(start, mid + 1) <= offset) low = mid + 1;
      else high = mid;
    }
    return { index: low, offset: Math.max(0, offset - virtualRangeHeight(start, low)) };
  }

  function virtualScrollAnchor(scrollTop) {
    const { virtualWindow, virtualTop, virtualHistoryStart, virtualHistoryEnd } = state;
    const first = virtualHistoryStart + Math.max(0, state.virtualStart);
    const top = virtualTop.getBoundingClientRect().height || virtualRangeHeight(virtualHistoryStart, first);
    const localTop = scrollTop - top;
    const rows = virtualWindow.children;
    const height = virtualWindow.getBoundingClientRect().height;
    if (localTop < 0) {
      return virtualEstimatedAnchor(virtualHistoryStart, first, scrollTop);
    }
    if (!rows.length || !height) {
      return virtualEstimatedAnchor(virtualHistoryStart, virtualHistoryEnd, scrollTop);
    }
    if (localTop >= height) {
      return virtualEstimatedAnchor(first + rows.length, virtualHistoryEnd, localTop - height);
    }

    let low = 0;
    let high = rows.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const row = rows[mid];
      if (row.offsetTop + row.offsetHeight <= localTop) low = mid + 1;
      else high = mid;
    }
    return { index: first + low, offset: localTop - rows[low].offsetTop };
  }

  function syncVirtualRows(messages) {
    const { virtualWindow, virtualRows } = state;
    if (state.virtualDirty) {
      virtualWindow.replaceChildren();
      virtualRows.clear();
    } else {
      const retained = new Set(messages);
      for (const [message, row] of virtualRows) {
        if (retained.has(message)) continue;
        row.remove();
        virtualRows.delete(message);
      }
    }

    // The surviving rows are already in order. Leave them connected and insert only the gaps.
    const additions = document.createDocumentFragment();
    for (const message of messages) {
      const existing = virtualRows.get(message);
      if (existing) {
        if (additions.firstChild) virtualWindow.insertBefore(additions, existing);
      } else {
        const row = createMessageRow(message);
        virtualRows.set(message, row);
        additions.append(row);
      }
    }
    if (additions.firstChild) virtualWindow.append(additions);
  }

  function renderVirtualWindow(force = false) {
    const { list, search } = state;
    if (!list) return;
    const viewport = list.clientHeight || VIRTUAL_VIEWPORT_FALLBACK;
    const anchor = state.followLatest ? null : virtualScrollAnchor(list.scrollTop);
    trimMessageHistory();
    refreshChatSearch();
    if (state.threadDirty) {
      renderThread();
      state.threadDirty = false;
    }

    const total = state.messages.length;
    const windowSize = Math.ceil(viewport / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    const lastStart = Math.max(0, total - windowSize);
    const index = anchor ? Math.max(0, Math.min(
      (search.target ?? anchor.index) - state.historyStart,
      total - 1
    )) : 0;
    const start = state.followLatest ? lastStart : Math.max(0, Math.min(index - VIRTUAL_OVERSCAN, lastStart));
    const end = Math.min(total, start + windowSize);

    const viewer = findViewerName();
    if (!state.highlightMatcher || viewer !== state.viewerName) {
      state.viewerName = viewer;
      state.highlightMatcher = core.createHighlightMatcher(state.settings, viewer);
      state.virtualDirty = true;
    }

    const windowChanged = state.virtualDirty || start !== state.virtualStart || end !== state.virtualEnd ||
      state.historyStart !== state.virtualHistoryStart;
    if (windowChanged) {
      const messages = state.messages.slice(start, end);
      if (!force && state.followLatest && state.activeReplyRow?.isConnected) {
        const delay = state.replyInteractionUntil - Date.now();
        const keepsReply = !state.virtualDirty && messages.some(
          (message) => state.virtualRows.get(message) === state.activeReplyRow
        );
        if (!keepsReply && delay > 0) {
          if (!state.virtualRenderTimer) {
            state.virtualRenderTimer = setTimeout(() => {
              state.virtualRenderTimer = 0;
              scheduleVirtualRender();
            }, delay);
          }
          return;
        }
      }
      syncVirtualRows(messages);
    }

    const width = list.clientWidth;
    const layoutChanged = state.virtualDirty || state.virtualWidth !== width ||
      state.virtualRenderedEstimate !== state.virtualRowHeight;
    if (layoutChanged) {
      state.measuredHeights.clear();
      state.heightDeltas.clear();
    } else {
      for (let index = state.virtualHistoryStart; index < state.historyStart; index += 1) {
        storeVirtualHeight(index, state.virtualRenderedEstimate);
      }
    }
    state.virtualWidth = width;
    state.virtualRenderedEstimate = state.virtualRowHeight;
    const first = state.historyStart + start;
    const last = state.historyStart + end;
    const historyEnd = state.historyStart + total;
    const renderedHeight = state.virtualWindow.getBoundingClientRect().height;
    if (windowChanged || layoutChanged || renderedHeight !== state.virtualWindowHeight) {
      const rows = state.virtualWindow.children;
      for (let index = 0; index < rows.length; index += 1) {
        const height = rows[index].getBoundingClientRect().height;
        if (height) storeVirtualHeight(first + index, height);
      }
    }
    state.virtualWindowHeight = renderedHeight;
    const topHeight = virtualRangeHeight(state.historyStart, first);
    const top = `${topHeight}px`;
    const bottom = `${virtualRangeHeight(last, historyEnd)}px`;
    if (state.virtualTop.style.height !== top) state.virtualTop.style.height = top;
    if (state.virtualBottom.style.height !== bottom) state.virtualBottom.style.height = bottom;
    state.virtualStart = start;
    state.virtualEnd = end;
    state.virtualHistoryStart = state.historyStart;
    state.virtualHistoryEnd = historyEnd;
    state.virtualDirty = false;

    const match = state.messages[search.selected === null ? -1 : search.selected - state.historyStart];
    state.virtualRows.get(match)?.classList.add("chatty-search-match");
    state.lastScrollMax = Math.max(0, list.scrollHeight - list.clientHeight);
    if (state.followLatest) {
      setVirtualScrollTop(state.lastScrollMax);
    } else if (windowChanged || search.target !== null) {
      const row = state.virtualRows.get(state.messages[index]);
      if (row) {
        const offset = search.target !== null ? -Math.max(0, (viewport - row.offsetHeight) / 2)
          : anchor.index < state.historyStart ? 0 : Math.min(anchor.offset, Math.max(0, row.offsetHeight - 1));
        setVirtualScrollTop(Math.min(state.lastScrollMax, Math.max(0,
          topHeight + row.offsetTop + offset
        )));
      }
    }
    search.target = null;
    updateJumpButton();
  }

  function scheduleVirtualRender() {
    if (!state.list || state.virtualRenderFrame) return;
    state.virtualRenderFrame = requestAnimationFrame(() => {
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
    if (!state.outgoingDrafts.length) return false;
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
    if (state.threadAnchor) state.threadDirty = true;
    if (state.followLatest) state.unreadCount = 0;
    else state.unreadCount += 1;
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

  function findNativeMessage(message) {
    const candidates = Array.from(
      state.nativeContainer?.querySelectorAll(SELECTORS.message) || []
    ).reverse();
    const exact = candidates.find((node) =>
      node.getAttribute("data-id") === message.id ||
      node.querySelector("[data-a-target='chat-message-text']")?.id === message.id
    );
    if (exact) return exact;

    const expectedUser = String(message.username || "").trim().toLowerCase();
    const expectedText = normalizeEchoText(message.text);
    return candidates.find((node) => {
      const replyContext = findReplyContextNode(node);
      const usernameNode = currentUsernameNode(node, replyContext);
      const username = (
        usernameNode?.getAttribute("data-a-user") ||
        usernameNode?.textContent ||
        ""
      ).trim().toLowerCase();
      const body = currentMessageBody(node, replyContext);
      if (!body) return false;
      const text = collectFragments(body)
        .map((fragment) => fragment.value || fragment.alt || "")
        .join("");
      if (username !== expectedUser || normalizeEchoText(text) !== expectedText) return false;
      if (!message.reply) return true;
      return readReplyContext(node)?.signature === message.reply.signature;
    }) || null;
  }

  function nativeReplyScopes(messageNode) {
    if (!messageNode) return [];
    const scopes = [messageNode];
    let parent = messageNode.parentElement;
    for (let depth = 0; parent && depth < 3; depth += 1) {
      if (state.nativeContainer && !state.nativeContainer.contains(parent)) break;
      if (parent.querySelectorAll(SELECTORS.message).length > 1) break;
      scopes.push(parent);
      parent = parent.parentElement;
    }
    return scopes;
  }

  function nativeReplyButton(messageNode) {
    const selector = [
      "button[data-test-selector='chat-reply-button']",
      "[data-test-selector='chat-reply-button'] button",
      "[data-a-target='chat-message-reply-button']",
      "button[data-test-selector='chat-message-reply-button']",
      ".chat-line__reply-icon button",
      "button[aria-label^='Click to reply to @' i]",
      "button[aria-label^='Reply to ' i]",
      "button[aria-label='Reply' i]"
    ].join(",");
    for (const scope of nativeReplyScopes(messageNode)) {
      const button = scope.querySelector(selector);
      if (button) return button;
    }
    return null;
  }

  function openNativeReply(message) {
    const nativeMessage = findNativeMessage(message);
    if (!nativeMessage) {
      setStatus(`Reply unavailable for ${message.username}`);
      return;
    }

    for (const scope of nativeReplyScopes(nativeMessage)) {
      for (const type of ["pointerover", "mouseover", "mouseenter"]) {
        scope.dispatchEvent(new MouseEvent(type, {
          bubbles: type !== "mouseenter",
          cancelable: true,
          view: window
        }));
      }
    }
    const activate = () => {
      const button = nativeReplyButton(nativeMessage);
      if (!button) return false;
      button.click();
      setStatus(`Replying to ${message.username}`);
      return true;
    };
    if (!activate()) {
      let attempts = 0;
      const retry = () => {
        if (activate()) return;
        attempts += 1;
        if (attempts >= 12) {
          setStatus(`Reply unavailable for ${message.username}`);
          return;
        }
        setTimeout(retry, 25);
      };
      setTimeout(retry, 25);
    }
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
      trimMessageHistory();
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
    trimMessageHistory();
    state.observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) ingest(node);
        }
      }
      trimMessageHistory();
    });
    state.observer.observe(container, { childList: true, subtree: true });
  }

  async function loadEmotes(channel) {
    const panel = state.root;
    if (state.settings.textOnlyEmotes) {
      setStatus("Text-only emotes");
      return;
    }
    if (state.emoteLoad) return;
    setStatus("Loading 7TV…");
    const load = chrome.runtime.sendMessage({ type: "CHATTY_FETCH_7TV", channel }).catch(() => null);
    state.emoteLoad = load;
    const response = await load;
    if (state.root !== panel) return;
    state.emoteLoad = null;
    if (state.settings.textOnlyEmotes) return;
    if (!response?.ok) {
      setStatus("7TV unavailable");
      return;
    }
    state.emotes = Array.isArray(response.data.emotes) ?
      new Map(response.data.emotes.map((emote) => [emote.name, emote])) : core.indexEmotes([
      response.data.global,
      response.data.channelSet
    ]);
    state.virtualDirty = true;
    scheduleVirtualRender();
    setStatus(state.emotes.size + " emotes");
  }

  function unmount() {
    state.observer?.disconnect();
    state.nativeComposerAbort?.abort();
    state.nativeComposerResizeObserver?.disconnect();
    state.virtualResizeObserver?.disconnect();
    cancelAnimationFrame(state.virtualRenderFrame);
    clearTimeout(state.virtualRenderTimer);
    state.nativeComposer?.classList.remove("chatty-native-composer");
    state.root?.parentElement?.style.removeProperty("--chatty-native-composer-height");
    state.root?.remove();
    document.querySelector(".chatty-host")?.classList.remove("chatty-host");
    state.root = null;
    state.list = null;
    state.jumpButton = null;
    state.virtualWindow = null;
    state.virtualTop = null;
    state.virtualBottom = null;
    state.virtualRows.clear();
    state.messages = [];
    state.historyStart = 0;
    state.virtualStart = -1;
    state.virtualEnd = -1;
    state.virtualHistoryStart = 0;
    state.virtualHistoryEnd = 0;
    state.virtualRenderedEstimate = VIRTUAL_ROW_HEIGHT;
    state.virtualWidth = 0;
    state.virtualWindowHeight = 0;
    state.measuredHeights.clear();
    state.heightDeltas.clear();
    state.virtualRenderFrame = 0;
    state.virtualRenderTimer = 0;
    state.virtualResizeObserver = null;
    state.virtualDirty = false;
    state.lastScrollMax = 0;
    state.internalScrollTop = null;
    state.highlightMatcher = null;
    state.viewerName = "";
    state.replyInteractionUntil = 0;
    state.activeReplyRow = null;
    state.threadAnchor = null;
    state.threadDirty = false;
    state.followLatest = true;
    state.search = null;
    state.settingsToggle = null;
    state.emotes = new Map();
    state.emoteLoad = null;
    state.autocompleteRange = null;
    state.autocompleteQuery = "";
    state.autocompleteIndex = 0;
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
    state.predictionSignature = "";
    document.documentElement.classList.remove("chatty-active");
  }

  async function mount() {
    if (!state.settings.enabled) return;
    const channel = channelFromLocation();
    const readyShell = findChatShell(true);
    const shell = readyShell || findChatShell();
    if (!channel || !shell) return;
    const host = shell.querySelector(".chat-room__content") || shell;
    if (
      state.root &&
      state.channel === channel &&
      state.root.isConnected &&
      state.root.parentElement === host &&
      state.nativeContainer?.isConnected &&
      state.nativeContainer === findNativeContainer(shell)
    ) {
      syncNativeComposer(host);
      return;
    }
    if (state.root?.isConnected && state.channel === channel && !readyShell) {
      setStatus("Waiting for chat…");
      return;
    }

    unmount();
    state.channel = channel;
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
    if (state.rescanTimer) return;
    state.rescanTimer = setTimeout(() => {
      state.rescanTimer = 0;
      mount();
    }, 100);
  }

  function canUnloadCurrentTwitchTab() {
    if (!state.settings.enabled || !state.settings.idleTwitchMinutes || !document.hidden ||
      channelFromLocation() !== state.channel ||
      !state.root?.isConnected || !state.nativeComposer?.isConnected || !state.nativeContainer?.isConnected) return false;
    if ([...document.querySelectorAll("video, audio")].some((media) =>
      !media.paused && !media.ended || media.seeking || media === document.pictureInPictureElement
    )) return false;
    const editors = [...document.querySelectorAll(SELECTORS.idleDraft)];
    if (!editors.some((editor) => state.nativeComposer.contains(editor))) return false;
    if (editors.some((editor) => Boolean(
      (editor.value ?? editor.textContent)?.replace(/[\s\u200B\uFEFF]/g, "") ||
      editor.querySelector("img, [data-slate-void='true']")
    ))) return false;
    return !state.threadAnchor && state.search.panel.hidden &&
      state.root.querySelector(".chatty-settings").hidden;
  }

  async function boot() {
    const stored = await chrome.storage.sync.get("chattySettings");
    state.settings = core.sanitizeSettings(stored.chattySettings);
    const pageObserver = new MutationObserver((records) => {
      if (!state.settings.enabled) return;
      if (window.location.href !== state.route) {
        state.route = window.location.href;
        scheduleMount();
      } else if (!state.root?.isConnected) {
        scheduleMount();
      } else if (
        !state.nativeContainer?.isConnected &&
        mutationsTouchSelector(records.filter((record) => !state.root?.contains(record.target)), SELECTORS.chatReady)
      ) {
        scheduleMount();
      }
      const featureRecords = pageFeatureMutationRecords(records);
      if (
        featureRecords.length &&
        state.root?.isConnected &&
        !state.nativeComposer?.isConnected &&
        mutationsTouchSelector(featureRecords, SELECTORS.composer)
      ) {
        syncNativeComposer(state.root.parentElement);
      }
      if (featureRecords.length && mutationsTouchSelector(featureRecords, SELECTORS.pinned)) {
        syncPinnedMessage();
      }
      if (
        featureRecords.length &&
        mutationsTouchSelector(featureRecords, SELECTORS.predictionMutation)
      ) {
        syncPrediction();
      }
      if (state.settings.autoClaimPoints && featureRecords.length &&
        mutationsTouchSelector(featureRecords, SELECTORS.pointsClaim)) {
        schedulePointsScan();
      }
    });
    pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    chrome.runtime.onMessage?.addListener((message, sender, respond) => {
      if (message?.type !== "CANTY_CHECK_IDLE_TAB" || sender?.id !== chrome.runtime.id) return;
      respond({ canUnload: canUnloadCurrentTwitchTab() });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.chattySettings) return;
      const previousEnabled = state.settings.enabled;
      updateSettings(core.sanitizeSettings(changes.chattySettings.newValue));
      if (!state.settings.enabled) unmount();
      else if (!previousEnabled || !state.root?.isConnected) scheduleMount();
      else scanChannelPoints();
    });
    mount();
  }

  boot().catch((error) => console.error("[Canty] Failed to start:", error));
})();

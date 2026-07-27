(function startChatty() {
  "use strict";

  const core = globalThis.ChattyCore;
  const state = {
    root: null,
    list: null,
    settings: core.sanitizeSettings({}),
    emotes: new Map(),
    channel: "",
    seen: new Set(),
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
      <div class="chatty-list" role="log" aria-live="polite" aria-relevant="additions"></div>
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

  function showEmoteCard(event) {
    const emote = event.target.closest?.(".chatty-emote, .chatty-badge");
    if (!emote || !state.root?.contains(emote)) return;
    const card = state.root.querySelector(".chatty-emote-card");
    const preview = card.querySelector(".chatty-emote-preview");
    preview.src = emote.src;
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
    clearTimeout(state.pointsScanTimer);
    state.pointsScanTimer = setTimeout(scanChannelPoints, 100);
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
  }

  function setStatus(text) {
    const node = state.root?.querySelector(".chatty-status");
    if (node) node.textContent = text;
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
    const fragments = [];
    const walker = document.createTreeWalker(
      body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(candidate) {
          if (
            candidate.nodeType === Node.ELEMENT_NODE &&
            candidate !== body &&
            candidate.matches?.(
              "[data-a-target='chat-badge'], [data-a-target='chat-message-username']"
            )
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          if (
            candidate.nodeType === Node.TEXT_NODE &&
            !candidate.nodeValue
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let current;
    while ((current = walker.nextNode())) {
      if (current.nodeType === Node.TEXT_NODE) {
        fragments.push({ type: "text", value: current.nodeValue });
      } else if (current instanceof HTMLImageElement) {
        fragments.push({
          type: "image",
          src: current.currentSrc || current.src,
          alt: current.alt || current.title || "emote"
        });
      }
    }
    const text = fragments
      .map((fragment) => fragment.type === "text" ? fragment.value : fragment.alt)
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
    ).map((image) => ({ src: image.currentSrc || image.src, alt: image.alt || "badge" }));
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
      usernameNode
    };
  }

  function appendMessage(message) {
    if (!message || state.seen.has(message.id)) return;
    state.seen.add(message.id);
    if (state.seen.size > state.settings.maxMessages * 2) {
      state.seen = new Set(Array.from(state.seen).slice(-state.settings.maxMessages));
    }

    const wasNearBottom =
      state.list.scrollHeight - state.list.scrollTop - state.list.clientHeight < 80;
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
    time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    row.append(time);

    const badges = document.createElement("span");
    badges.className = "chatty-badges";
    for (const badge of message.badges) {
      const image = document.createElement("img");
      image.className = "chatty-badge";
      image.src = badge.src;
      image.alt = badge.alt;
      image.title = badge.alt;
      image.tabIndex = 0;
      image.dataset.emoteName = badge.alt || "Twitch badge";
      image.dataset.provider = "Twitch badge";
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
    for (const fragment of message.fragments || [{ type: "text", value: message.text }]) {
      if (fragment.type === "image") {
        const image = document.createElement("img");
        image.className = "chatty-emote";
        image.src = fragment.src;
        image.alt = fragment.alt;
        image.title = fragment.alt;
        image.loading = "lazy";
        decorateEmote(image, {
          name: fragment.alt,
          provider: "Twitch",
          id: twitchEmoteId(fragment.src)
        });
        content.append(image);
        continue;
      }
      for (const token of core.tokenizeEmotes(fragment.value, state.emotes)) {
        if (token.type === "text") {
          content.append(document.createTextNode(token.value));
          continue;
        }
        const image = document.createElement("img");
        image.className = "chatty-emote";
        image.src = token.emote.url;
        image.alt = token.value;
        image.title = token.value;
        image.loading = "lazy";
        decorateEmote(image, token.emote);
        content.append(image);
      }
    }
    row.append(content);
    state.list.append(row);

    while (state.list.childElementCount > state.settings.maxMessages) {
      state.list.firstElementChild?.remove();
    }
    if (wasNearBottom) state.list.scrollTop = state.list.scrollHeight;
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
      `${image.dataset.emoteName} — ${image.dataset.provider} emote`
    );
  }

  function openUserCard(message) {
    let usernameNode = message.usernameNode;
    if (!usernameNode?.isConnected) {
      const escaped = CSS.escape(message.username.toLowerCase());
      const nodes = state.nativeContainer?.querySelectorAll(`[data-a-user="${escaped}"]`);
      usernameNode = nodes?.[nodes.length - 1];
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

  function ingest(scope = document) {
    for (const node of scope.querySelectorAll?.(SELECTORS.message) || []) {
      if (state.processedNodes.has(node)) continue;
      state.processedNodes.add(node);
      appendMessage(readMessage(node));
    }
    if (scope.matches?.(SELECTORS.message) && !state.processedNodes.has(scope)) {
      state.processedNodes.add(scope);
      appendMessage(readMessage(scope));
    }
  }

  function observeNative(container) {
    state.observer?.disconnect();
    state.nativeContainer = container;
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
    if (state.nativeContainer && state.list) {
      state.list.replaceChildren();
      state.seen.clear();
      state.processedNodes = new WeakSet();
      ingest(state.nativeContainer);
      state.list.scrollTop = state.list.scrollHeight;
    }
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
    state.nativeContainer = null;
    state.nativeComposer = null;
    state.nativeComposerAbort = null;
    state.nativeComposerResizeObserver = null;
    state.seen.clear();
    state.processedNodes = new WeakSet();
    state.claimedPointButtons = new WeakSet();
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
    const pageObserver = new MutationObserver(() => {
      if (window.location.href !== state.route) {
        state.route = window.location.href;
        scheduleMount();
      } else if (!state.root?.isConnected) {
        scheduleMount();
      }
      if (state.root && !state.nativeComposer?.isConnected) {
        syncNativeComposer(state.root.parentElement);
      }
      schedulePointsScan();
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

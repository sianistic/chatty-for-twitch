"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const coreSource = fs.readFileSync(path.join(__dirname, "../src/core.js"), "utf8");
const contentSource = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");

async function waitFor(window, predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => window.setTimeout(resolve, 5));
  }
  return predicate();
}

async function createFixture(options = {}) {
  const viewerName = options.viewerName || "viewer";
  const dom = new JSDOM(`<!doctype html>
    <html><body>
      <button data-a-target="user-menu-toggle"><img alt="${viewerName}"></button>
      <div class="stream-chat">
        <div class="stream-chat-header">STREAM CHAT</div>
        <section data-test-selector="chat-room-component-layout">
          <div class="chat-room__content">
            <div class="pinned-chat__highlight-card">
              <div class="pinned-chat__pinned-by">Pinned by modJane</div>
              <p class="pinned-chat__message">
                Read the <a href="https://example.com/rules">channel rules</a>
              </p>
              <button aria-label="Expand">Expand</button>
            </div>
            <div data-a-target="chat-scroller">
              <div class="chat-line__message" data-id="message-1">
                <img
                  class="chat-badge"
                  alt="Moderator, examplechannel"
                  src="https://static-cdn.jtvnw.net/badges/v1/moderator/1/2"
                >
                <span
                  class="chat-author__display-name"
                  data-a-target="chat-message-username"
                  data-a-user="alice"
                  style="color: rgb(255, 0, 100)"
                >alice</span>
                <span data-a-target="chat-line-message-body">
                  hello <a href="https://example.com/news">example.com/news</a>
                  <img
                    alt="Kappa"
                    src="https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0"
                  >
                </span>
              </div>
              <div class="chat-line__message" data-id="message-filtered">
                <span
                  class="chat-author__display-name"
                  data-a-target="chat-message-username"
                  data-a-user="bob"
                >bob</span>
                <span data-a-target="chat-line-message-body">
                  <button data-a-target="chat-message-blocked">Show message</button>
                </span>
              </div>
            </div>
            <div class="native-shared-chat">Shared Chat</div>
            <div class="chat-input">
              <div data-test-selector="community-points-summary">
                <button aria-label="Bits and Points Balances">
                  <span data-test-selector="bits-balance-string"><span class="ScAnimatedNumber-sc-test">10</span></span><span data-test-selector="copo-balance-string"><span class="ScAnimatedNumber-sc-test">13.3K</span></span>
                </button>
              </div>
              <button aria-label="Claim Bonus">Claim</button>
              <div
                data-a-target="chat-input"
                contenteditable="true"
                role="textbox"
              ></div>
              <button data-a-target="chat-send-button">Chat</button>
            </div>
            <div class="chat-room__viewer-card" data-a-target="chat-user-card"></div>
          </div>
        </section>
      </div>
    </body></html>`, {
    url: "https://www.twitch.tv/examplechannel",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });

  const { window } = dom;
  const nativeDocumentQuerySelectorAll =
    window.document.querySelectorAll.bind(window.document);
  let pinnedQueryCount = 0;
  window.document.querySelectorAll = (selector) => {
    if (selector === ".pinned-chat__highlight-card") pinnedQueryCount += 1;
    return nativeDocumentQuerySelectorAll(selector);
  };
  window.__chattyTestMetrics = {
    get pinnedQueryCount() {
      return pinnedQueryCount;
    },
    reset() {
      pinnedQueryCount = 0;
    }
  };
  window.chrome = {
    runtime: {
      sendMessage: async () => ({
        ok: true,
        data: {
          global: options.emotePayload || { emotes: [] },
          channelSet: null
        }
      })
    },
    storage: {
      sync: {
        get: async () => ({ chattySettings: options.settings || {} }),
        set: async () => undefined
      },
      onChanged: { addListener: () => undefined }
    }
  };
  window.document.execCommand = (command, _ui, value) => {
    if (command !== "insertText") return false;
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const text = window.document.createTextNode(value);
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    const editor = text.parentElement?.closest?.("[contenteditable='true']");
    editor?.dispatchEvent(new window.InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    }));
    return true;
  };
  if (options.onClaim) {
    window.document
      .querySelector("[aria-label='Claim Bonus']")
      .addEventListener("click", options.onClaim);
  }
  window.document
    .querySelector("[data-a-target='chat-message-blocked']")
    .addEventListener("click", (event) => {
      const body = event.currentTarget.parentElement;
      event.currentTarget.remove();
      const revealed = window.document.createElement("span");
      revealed.setAttribute("data-a-target", "chat-message-text");
      revealed.textContent = "this damn filter is visible";
      body.append(revealed);
    });
  window.eval(coreSource);
  window.eval(contentSource);
  await new Promise((resolve) => window.setTimeout(resolve, 25));
  return dom;
}

test("Chatty overlays the chat content and owns the visible composer", async () => {
  const dom = await createFixture();
  const { document } = dom.window;
  const panel = document.querySelector("#chatty-panel");
  assert.ok(panel);
  assert.ok(panel.parentElement.classList.contains("chat-room__content"));
  assert.ok(panel.parentElement.classList.contains("chatty-host"));
  assert.ok(document.querySelector(".chatty-native-composer [data-a-target='chat-input']"));
  assert.ok(document.querySelector(".chatty-native-composer [data-a-target='chat-send-button']"));
  assert.ok(panel.querySelector("[data-settings-tab='automation']"));
  assert.ok(panel.querySelector("[data-setting='autoOpenLive']"));
});

test("username clicks delegate to Twitch's native user-card trigger", async () => {
  const dom = await createFixture();
  const { document, MouseEvent } = dom.window;
  let clicks = 0;
  document
    .querySelector("[data-a-user='alice']")
    .addEventListener("click", () => { clicks += 1; });
  document
    .querySelector(".chatty-name")
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(clicks, 1);
});

test("emote hover displays provider and emote ID", async () => {
  const dom = await createFixture();
  const { document, MouseEvent } = dom.window;
  const emote = document.querySelector(".chatty-emote");
  emote.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  const card = document.querySelector(".chatty-emote-card");
  assert.equal(card.hidden, false);
  assert.equal(card.querySelector(".chatty-emote-name").textContent, "Kappa");
  assert.equal(card.querySelector(".chatty-emote-provider").textContent, "Twitch");
  assert.match(card.querySelector(".chatty-emote-details").textContent, /ID 25/);
});

test("Chatty exposes Twitch's real Slate composer instead of a synthetic bridge", async () => {
  const dom = await createFixture();
  const { document } = dom.window;
  assert.equal(document.querySelector(".chatty-composer"), null);
  assert.ok(document.querySelector(".chat-input").classList.contains("chatty-native-composer"));
  assert.notEqual(
    document.querySelector(".chatty-host").style.getPropertyValue("--chatty-native-composer-height"),
    ""
  );
});

test("past messages are hydrated after the delayed 7TV emote set loads", async () => {
  const dom = await createFixture({
    emotePayload: {
      emotes: [{
        id: "hello-emote",
        name: "hello",
        data: {
          owner: { display_name: "Artist" },
          host: {
            url: "//cdn.7tv.app/emote/hello-emote",
            files: [{ name: "2x.webp", width: 64, height: 64 }]
          }
        }
      }]
    }
  });
  const emote = dom.window.document.querySelector(
    ".chatty-content .chatty-emote[alt='hello']"
  );
  assert.ok(emote, "the startup message should be re-rendered with its 7TV emote");
});

test("points balance and claiming remain accessible from Chatty", async () => {
  let claims = 0;
  const dom = await createFixture({
    onClaim: () => { claims += 1; }
  });
  const { document } = dom.window;
  let rewardPickerOpens = 0;
  document
    .querySelector("button[aria-label='Bits and Points Balances']")
    .addEventListener("click", () => { rewardPickerOpens += 1; });
  const nativePoints = document.querySelector(
    "[data-test-selector='community-points-summary']"
  );
  assert.match(
    nativePoints.querySelector("[data-test-selector='copo-balance-string']").textContent,
    /13\.3K/
  );
  assert.equal(document.querySelector(".chatty-points-button"), null);
  assert.ok(nativePoints.closest(".chatty-native-composer"));
  nativePoints.querySelector("button").click();
  document.querySelector("[aria-label='Claim Bonus']").click();
  assert.equal(rewardPickerOpens, 1);
  assert.equal(claims, 1);
});

test("7TV autocomplete appears after two matching letters", async () => {
  const dom = await createFixture({
    emotePayload: {
      emotes: [
        {
          id: "catjam",
          name: "catJAM",
          data: {
            host: {
              url: "//cdn.7tv.app/emote/catjam",
              files: [{ name: "2x.webp", width: 64, height: 64 }]
            }
          }
        },
        {
          id: "catdance",
          name: "catDance",
          data: {
            host: {
              url: "//cdn.7tv.app/emote/catdance",
              files: [{ name: "2x.webp", width: 64, height: 64 }]
            }
          }
        }
      ]
    }
  });
  const { document, Event } = dom.window;
  const input = document.querySelector("[data-a-target='chat-input']");
  input.textContent = "ca";
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const selection = dom.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  input.dispatchEvent(new Event("input", { bubbles: true }));

  const suggestions = Array.from(
    document.querySelectorAll(".chatty-autocomplete-option")
  );
  assert.ok(suggestions.length >= 2);
  assert.equal(suggestions[0].dataset.emoteName, "catDance");
  let completionInputEvents = 0;
  input.addEventListener("input", () => { completionInputEvents += 1; });
  suggestions[0].dispatchEvent(new dom.window.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true
  }));
  assert.equal(input.textContent, "catDance ");
  assert.equal(completionInputEvents, 1);
  assert.equal(document.querySelector(".chatty-autocomplete").hidden, true);
});

test("badge hover shows the Twitch badge name and provider", async () => {
  const dom = await createFixture();
  const { document, MouseEvent } = dom.window;
  const badge = document.querySelector(".chatty-badge");
  assert.ok(badge);
  badge.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  const card = document.querySelector(".chatty-emote-card");
  assert.equal(card.hidden, false);
  assert.equal(
    card.querySelector(".chatty-emote-name").textContent,
    "Moderator, examplechannel"
  );
  assert.equal(card.querySelector(".chatty-emote-provider").textContent, "Twitch badge");
});

test("auto-claim clicks an available bonus once", async () => {
  let claims = 0;
  const dom = await createFixture({
    settings: { autoClaimPoints: true },
    onClaim: () => { claims += 1; }
  });
  assert.equal(claims, 1);
});

test("message links preserve their URL and remain clickable", async () => {
  const dom = await createFixture();
  const link = dom.window.document.querySelector(
    ".chatty-message[data-message-id='message-1'] .chatty-link"
  );
  assert.ok(link);
  assert.equal(link.href, "https://example.com/news");
  assert.equal(link.target, "_blank");
  assert.match(link.rel, /noopener/);
});

test("filtered messages are automatically revealed and mirrored", async () => {
  const dom = await createFixture();
  const filtered = await waitFor(
    dom.window,
    () => dom.window.document.querySelector(
      ".chatty-message[data-message-id='message-filtered'] .chatty-content"
    )
  );
  assert.ok(filtered);
  assert.match(filtered.textContent, /damn filter is visible/);
  assert.doesNotMatch(filtered.textContent, /Show message/);
});

test("jump-to-latest control restores the bottom position", async () => {
  const dom = await createFixture();
  const { document, Event } = dom.window;
  const list = document.querySelector(".chatty-list");
  Object.defineProperties(list, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 200 },
    scrollTop: { configurable: true, writable: true, value: 100 }
  });
  list.dispatchEvent(new Event("scroll"));
  const jump = document.querySelector(".chatty-jump");
  assert.equal(jump.hidden, false);
  jump.click();
  assert.equal(list.scrollTop, 1000);
  assert.equal(jump.hidden, true);
});

test("pinned message UI includes attribution, content, and links", async () => {
  const dom = await createFixture();
  const pinned = dom.window.document.querySelector(".chatty-pinned");
  assert.ok(pinned);
  assert.equal(pinned.hidden, false);
  assert.match(pinned.querySelector(".chatty-pinned-meta").textContent, /modJane/);
  assert.match(pinned.querySelector(".chatty-pinned-content").textContent, /channel rules/);
  assert.equal(
    pinned.querySelector(".chatty-link").href,
    "https://example.com/rules"
  );
});

test("moderators receive native-command quick actions", async () => {
  const dom = await createFixture({ viewerName: "alice" });
  const { document } = dom.window;
  let sends = 0;
  document
    .querySelector("[data-a-target='chat-send-button']")
    .addEventListener("click", () => { sends += 1; });
  const timeout = document.querySelector(
    ".chatty-message[data-message-id='message-filtered'] [data-mod-action='timeout']"
  );
  assert.ok(timeout);
  timeout.click();
  assert.equal(
    document.querySelector("[data-a-target='chat-input']").textContent,
    "/timeout bob 600"
  );
  assert.equal(sends, 1);
});

test("ordinary chat mutations do not rescan the whole document for pinned content", async () => {
  const dom = await createFixture();
  const { document } = dom.window;
  dom.window.__chattyTestMetrics.reset();
  const scroller = document.querySelector("[data-a-target='chat-scroller']");

  for (let index = 0; index < 30; index += 1) {
    const message = document.createElement("div");
    message.className = "chat-line__message";
    message.dataset.id = `burst-${index}`;
    message.innerHTML = `
      <span data-a-target="chat-message-username" data-a-user="burst">burst</span>
      <span data-a-target="chat-line-message-body">message ${index}</span>
    `;
    scroller.append(message);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  }

  assert.ok(
    dom.window.__chattyTestMetrics.pinnedQueryCount <= 2,
    `expected at most 2 pinned scans, received ${dom.window.__chattyTestMetrics.pinnedQueryCount}`
  );
});

test("busy chat virtualizes history and renders older messages while scrolling", async () => {
  const dom = await createFixture({ settings: { maxMessages: 2000 } });
  const { document, Event } = dom.window;
  const scroller = document.querySelector("[data-a-target='chat-scroller']");
  const burst = document.createElement("div");

  for (let index = 0; index < 400; index += 1) {
    const message = document.createElement("div");
    message.className = "chat-line__message";
    message.dataset.id = `performance-${index}`;
    message.innerHTML = `
      <span data-a-target="chat-message-username" data-a-user="performance">performance</span>
      <span data-a-target="chat-line-message-body">
        <img src="https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0" alt="Kappa">
        message ${index}
      </span>
    `;
    burst.append(message);
  }

  scroller.append(burst);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 25));

  assert.ok(
    document.querySelectorAll(".chatty-message").length <= 80,
    "only the viewport and a small overscan buffer should exist in the live DOM"
  );
  assert.ok(document.querySelector("[data-message-id='performance-399']"));

  const list = document.querySelector(".chatty-list");
  list.scrollTop = 0;
  list.dispatchEvent(new Event("scroll"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 25));

  assert.ok(
    document.querySelector("[data-message-id='performance-0']"),
    "scrolling upward should render messages retained in the virtual history"
  );

  let simulatedScrollTop = 0;
  Object.defineProperties(list, {
    clientHeight: { configurable: true, get: () => 400 },
    scrollHeight: { configurable: true, get: () => 6000 },
    scrollTop: {
      configurable: true,
      get: () => simulatedScrollTop,
      set: (value) => {
        simulatedScrollTop = Math.max(0, Math.min(Number(value), 5600));
      }
    }
  });
  Object.defineProperty(document.querySelector(".chatty-virtual-window"), "scrollHeight", {
    configurable: true,
    get: () => 4000
  });

  const jump = document.querySelector(".chatty-jump");
  jump.click();

  assert.equal(
    jump.hidden,
    true,
    "jump-to-latest must stay hidden when the browser clamps the estimated bottom"
  );

  const latest = document.createElement("div");
  latest.className = "chat-line__message";
  latest.dataset.id = "performance-latest";
  latest.innerHTML = `
    <span data-a-target="chat-message-username" data-a-user="performance">performance</span>
    <span data-a-target="chat-line-message-body">latest message</span>
  `;
  scroller.append(latest);
  await waitFor(
    dom.window,
    () => document.querySelector("[data-message-id='performance-latest']")
  );

  assert.equal(
    jump.hidden,
    true,
    "new messages must not create an unread count while following the latest chat"
  );
});
